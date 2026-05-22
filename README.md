# noroshi

> Grammar Prompting for browser LLMs — constrained DSL output without fine-tuning.

`noroshi` (狼煙 / signal fire) is a JavaScript / TypeScript library that brings **Grammar Prompting** ([Wang et al. 2023](https://arxiv.org/abs/2305.19234), NeurIPS 2023) to browser-side small LLMs. It enables structured DSL output **without supervised fine-tuning**, by injecting BNF / EBNF grammars and few-shot examples into the prompt.

## Status

**Early development.** API and scope are subject to change. Pre-release versions are published to the `next` dist-tag — pin a specific version when installing.

## Install

```bash
npm install noroshi@next
```

Requires Node 20+ for development; for the library itself any modern bundler / runtime that supports ES2022 + ESM works.

## Quick start

```ts
import { generate, StubAdapter, type FewShotExample } from "noroshi";

const grammar = `
start:    greeting NAME
greeting: "hello" | "hi" | "hey"
NAME:     /[A-Za-z]+/
`;

const examples: FewShotExample[] = [
  { input: "Greet Bob.",       output: "hello Bob" },
  { input: "Say hi to Eve.",   output: "hi Eve"    },
];

const result = await generate({
  task: "Greet Alice.",
  grammar,
  examples,
  llm: new StubAdapter(() => "hello Alice"), // swap for FetchAdapter / WebLLM
  validator: {
    id: "regex",
    validate: (s) =>
      /^(hello|hi|hey) [A-Za-z]+$/.test(s.trim())
        ? { ok: true }
        : { ok: false, error: "must match `(hello|hi|hey) NAME`" },
  },
  retry: { maxAttempts: 3, includeErrorInPrompt: true },
});

console.log(result.output);     // → "hello Alice"
console.log(result.attempts);   // → 1
```

For a real LLM, swap `StubAdapter` for one of the bundled adapters:

```ts
import { FetchAdapter } from "noroshi";

const llm = new FetchAdapter({
  endpoint: "http://localhost:11434/v1", // Ollama, llama-server, vLLM, …
  model: "qwen2.5:1.5b",
});
```

A WebLLM-driven browser example (with grammar injection, retry-with-feedback, and a p5.js DSL transpiler) lives under `examples/creative-coding-p5js/` in the [source repo](https://github.com/velocitylabo/noroshi).

## Benchmark — small LLM × novel DSL

Headline result: a **1.5B-parameter on-device model** (Qwen2.5-1.5B-Instruct via local Ollama) drives noroshi from **0% to 85% valid output** on 20 novel creative-coding tasks without any fine-tuning.

| Ablation | Valid | Success rate |
|---|---:|---:|
| baseline (task only) | 0/20 | **0%** |
| + BNF grammar in prompt | 1/20 | **5%** |
| + few-shot examples | 11/20 | **55%** |
| + retry-with-feedback (×3) | 15/20 | **75%** |
| + best-of-3 with `GrammarAwareRanker` | 17/20 | **85%** |

Each row is the same noroshi pipeline with one additional component turned on, evaluated by the same post-hoc validator. Full methodology, per-row commentary, and the JSON output are under [`examples/creative-coding-p5js/bench/`](https://github.com/velocitylabo/noroshi/tree/main/examples/creative-coding-p5js/bench).

## Why

Browser-side LLMs (LiteRT-LM web, `transformers.js` + WebGPU, WebLLM) currently lack constrained decoding APIs. The closest options each have hard limitations:

- **LiteRT-LM web** (`@mediapipe/tasks-genai@0.10.22`): no `responseConstraint` / `grammar` / `schema` field exposed. Native (C++ / Python / Kotlin / Swift) has `ConversationConfig::EnableConstrainedDecoding(true)` with `llguidance` / `XGrammar`, but the Web/JS port doesn't ship it. Verified 2026-05-09.
- **`transformers.js` + WebGPU**: runs Gemma / Llama / Phi via ONNX, but no public `LogitsProcessor` for grammar masking.
- **Chrome Prompt API**: locked to Gemini Nano, can't load arbitrary models.
- **XGrammar JS API**: works but [Gemma-family models suffer infinite repetition loops when EOS is grammar-masked](https://github.com/vllm-project/vllm/issues/40080).

`noroshi` fills this gap with **prompt-side** Grammar Prompting — works on any browser LLM, any DSL, without model fine-tuning or logits-level access.

## Approach

1. **BNF / EBNF grammar injection** — the formal grammar of your target DSL is embedded in the system prompt with structural cues.
2. **Few-shot DSL examples (RAG bank)** — 3-5 working examples of the DSL retrieved by similarity (or static).
3. **Self-consistency rerank (optional)** — N-sample with verifier-based selection using `numResponses` (LiteRT-LM web) or equivalent. Falls back to JS-side parser validation.

The Wang et al. result: SFT-free, competitive with fine-tuned baselines on SMCalFlow / GeoQuery / PDDL-style DSLs. Effect is strongest for **novel DSLs with low pretraining frequency** (creative coding, domain languages); weaker for well-known formats (regex, SQL).

## Reference

- **Paper**: Wang, Bailin, et al. *Grammar Prompting for Domain-Specific Language Generation with Large Language Models.* NeurIPS 2023. [arXiv:2305.19234](https://arxiv.org/abs/2305.19234).
- **Python ref impl**: [berlino/grammar-prompting](https://github.com/berlino/grammar-prompting).
- `noroshi` is a JavaScript / TypeScript port of the Wang et al. approach for browser-side LLM environments.

## Examples

The `examples/` directory will host reference applications demonstrating `noroshi` for various DSLs (creative coding with p5.js, simplified SQL subsets, custom annotation languages, etc.).

## License

MIT — see [LICENSE](LICENSE).
