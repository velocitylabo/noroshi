import { createServer, type Server, type IncomingHttpHeaders } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";

import { generate, FetchAdapter } from "../../src/index.js";

import { FEW_SHOTS } from "./examples.js";
import { CreativeCodingValidator } from "./validator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = readFileSync(resolve(HERE, "grammar.lark"), "utf8");

/**
 * Smoke test for FetchAdapter: stand up a fake OpenAI-compatible server,
 * drive noroshi.generate() through FetchAdapter + CreativeCodingValidator,
 * and assert the chosen output validates.
 *
 * No real LLM, no network — pure HTTP loopback so we can catch transport
 * regressions without depending on Ollama/llama-server being up.
 */

const VALID_DSL = [
  "background black",
  "fill red",
  "circle w / 2 h / 2 50",
].join("\n");

const INVALID_THEN_VALID: string[] = [
  // First call: malformed (uses a keyword 'dot' that the validator rejects).
  ["tick {", "  dot mx my 30", "}"].join("\n"),
  // Second call (after retry): valid.
  VALID_DSL,
];

interface RequestRecord {
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface StubResponse {
  status?: number;
  body: string;
  headers?: Record<string, string>;
}

interface ServerHandle {
  server: Server;
  url: string;
  requests: RequestRecord[];
}

function startStubServer(
  handler: (req: RequestRecord, callIndex: number) => StubResponse,
): Promise<ServerHandle> {
  return new Promise((resolveP, rejectP) => {
    const requests: RequestRecord[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const record: RequestRecord = {
          method: req.method ?? "GET",
          headers: req.headers,
          body: raw,
        };
        const i = requests.length;
        requests.push(record);
        try {
          const r = handler(record, i);
          res.writeHead(r.status ?? 200, {
            "content-type": "application/json",
            ...r.headers,
          });
          res.end(r.body);
        } catch (e) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(String(e));
        }
      });
    });
    server.on("error", rejectP);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolveP({
        server,
        url: `http://127.0.0.1:${addr.port}/v1`,
        requests,
      });
    });
  });
}

/** Convenience: turn a string→string responder into an OpenAI-shaped 200. */
function jsonOk(content: string): StubResponse {
  return { body: JSON.stringify({ choices: [{ message: { content } }] }) };
}

async function closeServer(handle: ServerHandle): Promise<void> {
  await new Promise<void>((r) => handle.server.close(() => r()));
}

async function runOne(label: string, opts: {
  responder: (callIndex: number) => string;
  retry?: number;
  expectOk: boolean;
  rawCompletion?: boolean;
}): Promise<boolean> {
  const handle = await startStubServer((_req, i) => jsonOk(opts.responder(i)));
  try {
    const adapter = new FetchAdapter({
      endpoint: handle.url,
      model: "stub-model",
      rawCompletion: opts.rawCompletion,
    });
    const result = await generate({
      task: "Draw a red circle in the middle.",
      grammar: GRAMMAR,
      examples: FEW_SHOTS,
      llm: adapter,
      validator: new CreativeCodingValidator(),
      retry: opts.retry ? { maxAttempts: opts.retry, includeErrorInPrompt: true } : undefined,
    });

    const ok = result.validation?.ok === true;
    const pass = ok === opts.expectOk;
    console.log(
      `${pass ? "ok" : "FAIL"}: ${label} — attempts=${result.attempts} validation=${JSON.stringify(result.validation)}`,
    );
    return pass;
  } finally {
    await closeServer(handle);
  }
}

async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  mustInclude?: string,
): Promise<boolean> {
  try {
    await fn();
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (mustInclude && !msg.includes(mustInclude)) {
      console.error(`FAIL: ${label} — message lacked "${mustInclude}": ${msg}`);
      return false;
    }
    console.log(`ok: ${label} → threw "${msg.slice(0, 100)}"`);
    return true;
  }
  console.error(`FAIL: ${label} — expected throw, but call returned`);
  return false;
}

