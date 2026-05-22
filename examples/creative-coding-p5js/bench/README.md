# noroshi small-LLM × creative-coding DSL bench

Goal: show that the noroshi pipeline (BNF/EBNF grammar prompting + few-shot + retry-with-feedback + best-of-N grammar-aware rerank) lets a **1B-2B class on-device LLM** produce grammar-valid DSL for a novel domain — *without* fine-tuning or logit-level constrained decoding.

## What it measures

20 natural-language tasks (see [`tasks.ts`](./tasks.ts)) cover the grammar surface (static shapes, repeat loops, `tick` animation, mouse interaction, time-based animation). Each task is run through 5 ablation cells:

| Cell | Grammar | Few-shot | Validator | Retry (×3) | Best-of-N + GrammarAwareRanker |
|---|---|---|---|---|---|
| `baseline` | – | – | – | – | – |
| `grammar-only` | ✓ | – | – | – | – |
| `+few-shot` | ✓ | ✓ | ✓ | – | – |
| `+retry` | ✓ | ✓ | ✓ | ✓ | – |
| `+rerank` | ✓ | ✓ | ✓ | ✓ | N=3 |

Every chosen output is post-hoc validated with the **same** `CreativeCodingValidator`, so the columns share one yardstick (a `baseline` cell that happens to hit valid DSL by luck still counts).

Metrics per ablation:
- **success rate** — fraction of tasks whose final output the validator accepts
- **avg attempts** — average number of LLM calls (retries and N-sampling included)
- **avg latency (ms/task)** — wall time per task on the configured endpoint

## How to run

Bring up an OpenAI-compatible LLM endpoint. Local Ollama works out of the box:

```bash
ollama serve            # if not already running
ollama pull qwen2.5:1.5b
```

Then:

```bash
# defaults: endpoint http://localhost:11434/v1, model qwen2.5:1.5b
npx tsx examples/creative-coding-p5js/bench/run.ts

# or pick a different model / endpoint / key
NOROSHI_BENCH_MODEL=llama3.2:3b \
NOROSHI_BENCH_ENDPOINT=http://localhost:11434/v1 \
npx tsx examples/creative-coding-p5js/bench/run.ts
```

Output: a per-task `✓` / `✗` log plus a summary table, and a JSON file at
`bench/results-<model>.json` for further analysis.

Expected wall time on a single 1.5B model on a CUDA RTX 2060 ≈ **5-15 minutes** depending on retry depth and N-sampling fan-out.

## Results

Frozen run, 2026-05-22, model `qwen2.5:1.5b` via local Ollama on an RTX 2060 Mobile. Raw JSON: [`results-qwen2.5_1.5b.json`](./results-qwen2.5_1.5b.json).

| Ablation | Valid | Success rate | Avg attempts | Avg latency |
|---|---:|---:|---:|---:|
| `baseline` | 0/20 | **0%** | 1.0 | 492 ms |
| `grammar-only` | 1/20 | **5%** | 1.0 | 645 ms |
| `+few-shot` | 11/20 | **55%** | 1.0 | 443 ms |
| `+retry` | 15/20 | **75%** | 1.8 | 727 ms |
| `+rerank` | 17/20 | **85%** | 4.7 | 1,539 ms |

### What each row buys

- **0 → 5%** with grammar alone: the 1.5B model can't even guess the surface from a plain task description; injecting the BNF nudges it slightly.
- **5 → 55%** with few-shot examples: the biggest single jump — derivation-first examples teach the model the DSL shape in one prompt.
- **55 → 75%** with retry-with-feedback (×3): the validator's error message, fed back into the next prompt, recovers 4 of the remaining 9 misses.
- **75 → 85%** with best-of-3 + GrammarAwareRanker: when retry alone can't close the gap, sampling N=3 and picking the deepest-parse candidate (or any valid one) clears 2 more — the rerank is what survives when retry's fix doesn't generalise.

### Caveats

- Single model (`qwen2.5:1.5b`, ~1B effective). A separate run on `llama3.2:1b`, `gemma-2-2b-it`, etc. would let us factor model-vs-pipeline.
- This is a **novel** DSL — the comparison that matters is column-vs-column (ablations on the same prompt), not against Wang et al.'s SMCalFlow / GeoQuery numbers.
- `+rerank` more than triples latency (~440 → ~1540 ms) for +10 pt. That trade is right when wall time is below the human-noticing threshold (typing pause), wrong when you're rendering on every keystroke.
