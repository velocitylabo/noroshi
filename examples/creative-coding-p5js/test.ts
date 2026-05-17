/**
 * Quick smoke test for the example pipeline.
 * Runs the validator and transpiler over every few-shot in `examples.ts`
 * to confirm the grammar v0 is self-consistent.
 *
 * Run with: `npx tsx examples/creative-coding-p5js/test.ts`
 */

import { FEW_SHOTS } from "./examples.js";
import { CreativeCodingValidator } from "./validator.js";
import { transpile } from "./transpile.js";

const v = new CreativeCodingValidator();
let pass = 0, fail = 0;

for (const ex of FEW_SHOTS) {
  const r = v.validate(ex.output);
  if (!r.ok) {
    console.error(`FAIL validator: ${ex.input}\n  error: ${r.error}\n  output:\n${ex.output}\n`);
    fail++;
    continue;
  }
  let js: string;
  try {
    js = transpile(ex.output);
  } catch (e) {
    console.error(`FAIL transpiler: ${ex.input}: ${(e as Error).message}`);
    fail++;
    continue;
  }
  if (!/function setup\(\)/.test(js) || !/function draw\(\)/.test(js)) {
    console.error(`FAIL transpiler shape: ${ex.input}\n${js}`);
    fail++;
    continue;
  }
  console.log(`ok: ${ex.input}`);
  pass++;
}

// Negative tests
const NEG: Array<[string, string]> = [
  ["unknown keyword", "circle 10 10 10\nflubber"],
  ["wrong arity", "circle 10 10"],
  ["unbalanced brace", "tick {\n  circle 1 2 3\n"],
  ["bare identifier in expr", "circle foo 10 10"],
];
for (const [label, src] of NEG) {
  const r = v.validate(src);
  if (r.ok) {
    console.error(`FAIL negative (${label}) should have errored but passed`);
    fail++;
  } else {
    console.log(`ok-neg: ${label} → ${r.error}`);
    pass++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
