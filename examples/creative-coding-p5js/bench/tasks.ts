/**
 * 20 natural-language tasks for the noroshi-creative DSL benchmark.
 *
 * Designed to span the grammar surface:
 *   - static single-shape       (5)
 *   - static multi-shape        (4)
 *   - repeat-loop driven        (4)
 *   - tick-block animation      (3)
 *   - mouse interaction         (2)
 *   - time-based animation      (2)
 *
 * Tasks are deliberately distinct from the four entries in `examples.ts`
 * (the few-shot bank) so we are measuring novel-task generalisation,
 * not pattern-matching against in-context examples.
 */

export interface BenchTask {
  input: string;
  /** Optional human-language description — not used by the runner. */
  expectedShape?: string;
}

export const BENCH_TASKS: BenchTask[] = [
  // --- static, single shape ---
  { input: "Draw a single white circle in the middle of a black canvas." },
  { input: "Fill the canvas with green." },
  { input: "Draw a red square at the top-left corner." },
  { input: "Draw a horizontal blue line across the middle of the canvas." },
  { input: "Draw a small purple circle at the bottom-right." },
  // --- static, multi shape ---
  { input: "Three pink circles in a horizontal row." },
  { input: "A white background with a green square in the center." },
  { input: "Two purple squares side by side at the top." },
  { input: "A red circle inside a blue rectangle." },
  // --- repeat-loop ---
  { input: "Five orange circles spread out horizontally across the canvas." },
  { input: "Ten yellow dots arranged in a row." },
  { input: "Eight blue squares stacked vertically." },
  { input: "Six small green circles in a row near the top." },
  // --- tick animation ---
  { input: "A circle that moves left and right across the middle of the canvas." },
  { input: "A square that grows and shrinks at the center over time." },
  { input: "A pulsing pink circle in the middle." },
  // --- mouse interaction ---
  { input: "A green dot that follows the mouse." },
  { input: "A red circle that tracks the mouse position." },
  // --- time-based ---
  { input: "A circle that orbits around the center of the canvas over time." },
  { input: "Background that flashes between black and white over time." },
];
