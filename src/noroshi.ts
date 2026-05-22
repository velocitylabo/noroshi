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
  let lastOutput = "";

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

    const picked = await pick(candidates, opts);
    lastValidation = picked.validation;
    lastOutput = picked.output;

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

  // Out of retries: surface the best candidate the ranker (or first-valid)
  // picked on the final attempt, not just candidate #0.
  return {
    output: lastOutput,
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

async function pick(candidates: string[], opts: GenerateOptions): Promise<Picked> {
  if (!opts.validator) {
    return { output: candidates[0] ?? "" };
  }

  const validations = candidates.map((c) => opts.validator!.validate(c));

  if (opts.selfConsistency?.ranker) {
    const scores = await opts.selfConsistency.ranker.rank(candidates, { validations });
    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
      const s = scores[i] ?? Number.POSITIVE_INFINITY;
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    return { output: candidates[bestIdx] ?? "", validation: validations[bestIdx] };
  }

  // Default: first-valid-wins.
  for (let i = 0; i < candidates.length; i++) {
    if (validations[i]?.ok) return { output: candidates[i] ?? "", validation: validations[i] };
  }
  return { output: candidates[0] ?? "", validation: validations[0] };
}
