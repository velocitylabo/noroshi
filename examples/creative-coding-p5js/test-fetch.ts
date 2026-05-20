import { createServer, type Server } from "node:http";
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

interface ServerHandle {
  server: Server;
  url: string;
  calls: number;
}

function startStubServer(responder: (callIndex: number, body: unknown) => string): Promise<ServerHandle> {
  return new Promise((resolveP, rejectP) => {
    let calls = 0;
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          const body = raw ? JSON.parse(raw) : null;
          const content = responder(calls, body);
          calls++;
          const payload = { choices: [{ message: { content } }] };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        } catch (e) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(String(e));
        }
      });
    });
    server.on("error", rejectP);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const handle: ServerHandle = {
        server,
        url: `http://127.0.0.1:${addr.port}/v1`,
        get calls() {
          return calls;
        },
      } as ServerHandle;
      resolveP(handle);
    });
  });
}

async function runOne(label: string, opts: {
  responder: (callIndex: number) => string;
  retry?: number;
  expectOk: boolean;
  rawCompletion?: boolean;
}): Promise<boolean> {
  const handle = await startStubServer(opts.responder);
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
    await new Promise<void>((r) => handle.server.close(() => r()));
  }
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

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
