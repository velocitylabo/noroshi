/**
 * Strip common LLM noise from a completion so the validator sees a raw DSL
 * program. Priorities (first match wins):
 *
 *  1. Markdown code fence body — `\`\`\`dsl\n<DSL>\n\`\`\`` style. Catches
 *     models that wrap the answer in a fence and then hallucinate extra
 *     few-shot turns after the closing fence.
 *  2. `Output:` frame — `Output:\n<DSL>` style, echoing the prompt's
 *     few-shot template. The FIRST `Output:` block wins.
 *  3. Bare body with `Task:` markers — strip a leading task echo and cut at
 *     the next `Task:` line.
 *
 * After any of the above, we still trim a trailing `Task:` continuation just
 * in case it leaked into the chosen block. Idempotent on clean input.
 */

const FENCE_BLOCK_RE = /```[a-zA-Z]*\n?([\s\S]*?)```/;
const FIRST_OUTPUT_RE = /(?:^|\n)\s*Output:\s*\n?([\s\S]*?)(?=\n\s*Task:|$)/;
const LEADING_TASK_RE = /^\s*Task:[^\n]*\n+/;
const NEXT_TASK_RE = /\n\s*Task:\s/;

export function cleanCompletion(raw: string): string {
  let s = String(raw ?? "");

  const fenceBlock = s.match(FENCE_BLOCK_RE);
  if (fenceBlock) {
    s = fenceBlock[1] ?? "";
  } else {
    const m = s.match(FIRST_OUTPUT_RE);
    if (m) {
      s = m[1] ?? "";
    } else {
      s = s.replace(LEADING_TASK_RE, "");
      const next = s.match(NEXT_TASK_RE);
      if (next && typeof next.index === "number") s = s.slice(0, next.index);
    }
  }

  const nextTask = s.match(NEXT_TASK_RE);
  if (nextTask && typeof nextTask.index === "number") s = s.slice(0, nextTask.index);

  return s.trim();
}
