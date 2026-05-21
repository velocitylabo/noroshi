# noroshi — minimal API design (draft)

Status: initial draft, 2026-05-17. See [src/types.ts](src/types.ts) for the authoritative signatures.

## Goals

1. Single public entry point: `generate(opts)` → `Promise<GenerateResult>`.
2. Runtime-agnostic core. No direct imports of WebLLM, transformers.js, LiteRT-LM, Node `fetch`, etc.
3. Pluggable LLM transport (`LLMAdapter`), pluggable validator (`Validator`), pluggable ranker (`Ranker`).
4. Stay close to Wang et al. 2023 in semantics: BNF/EBNF grammar injection → few-shot block (optionally with derivation) → user task.

Non-goals (for v0):

- Logits-level constrained decoding. The whole point is that we work where logits aren't reachable.
- Built-in RAG / similarity search for example selection. Caller passes a pre-selected `examples[]`.
- Multi-turn / streaming. v0 returns a single completed string.

## Public surface

```ts
import { generate, buildPrompt, StubAdapter } from "noroshi";
import type {
  LLMAdapter, Validator, Ranker,
  FewShotExample, GenerateOptions, GenerateResult,
} from "noroshi";
```

That's the entire export list.

## Why these shapes

- `LLMAdapter.complete + optional sampleN` — most runtimes do one prompt → one string. LiteRT-LM `numResponses`, OpenAI `n`, and WebLLM batch can implement `sampleN` for a one-call self-consistency speedup; otherwise core falls back to `Promise.all(complete × N)`.
- `Validator` is sync. Parsers (nearley Earley, regex) are fast and pure, so async is unjustified overhead. If a future validator needs IO (remote schema fetch), wrap it in a memoizing adapter and keep `validate()` sync.
- `Ranker.rank` is async (returns scores). Custom rerankers might call a scoring model; can't force sync.
- Self-consistency rerank default is **first-valid-wins**, not majority-vote. Reason: for novel DSLs, hash-based majority on a string output is noisy (whitespace, ordering). The validator gives the strongest signal noroshi has by default.
- Retry is opt-in (`retry.maxAttempts`). When enabled with `includeErrorInPrompt`, the validator's error string is appended to the next prompt as "Prior attempt failed validation with: …". This is the cheapest signal-boost we can give without restructuring the prompt.

## BNF parser choice — nearley

See `memory/project_parser_choice.md` for the full rationale. Summary:

- nearley accepts BNF + EBNF (`* ? +`), uses Earley → handles ambiguity and left-recursion.
- ohm-js is PEG → ordered choice, no left recursion, no ambiguity reporting. PEG syntax would diverge from what we inject in the prompt.
- We inject the grammar **into the prompt verbatim**. Grammar source format should be what LLMs see most in training (BNF / EBNF / `.lark`). nearley `.ne` is the closest JS analog of berlino's `.lark` files.

The validator stays optional and pluggable. Consumers who don't want a nearley dep can plug a regex or hand-rolled checker. The example apps (starting with `examples/creative-coding-p5js/`) will ship pre-compiled grammars (via `nearleyc`) to avoid runtime compilation cost in the browser.

## LLM adapter structure

`LLMAdapter` is the only required external integration point.

```
StubAdapter ────────────── echo / canned (built-in, for tests + offline dev)
WebLLMAdapter ──────────── wraps mlc-ai/web-llm
TransformersJsAdapter ─── wraps xenova/transformers
LiteRtLmAdapter ────────── wraps @mediapipe/tasks-genai (forwards `numResponses` via runtimeHints → sampleN)
FetchAdapter ───────────── wraps an OpenAI/Anthropic-compatible HTTP endpoint
```

Only `StubAdapter` ships in v0. The others are example-level integrations; we keep them out of `noroshi` core so the bundle stays small and runtime-neutral.

## Open questions (for v0.1+)

- Async ranker integration in `noroshi.ts::pick` — currently degrades to first-valid when a ranker is provided. Need to restructure once a real ranker arrives.
- Streaming. The `LLMAdapter` contract may grow `stream()` returning an async iterable. Defer until a user asks.
- RAG example-bank selection. Out of scope for v0; users curate `examples[]` themselves.
