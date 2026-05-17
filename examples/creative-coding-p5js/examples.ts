import type { FewShotExample } from "../../src/index.js";

/**
 * Hand-curated few-shot bank for the noroshi-creative DSL.
 *
 * Each example pairs a natural-language task with a valid DSL program. The
 * `derivation` field shows the grammar reductions Wang et al. style — the
 * model learns to emit derivation → output, which steers it onto the grammar
 * surface for novel DSLs.
 *
 * Keep this list short (3–5 entries). The strongest examples cover:
 *  - static drawing (shapes + color)
 *  - background + multiple shapes
 *  - animation via `tick` and `t`/`f`
 *  - `repeat` with the `i` counter
 *  - mouse interaction with `mx`/`my`
 */
export const FEW_SHOTS: FewShotExample[] = [
  {
    input: "Draw a red circle in the middle of the canvas.",
    derivation: [
      "start → block",
      "block → stmt",
      "stmt → bg_stmt | shape_stmt (×2)",
      "shape_stmt → fill color (red), circle expr expr expr",
    ].join("\n"),
    output: [
      "background white",
      "fill red",
      "circle w / 2 h / 2 50",
    ].join("\n"),
  },
  {
    input: "Make a bouncing yellow square that moves left and right.",
    derivation: [
      "start → block (setup) block (tick)",
      "setup → background black",
      "tick → fill yellow, square (sin(t) * 100 + w/2) h/2 40",
    ].join("\n"),
    output: [
      "setup {",
      "  background black",
      "}",
      "tick {",
      "  background black",
      "  fill yellow",
      "  square sin(t) * 100 + w / 2 h / 2 40",
      "}",
    ].join("\n"),
  },
  {
    input: "Draw 10 blue circles in a horizontal row.",
    derivation: [
      "start → block",
      "block → bg_stmt, fill blue, repeat 10 { circle (i * 40 + 20) h/2 15 }",
    ].join("\n"),
    output: [
      "background white",
      "fill blue",
      "repeat 10 {",
      "  circle i * 40 + 20 h / 2 15",
      "}",
    ].join("\n"),
  },
  {
    input: "A pink circle follows the mouse, on a black background.",
    derivation: [
      "tick → background black, fill pink, circle mx my 30",
    ].join("\n"),
    output: [
      "tick {",
      "  background black",
      "  fill pink",
      "  circle mx my 30",
      "}",
    ].join("\n"),
  },
];
