/**
 * Tests for GrammarAwareRanker.
 *
 * Two layers:
 *  (1) Direct rank() call — assert score ordering: valid < deep-fail < shallow-fail.
 *  (2) End-to-end through generate() with StubAdapter returning N candidates,
 *      assert that the ranker drives the final pick:
 *        - all-invalid set      → deepest parse wins
 *        - mixed valid/invalid  → valid wins
 *
 * Run: `npx tsx examples/creative-coding-p5js/test-ranker.ts`
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generate,
  StubAdapter,
  GrammarAwareRanker,
} from "../../src/index.js";

import { CreativeCodingValidator } from "./validator.js";
import { FEW_SHOTS } from "./examples.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = readFileSync(resolve(HERE, "grammar.lark"), "utf8");

const validator = new CreativeCodingValidator();
const ranker = new GrammarAwareRanker();

let pass = 0;
let fail = 0;

function ok(label: string): void {
  console.log(`ok: ${label}`);
  pass++;
}

function bad(label: string, why: string): void {
  console.error(`FAIL: ${label} — ${why}`);
  fail++;
}

// ---- (1) Direct rank() ----

const VALID = "background black";
// "flubber" is unknown → lex fails at offset 0 → shallow.
const SHALLOW_FAIL = "flubber background black";
// Lex passes, parser succeeds through `background black` (16 chars),
// then `circle` consumes 3 expressions and trips on "a" (unknown identifier
// inside expression — actually lex still rejects "a" first because "a" is
// not in VAR/FUNC/KEYWORD/COLOR. Tweak: use `bad_kw` to force a parse-time
// failure deep in the input.
//
// Cleaner deep-fail: a well-formed shape statement followed by a malformed
// rgb literal — lex passes everything, parser fails partway through rgb(...).
const DEEP_FAIL = "background black\nfill rgb(1, 2)"; // rgb expects 3 args, fails near offset 30

{
  const cands = [SHALLOW_FAIL, DEEP_FAIL, VALID];
  const validations = cands.map((c) => validator.validate(c));
  const scores = await ranker.rank(cands, { validations });
  const [sShallow, sDeep, sValid] = scores;

  if (sValid === 0) ok("rank: valid candidate scores 0");
  else bad("rank: valid scores 0", `got ${sValid}`);

  if (typeof sDeep === "number" && typeof sShallow === "number" && sDeep < sShallow) {
    ok(`rank: deeper fail beats shallow fail (deep=${sDeep} < shallow=${sShallow})`);
  } else {
    bad("rank: deep < shallow", `deep=${sDeep} shallow=${sShallow}`);
  }

  if (typeof sValid === "number" && typeof sDeep === "number" && sValid < sDeep) {
    ok(`rank: valid beats deep fail (${sValid} < ${sDeep})`);
  } else {
    bad("rank: valid < deep", `valid=${sValid} deep=${sDeep}`);
  }
}

// ---- (2) End-to-end through generate() ----

function llmWith(candidates: string[]): StubAdapter {
  // StubAdapter responder returns the array as the N-sample bank.
  return new StubAdapter(() => candidates);
}

// 2a) All N candidates invalid; deepest parse must be chosen.
{
  const result = await generate({
    task: "force best-of-N selection",
    grammar: GRAMMAR,
    examples: FEW_SHOTS,
    llm: llmWith([SHALLOW_FAIL, DEEP_FAIL, "more_nonsense"]),
    validator,
    selfConsistency: { n: 3, ranker },
  });
  if (result.output === DEEP_FAIL) {
    ok("best-of-N (all invalid): deepest parse wins");
  } else {
    bad("best-of-N all invalid", `picked "${result.output.slice(0, 40)}", wanted DEEP_FAIL`);
  }
}

// 2b) Mixed set: valid candidate must win even when it isn't the first one
// emitted (this is the regression noroshi's old "first-valid wins" code
// would have caught too, but we want to assert the ranker path agrees).
{
  const result = await generate({
    task: "mixed set",
    grammar: GRAMMAR,
    examples: FEW_SHOTS,
    llm: llmWith([SHALLOW_FAIL, VALID, DEEP_FAIL]),
    validator,
    selfConsistency: { n: 3, ranker },
  });
  if (result.output === VALID && result.validation?.ok) {
    ok("best-of-N (mixed): valid candidate wins regardless of position");
  } else {
    bad("best-of-N mixed", `picked "${result.output.slice(0, 40)}" valid=${result.validation?.ok}`);
  }
}

// 2c) Without a ranker, the old first-valid behaviour still holds.
{
  const result = await generate({
    task: "first-valid baseline",
    grammar: GRAMMAR,
    examples: FEW_SHOTS,
    llm: llmWith([SHALLOW_FAIL, DEEP_FAIL, VALID]),
    validator,
    selfConsistency: { n: 3 }, // no ranker
  });
  if (result.output === VALID) {
    ok("no-ranker baseline: first-valid still wins");
  } else {
    bad("no-ranker baseline", `picked "${result.output.slice(0, 40)}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
