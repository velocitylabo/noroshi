import type { FewShotExample } from "./types.js";

export interface PromptInputs {
  task: string;
  grammar: string;
  examples: FewShotExample[];
  systemPrompt?: string;
  /** Error string from a previous attempt to feed back to the model. */
  errorFeedback?: string;
}

const DEFAULT_SYSTEM = [
  "You generate output strictly conforming to the grammar below.",
  "Do not include explanation, prose, code fences, or commentary —",
  "emit only the DSL string that the grammar would accept.",
].join(" ");

/**
 * Build a Grammar-Prompting style prompt:
 *   1. System instruction
 *   2. Grammar block (BNF/EBNF)
 *   3. Few-shot block (with optional derivation)
 *   4. Optional error feedback from prior attempt
 *   5. The current task
 *
 * Tone-neutral and provider-agnostic: returns a single string. Adapters can
 * wrap it in chat roles if needed.
 */
export function buildPrompt(p: PromptInputs): string {
  const parts: string[] = [];

  parts.push(p.systemPrompt ?? DEFAULT_SYSTEM);

  parts.push("\nGrammar (BNF/EBNF):\n```");
  parts.push(p.grammar.trim());
  parts.push("```");

  if (p.examples.length > 0) {
    parts.push("\nExamples:");
    for (const ex of p.examples) {
      parts.push(`Task: ${ex.input}`);
      if (ex.derivation) {
        parts.push(`Derivation:\n${ex.derivation.trim()}`);
      }
      parts.push(`Output:\n${ex.output.trim()}\n`);
    }
  }

  if (p.errorFeedback) {
    parts.push(
      `\nPrior attempt failed validation with: ${p.errorFeedback}\n` +
        `Produce a new output that fixes this error.\n`,
    );
  }

  parts.push(`\nTask: ${p.task}`);
  parts.push("Output:");

  return parts.join("\n");
}
