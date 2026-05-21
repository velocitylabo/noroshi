import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate, StubAdapter } from "../../src/index.js";
import type { LLMAdapter } from "../../src/index.js";

import { FEW_SHOTS } from "./examples.js";
import { CreativeCodingValidator } from "./validator.js";
import { transpile } from "./transpile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = readFileSync(resolve(HERE, "grammar.lark"), "utf8");

/**
 * Hand-built canned responder for offline PoC. The first response for the
 * pink-circle task is intentionally malformed (uses a non-keyword `dot`) to
 * exercise validator-driven retry; the second response is valid.
 *
 * Routes on the LAST `Task:` line in the prompt (the few-shot block also
 * contains `Task:` lines, so substring matching the whole prompt is wrong).
 */
function extractTask(prompt: string): string {
  const matches = [...prompt.matchAll(/^Task:\s*(.+)$/gm)];
  const last = matches[matches.length - 1];
  return (last?.[1] ?? "").toLowerCase();
}

function makeStubLLM(): LLMAdapter {
  let calls = 0;
  return new StubAdapter((prompt) => {
    calls++;
    const task = extractTask(prompt);
    if (task.includes("pink circle follows the mouse")) {
      if (calls === 1) {
        return ["tick {", "  background black", "  dot mx my 30", "}"].join("\n");
      }
      return ["tick {", "  background black", "  fill pink", "  circle mx my 30", "}"].join("\n");
    }
    if (task.includes("rainbow")) {
      return [
        "background black",
        "repeat 10 {",
        "  fill rgb(i * 25, 100, 200)",
        "  circle i * 40 + 20 h / 2 15",
        "}",
      ].join("\n");
    }
    return [
      "tick {",
      "  background black",
      "  fill yellow",
      "  square sin(t) * 100 + w / 2 h / 2 40",
      "}",
    ].join("\n");
  });
}

async function runOne(label: string, task: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  console.log(`Task: ${task}`);
  const result = await generate({
    task,
    grammar: GRAMMAR,
    examples: FEW_SHOTS,
    llm: makeStubLLM(),
    validator: new CreativeCodingValidator(),
    retry: { maxAttempts: 3, includeErrorInPrompt: true },
  });
  console.log(`Attempts: ${result.attempts}`);
  console.log(`Validation: ${JSON.stringify(result.validation)}`);
  console.log("DSL:\n" + result.output);
  if (result.validation?.ok) {
    console.log("--- p5.js ---");
    console.log(transpile(result.output));
  }
}

async function main(): Promise<void> {
  await runOne("Static rainbow",     "Make a rainbow row of 10 circles.");
  await runOne("Animated square",    "Make a bouncing yellow square that moves left and right.");
  await runOne("Retry-on-invalid",   "A pink circle follows the mouse, on a black background.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
