import { buildPrompt } from "./prompt.js";
import type {
  GenerateOptions,
  GenerateResult,
  LLMAdapter,
  LLMSampleOptions,
  ValidationResult,
} from "./types.js";

/**
 * Main entry point. Builds a Grammar Prompting prompt, calls the LLM
 * (optionally N times for self-consistency), validates, and returns the
 * chosen output.
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const maxAttempts = opts.retry?.maxAttempts ?? 1;
  const includeErr = opts.retry?.includeErrorInPrompt ?? false;

  let attempts = 0;
  let lastError: string | undefined;
  let lastCandidates: string[] | undefined;
  let lastValidation: ValidationResult | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prompt = buildPrompt({
      task: opts.task,
      grammar: opts.grammar,
      examples: opts.examples,
      systemPrompt: opts.systemPrompt,
      errorFeedback: includeErr ? lastError : undefined,
    });

    const n = opts.selfConsistency?.n ?? 1;
    const candidates = await sample(opts.llm, prompt, n, opts.sample);
    attempts += candidates.length;
    lastCandidates = candidates;

    const picked = pick(candidates, opts);
    lastValidation = picked.validation;

    if (!opts.validator) {
      return {
        output: picked.output,
        attempts,
        candidates: n > 1 ? candidates : undefined,
      };
    }
    if (picked.validation && picked.validation.ok) {
      return {
        output: picked.output,
        ast: picked.validation.ast,
        attempts,
        candidates: n > 1 ? candidates : undefined,
        validation: picked.validation,
      };
    }
    lastError = picked.validation && !picked.validation.ok ? picked.validation.error : "unknown";
  }

  return {
    output: lastCandidates?.[0] ?? "",
    attempts,
    candidates: lastCandidates,
    validation: lastValidation,
  };
}

async function sample(
  llm: LLMAdapter,
  prompt: string,
  n: number,
  opts?: LLMSampleOptions,
): Promise<string[]> {
  if (n === 1) {
    return [await llm.complete(prompt, opts)];
  }
  if (llm.sampleN) {
    return llm.sampleN(prompt, n, opts);
  }
  return Promise.all(Array.from({ length: n }, () => llm.complete(prompt, opts)));
}

interface Picked {
  output: string;
  validation?: ValidationResult;
}

function pick(candidates: string[], opts: GenerateOptions): Picked {
  if (!opts.validator) {
    return { output: candidates[0] ?? "" };
  }

  if (opts.selfConsistency?.ranker) {
    // Custom ranker — pick the lowest score that also validates.
    // (Async ranker integration would require restructuring this helper to
    // async; deferred until ranker plugin is needed.)
    // For now: validate each, keep valid set, return first.
    const valid = candidates
      .map((c) => ({ c, v: opts.validator!.validate(c) }))
      .filter((x) => x.v.ok);
    if (valid.length > 0) {
      const first = valid[0]!;
      return { output: first.c, validation: first.v };
    }
    const firstWithErr = candidates[0] ?? "";
    return { output: firstWithErr, validation: opts.validator.validate(firstWithErr) };
  }

  // Default: first-valid-wins.
  for (const c of candidates) {
    const v = opts.validator.validate(c);
    if (v.ok) return { output: c, validation: v };
  }
  const fallback = candidates[0] ?? "";
  return { output: fallback, validation: opts.validator.validate(fallback) };
}
