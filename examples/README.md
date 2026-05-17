# noroshi examples

Reference applications demonstrating `noroshi` for various DSLs and browser-side LLM runtimes.

## Planned

### `creative-coding-p5js/` — **PoC available**

A creative coding DSL with a p5.js transpiler. Uses `noroshi` to constrain a small on-device LLM (Gemma 4 E2B / Phi-3 / Llama 3.2 1B) to a reduced creative-coding surface area, then transpiles to p5.js for browser rendering. Targets natural-language → visual sketch flows including kids' vibe coding apps.

Status v0 (2026-05-17): grammar + few-shot bank + hand-rolled validator + transpiler + retry-with-feedback PoC runner (Node, stub LLM) + static browser harness. See [`creative-coding-p5js/README.md`](./creative-coding-p5js/README.md).

### Additional DSL examples

- Simplified SQL subset for natural-language → query
- Custom annotation languages
- IR for diagrams / charts

## Status

`creative-coding-p5js/` is the first end-to-end PoC. Other DSLs listed above remain placeholders and will be added as `noroshi` matures.