async function main(): Promise<void> {
  const results: boolean[] = [];

  results.push(
    await runOne("valid response on first call", {
      responder: () => VALID_DSL,
      expectOk: true,
    }),
  );

  results.push(
    await runOne("invalid then valid with retry", {
      responder: (i) => INVALID_THEN_VALID[Math.min(i, INVALID_THEN_VALID.length - 1)]!,
      retry: 3,
      expectOk: true,
    }),
  );

  results.push(
    await runOne("invalid response, no retry → expect validation failure", {
      responder: () => INVALID_THEN_VALID[0]!,
      expectOk: false,
    }),
  );

  // Noisy: code fence + a hallucinated next few-shot turn. cleanCompletion
  // should pick the FIRST Output: block, not the trailing garbage.
  const NOISY_VALID = [
    "```dsl",
    VALID_DSL,
    "```",
    "",
    "Task: imagined follow-up task",
    "Output:",
    "garbage_keyword 1 2 3",
  ].join("\n");

  results.push(
    await runOne("noisy response (fence + extra Task/Output) → first DSL wins via cleanup", {
      responder: () => NOISY_VALID,
      expectOk: true,
    }),
  );

  results.push(
    await runOne("same noisy response with rawCompletion=true → validation fails", {
      responder: () => NOISY_VALID,
      rawCompletion: true,
      expectOk: false,
    }),
  );

  // 5xx response: FetchAdapter must throw and the error message must
  // carry the upstream status + body snippet to make debugging tractable.
  {
    const handle = await startStubServer(() => ({
      status: 503,
      headers: { "content-type": "text/plain" },
      body: "upstream model is loading",
    }));
    const adapter = new FetchAdapter({ endpoint: handle.url, model: "stub-model" });
    results.push(
      await expectThrows(
        "5xx surfaces as adapter throw",
        () =>
          generate({
            task: "Draw a red circle.",
            grammar: GRAMMAR,
            examples: FEW_SHOTS,
            llm: adapter,
            validator: new CreativeCodingValidator(),
          }),
        "503",
      ),
    );
    await closeServer(handle);
  }

  // 200 with the wrong shape: no choices, or message.content not a string.
  // Adapter must throw with a self-explanatory error rather than silently
  // returning undefined / "[object Object]".
  {
    const handle = await startStubServer(() => ({
      body: JSON.stringify({ choices: [{ message: { reasoning: "thinking..." } }] }),
    }));
    const adapter = new FetchAdapter({ endpoint: handle.url, model: "stub-model" });
    results.push(
      await expectThrows(
        "missing message.content throws with shape hint",
        () =>
          generate({
            task: "Draw a red circle.",
            grammar: GRAMMAR,
            examples: FEW_SHOTS,
            llm: adapter,
            validator: new CreativeCodingValidator(),
          }),
        "unexpected response",
      ),
    );
    await closeServer(handle);
  }

  // apiKey forwarding: the option lands as "Authorization: Bearer <key>"
  // on the wire. Verify by inspecting the request the stub server received.
  {
    const handle = await startStubServer(() => jsonOk(VALID_DSL));
    const adapter = new FetchAdapter({
      endpoint: handle.url,
      model: "stub-model",
      apiKey: "sk-test-abc",
    });
    await generate({
      task: "Draw a red circle.",
      grammar: GRAMMAR,
      examples: FEW_SHOTS,
      llm: adapter,
      validator: new CreativeCodingValidator(),
    });
    const auth = handle.requests[0]?.headers.authorization;
    const ok = auth === "Bearer sk-test-abc";
    if (ok) {
      console.log(`ok: apiKey forwarded as Authorization header`);
    } else {
      console.error(`FAIL: apiKey forwarding — got "${auth}", want "Bearer sk-test-abc"`);
    }
    results.push(ok);
    await closeServer(handle);
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
