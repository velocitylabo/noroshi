# creative-coding-p5js

PoC example for `noroshi` — natural language → constrained creative-coding DSL → p5.js sketch.

Target audience: kids' vibe-coding apps that need to run a small LLM (Gemma 4 E2B / Phi-3 / Llama 3.2 1B) on-device and constrain it to a tiny safe-by-construction visual DSL.

## Files

| File | Purpose |
|------|---------|
| `grammar.lark` | BNF/EBNF grammar of the DSL (injected into the prompt verbatim). |
| `examples.ts`  | Few-shot bank (input → derivation → output). |
| `validator.ts` | Hand-rolled tokenizer + recursive-descent validator (no nearley dep). |
| `transpile.ts` | DSL → p5.js source. |
| `index.ts`     | PoC entry: stub LLM → noroshi.generate → validate → transpile. |
| `test.ts`      | Smoke test: validate + transpile every few-shot, plus negative cases. |
| `index.html`   | Browser harness: paste DSL, see live p5.js render. |

## DSL surface

Statement-oriented, whitespace-separated, `{ ... }` blocks, no terminator.

```text
background white
fill red
circle w / 2 h / 2 50
```

Built-in variables (in expressions):

| Name | Meaning |
|------|---------|
| `t`  | elapsed seconds |
| `f`  | frame counter   |
| `w` `h` | canvas size  |
| `mx` `my` | mouse position |
| `i`  | repeat-loop counter (only valid inside `repeat`) |

Built-in functions: `sin`, `cos`, `random`, `abs`.

Blocks:
- `setup { ... }` — runs once
- `tick { ... }`  — runs every frame
- top-level statements w/o blocks run once (single-frame sketch)

## Run the PoC (Node + stub LLM)

```bash
# from repo root
npx tsx examples/creative-coding-p5js/index.ts
```

Runs three scenarios:
1. Static rainbow (`repeat` + `rgb(...)`).
2. Animated yellow square (`tick` + `sin(t)`).
3. Retry-on-invalid (stub returns malformed DSL first; validator triggers retry with error feedback).

## Run the smoke test

```bash
npx tsx examples/creative-coding-p5js/test.ts
```

Asserts every few-shot validates and transpiles, plus negative cases (unknown keyword, wrong arity, unbalanced braces).

## Swap in a real LLM

Replace `StubAdapter` in `index.ts` with any object that satisfies `LLMAdapter`:

```ts
class WebLLMAdapter implements LLMAdapter {
  readonly id = "webllm";
  async complete(prompt: string, opts) { /* call mlc-ai/web-llm */ }
  async sampleN(prompt: string, n: number, opts) { /* batch generate */ }
}
```

See `DESIGN.md` at the repo root for the full adapter contract.

## Grammar v0 design notes

- Single source of truth: `grammar.lark` is what the LLM reads (in the prompt) AND, in a later iteration, what gets compiled to nearley for full parsing. For v0 the validator is hand-rolled to keep the example dependency-free.
- Scope was kept aggressively small: 4 shapes, 10 named colors + `rgb()`, 4 math funcs, `setup`/`tick`/`repeat` control flow. The Wang et al. result says effect is strongest for novel DSLs the model hasn't memorized — small + uncommon wins over expressive + Pythonic here.
- All transpiled output is deterministic and bounded: `repeat` requires an integer literal (no expressions), all coordinates are pure expressions over the safe variable set, no `eval`/string ops. Safe to render kids' input.
