/**
 * Small-LLM × novel-DSL benchmark for noroshi.
 *
 * Drives `BENCH_TASKS` through an ablation ladder of 5 cells:
 *
 *   1. baseline      — task only, no grammar, no few-shot
 *   2. grammar-only  — BNF grammar injected, no few-shot
 *   3. +few-shot     — grammar + few-shot examples (noroshi default, 1 attempt)
 *   4. +retry        — +retry-with-feedback up to 3 attempts
 *   5. +rerank       — +best-of-3 with GrammarAwareRanker (B from the
 *                       research spike)
 *
 * Every chosen output is post-hoc evaluated with the SAME
 * `CreativeCodingValidator` so all cells share one yardstick.
 *
 * Configure via env vars:
 *
 *   NOROSHI_BENCH_ENDPOINT  default http://localhost:11434/v1
 *   NOROSHI_BENCH_MODEL     default qwen2.5:1.5b
 *   NOROSHI_BENCH_API_KEY   optional
 *
 * Run: `npx tsx examples/creative-coding-p5js/bench/run.ts`
 *
 * Output: console summary + a JSON file under bench/results-<model>.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generate,
  FetchAdapter,
  GrammarAwareRanker,
  type LLMAdapter,
} from "../../../src/index.js";

import { FEW_SHOTS } from "../examples.js";
import { CreativeCodingValidator } from "../validator.js";
import { BENCH_TASKS, type BenchTask } from "./tasks.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = readFileSync(resolve(HERE, "../grammar.lark"), "utf8");

interface Ablation {
  name: string;
  description: string;
  useGrammar: boolean;
  useFewShot: boolean;
  useValidator: boolean;
  retry: number;            // 0 = single attempt
  selfConsistencyN: number; // 1 = no self-consistency
  useRanker: boolean;
}

const ABLATIONS: Ablation[] = [
  {
    name: "baseline",
    description: "task only, no grammar, no few-shot, no validator",
    useGrammar: false, useFewShot: false, useValidator: false,
    retry: 0, selfConsistencyN: 1, useRanker: false,
  },
  {
    name: "grammar-only",
    description: "BNF grammar injected, no few-shot",
    useGrammar: true, useFewShot: false, useValidator: false,
    retry: 0, selfConsistencyN: 1, useRanker: false,
  },
  {
    name: "+few-shot",
    description: "grammar + few-shot examples (noroshi default, 1 attempt)",
    useGrammar: true, useFewShot: true, useValidator: true,
    retry: 0, selfConsistencyN: 1, useRanker: false,
  },
  {
    name: "+retry",
    description: "grammar + few-shot + retry-with-feedback up to 3 attempts",
    useGrammar: true, useFewShot: true, useValidator: true,
    retry: 3, selfConsistencyN: 1, useRanker: false,
  },
  {
    name: "+rerank",
    description: "grammar + few-shot + retry + best-of-3 with GrammarAwareRanker",
    useGrammar: true, useFewShot: true, useValidator: true,
    retry: 3, selfConsistencyN: 3, useRanker: true,
  },
];

interface CellResult {
  task: string;
  ablation: string;
  ok: boolean;
  attempts: number;
  latencyMs: number;
  outputPreview: string;
  error?: string;
}

const evalValidator = new CreativeCodingValidator();

async function runCell(
  adapter: LLMAdapter,
  task: BenchTask,
  abl: Ablation,
): Promise<CellResult> {
  const innerValidator = abl.useValidator ? new CreativeCodingValidator() : undefined;
  const ranker = abl.useRanker ? new GrammarAwareRanker() : undefined;
  const t0 = Date.now();

  let output = "";
  let attempts = 0;
  try {
    const result = await generate({
      task: task.input,
      grammar: abl.useGrammar ? GRAMMAR : "",
      examples: abl.useFewShot ? FEW_SHOTS : [],
      llm: adapter,
      validator: innerValidator,
      retry: abl.retry > 0 ? { maxAttempts: abl.retry, includeErrorInPrompt: true } : undefined,
      selfConsistency: abl.selfConsistencyN > 1
        ? { n: abl.selfConsistencyN, ranker }
        : undefined,
      sample: { temperature: 0.2, maxTokens: 256 },
    });
    output = result.output;
    attempts = result.attempts;
  } catch (e) {
    return {
      task: task.input,
      ablation: abl.name,
      ok: false,
      attempts,
      latencyMs: Date.now() - t0,
      outputPreview: "",
      error: String((e as Error)?.message ?? e),
    };
  }

  const evalR = evalValidator.validate(output);
  return {
    task: task.input,
    ablation: abl.name,
    ok: evalR.ok,
    attempts,
    latencyMs: Date.now() - t0,
    outputPreview: output.slice(0, 120),
    error: evalR.ok ? undefined : evalR.error,
  };
}

interface AblationSummary {
  name: string;
  passed: number;
  total: number;
  successRate: number;
  avgAttempts: number;
  avgLatencyMs: number;
}

function summarise(results: CellResult[]): AblationSummary[] {
  return ABLATIONS.map((abl) => {
    const cells = results.filter((r) => r.ablation === abl.name);
    const passed = cells.filter((r) => r.ok).length;
    const total = cells.length || 1;
    return {
      name: abl.name,
      passed,
      total: cells.length,
      successRate: passed / total,
      avgAttempts: cells.reduce((s, r) => s + r.attempts, 0) / total,
      avgLatencyMs: cells.reduce((s, r) => s + r.latencyMs, 0) / total,
    };
  });
}

async function main(): Promise<void> {
  const endpoint = process.env.NOROSHI_BENCH_ENDPOINT ?? "http://localhost:11434/v1";
  const model = process.env.NOROSHI_BENCH_MODEL ?? "qwen2.5:1.5b";
  const apiKey = process.env.NOROSHI_BENCH_API_KEY || undefined;

  console.log(
    `Bench: model=${model} endpoint=${endpoint} tasks=${BENCH_TASKS.length} ablations=${ABLATIONS.length}`,
  );
  console.log(
    `Expected LLM calls (lower bound): ${BENCH_TASKS.length * ABLATIONS.length} (retries / N-sampling add more)\n`,
  );

  const adapter = new FetchAdapter({ endpoint, model, apiKey });
  const results: CellResult[] = [];

  for (let i = 0; i < BENCH_TASKS.length; i++) {
    const task = BENCH_TASKS[i]!;
    console.log(`[task ${i + 1}/${BENCH_TASKS.length}] ${task.input}`);
    for (const abl of ABLATIONS) {
      const r = await runCell(adapter, task, abl);
      results.push(r);
      const mark = r.ok ? "✓" : "✗";
      console.log(
        `   ${abl.name.padEnd(13)} ${mark}  ${String(r.attempts).padStart(2)}x  ${String(r.latencyMs).padStart(5)}ms  ${
          r.error ? r.error.slice(0, 60) : r.outputPreview.replace(/\n/g, " ⏎ ").slice(0, 60)
        }`,
      );
    }
  }

  const summary = summarise(results);
  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(
      `${s.name.padEnd(13)} ${String(s.passed).padStart(2)}/${s.total} valid (${(s.successRate * 100).toFixed(0)}%)   ` +
        `avg ${s.avgAttempts.toFixed(1)} attempts   ${Math.round(s.avgLatencyMs)} ms/task`,
    );
  }

  const out = {
    model,
    endpoint,
    timestamp: new Date().toISOString(),
    taskCount: BENCH_TASKS.length,
    ablations: ABLATIONS,
    summary,
    results,
  };
  const safeModel = model.replace(/[^A-Za-z0-9._-]/g, "_");
  const outPath = resolve(HERE, `results-${safeModel}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
