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

Frozen runs, 2026-05-22, via local Ollama on an RTX 2060 Mobile (6 GB).

### Success rate × model × ablation

| Model | Size | baseline | +grammar | +few-shot | +retry | **+rerank** |
|---|---:|---:|---:|---:|---:|---:|
| `qwen2.5:1.5b`  | 0.99 GB |  0% |  5% | **55%** | **75%** | **85%** |
| `gemma2:2b`     | 1.6 GB  |  0% | 10% |  30% |  45% | **75%** |
| `llama3.2:1b`   | 1.3 GB  |  0% |  0% |   0% |   0% |  **0%** |

Raw JSON: [`results-qwen2.5_1.5b.json`](./results-qwen2.5_1.5b.json), [`results-gemma2_2b.json`](./results-gemma2_2b.json), [`results-llama3.2_1b.json`](./results-llama3.2_1b.json).

### Latency (avg ms / task)

| Model | baseline | +grammar | +few-shot | +retry | +rerank |
|---|---:|---:|---:|---:|---:|
| `qwen2.5:1.5b`  |  492 |  645 |   443 |   727 |  1,539 |
| `gemma2:2b`     | 2,193 | 1,646 |   947 | 3,175 |  7,244 |
| `llama3.2:1b`   | 1,776 | 2,121 | 2,095 | 6,157 | 17,839 |

### Per-row reading (qwen2.5:1.5b — best-performing model)

- **0 → 5%** with grammar alone: a 1.5B model can't guess the DSL surface from the task description; the BNF nudges it slightly.
- **5 → 55%** with few-shot examples: biggest single jump — derivation-first examples teach the DSL shape in one prompt.
- **55 → 75%** with retry-with-feedback (×3): the validator's error, fed back into the next prompt, recovers 4 of the remaining 9 misses.
- **75 → 85%** with best-of-3 + `GrammarAwareRanker`: when retry alone can't close the gap, sampling N=3 and picking the deepest-parse candidate clears 2 more.

### What the multi-model row teaches us

The two extra models split clean into "the pipeline amplifies what's there" vs "there's nothing to amplify":

- **`gemma2:2b` (75% at +rerank)** rides the same ablation curve as `qwen2.5:1.5b`, just lower and slower — bigger model, more parameters spent on irrelevant capability, similar shape.
- **`llama3.2:1b` (0% everywhere)** flatlines. Inspection shows it greedily echoes the leading rule of the grammar (`start: block+` → output starts with the literal token `start` → lex fails at offset 0). retry-with-feedback doesn't shake it loose; best-of-3 doesn't either, because all N samples make the same mistake. **noroshi can't amplify a model that doesn't have the DSL surface in its prior.**

This is the headline finding of the multi-model run: the pipeline is roughly model-agnostic, but **model selection still dominates**. For a creative-coding application targeting an on-device 1-2B model, default to Qwen-2.5 family unless there's a hard reason not to.

### Caveats

- This is a **novel** DSL — the comparison that matters is column-vs-column (ablations on the same prompt) and row-vs-row (model-vs-model on the same prompt), not against Wang et al.'s SMCalFlow / GeoQuery / PDDL numbers (very different domain difficulty and model class).
- `+rerank` triples to 10× latency for +10-30 pt on the models that respond at all. Right when wall time is below the human-noticing threshold (one-shot prompt), wrong for per-keystroke interactivity.
- The `llama3.2:1b` 0% may be improvable — possibly with a different grammar header (no `start:` rule name), heavier few-shot derivation labelling, or just a bigger Llama-family model. Not worth optimising before validating with users which model they actually plan to ship.
