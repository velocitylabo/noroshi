# noroshi

> Grammar Prompting for browser LLMs — constrained DSL output without fine-tuning.

`noroshi` (狼煙 / signal fire) is a JavaScript / TypeScript library that brings **Grammar Prompting** ([Wang et al. 2023](https://arxiv.org/abs/2305.19234), NeurIPS 2023) to browser-side small LLMs. It enables structured DSL output **without supervised fine-tuning**, by injecting BNF / EBNF grammars and few-shot examples into the prompt.

## Status

**Early development.** API and scope are subject to change.

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
