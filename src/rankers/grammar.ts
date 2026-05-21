import type { Ranker, ValidationResult } from "../types.js";

/**
 * Best-of-N ranker that prefers (a) fully-valid candidates, then (b) candidates
 * that progressed further before the validator gave up.
 *
 * Score (lower = better):
 *   - validation.ok          → 0          (always best)
 *   - !ok with errorOffset   → max(1, len - errorOffset)
 *   - !ok without offset     → len        (treat as failure at position 0)
 *   - no validation supplied → len        (fallback: prefer shorter)
 *
 * The intent: when N small-LLM samples all miss the grammar, the closest
 * miss is still the most useful one to feed into retry-with-feedback (the
 * error message that comes back from it will be the most specific).
 *
 * Use by passing through generate():
 *
 *   generate({
 *     ...,
 *     selfConsistency: { n: 5, ranker: new GrammarAwareRanker() },
 *   });
 *
 * Requires a {@link Validator} on the same generate() call so the ranker
 * receives validations via `context`. Without a validator the ranker
 * degrades to a length-only score.
 */
export class GrammarAwareRanker implements Ranker {
  readonly id = "grammar-aware";

  async rank(
    candidates: string[],
    context?: { validations?: ValidationResult[] },
  ): Promise<number[]> {
    const validations = context?.validations;
    return candidates.map((c, i) => {
      const v = validations?.[i];
      if (!v) return c.length;
      if (v.ok) return 0;
      const offset = typeof v.errorOffset === "number" ? v.errorOffset : 0;
      return Math.max(1, c.length - offset);
    });
  }
}
