# On-device LLM × novel DSL: How a 1.5B model gets to 85% without fine-tuning

*What Wang et al.'s Grammar Prompting actually buys when you can't reach the logits, and how each component pulls its weight.*

> **Draft status (2026-05-22).** Sections §0–§4 are first-pass. §5 (per-row commentary) onward is in progress. Numbers in this draft track the frozen results under [`examples/creative-coding-p5js/bench/`](../../examples/creative-coding-p5js/bench/).

## §0 — Hook

A 1.5-billion-parameter model running locally on a 4-year-old laptop GPU generates grammar-valid programs in a novel DSL on **17 out of 20 tasks** — no fine-tuning, no access to the model's logits. Swap the model for a 1.3-billion-parameter one from a different family, keep everything else identical, and the success rate drops to **zero**.

| Model | Size | baseline | +grammar | +few-shot | +retry | +rerank |
|---|---:|---:|---:|---:|---:|---:|
| **Qwen2.5-1.5B-Instruct** | 0.99 GB | 0% | 5% | 55% | 75% | **85%** |
| **Gemma-2-2B-it** | 1.60 GB | 0% | 10% | 30% | 45% | **75%** |
| **Llama-3.2-1B-Instruct** | 1.30 GB | 0% | 0% | 0% | 0% | **0%** |

Two things in this table interest me:

1. **The ablation curve survives at 100× smaller model size than the original Grammar Prompting paper.** Wang et al. (NeurIPS 2023) demonstrated this on GPT-3.5 and GPT-4. The same shape holds on a model you can run in a browser tab.
2. **The Llama row is exactly zero through every column.** The pipeline is supposed to amplify the model — it can't amplify zero.

This post walks every cell of that table: the four cheap techniques the columns add, the failure mode Llama exhibits (it has a specific, instructive shape), and what each piece costs in latency. Everything is reproducible — code is [noroshi](https://github.com/velocitylabo/noroshi), raw bench JSON is in the repo.

## §1 — Why this matters in 2026

Three trends are colliding.

**Big LLMs are getting native structured output, but only for JSON.** GPT-5.2 ships invalid-token masking against a JSON Schema. Claude has `anthropic-beta: structured-outputs-2025-11-13`. Apple's Guided Generation is built into the Foundation Models framework. The Chrome Prompt API supports `responseConstraint` with JSON Schema and regex. None of these expose a context-free grammar interface, and none have it on the roadmap.

**Small on-device models are about to be everywhere.** Apple Foundation Models is ~3B and ships with every iOS 26 / macOS 26 device. Chrome Prompt API exposes Gemini Nano (~4 GB) in extensions today, going Stable in Chrome 145-150 (late 2026). WebLLM and Ollama already cover the long tail.

**The intersection is empty.** If you want CFG-level structured output — anything more expressive than JSON Schema — on a 1-3B on-device model, there is no built-in solution. XGrammar lives inside WebLLM's WASM runtime but doesn't reach Apple FM or Chrome Prompt API. The grammar-aware decoders that ship in vLLM and TensorRT-LLM require server-class GPUs.

This is the niche Wang et al.'s Grammar Prompting was made for, even though they didn't frame it that way in 2023. Their technique works at the prompt layer — no logit access required — which is exactly the layer you have on these new on-device runtimes. The question was whether the technique survives the 100× drop in model scale.

The table above is one data point that says: mostly, yes.

## §2 — What Grammar Prompting actually is

Wang, Hu, Saparov, Kim, and Wang published [*Grammar Prompting for Domain-Specific Language Generation with Large Language Models*](https://arxiv.org/abs/2305.19234) at NeurIPS 2023. The paper's claim, distilled: if you write a domain-specific language's BNF/EBNF grammar into the prompt, give the model a few examples where each example includes the **derivation** (parse tree skeleton) before the surface program, and let the model imitate that derivation→surface pattern, it produces dramatically more grammar-valid output than chain-of-thought prompting alone. On SMCalFlow, GeoQuery, and SMILES they reported single-digit-percent improvements at scale, and double-digit improvements on the novel DSLs the model hadn't seen in pre-training.

Four moving parts make it work:

1. **Inject the grammar into the system prompt verbatim.** Not a paraphrase, not a JSON Schema translation — the actual `.lark` or `.bnf` source. Models have seen enough BNF in training data to treat it as a structural anchor.
2. **Few-shot examples that lead with derivation.** Each example renders the parse tree skeleton (`start → block, block → bg_stmt, bg_stmt → "background" color, …`) before the final program text. The model is being taught a structured-thinking step it would not otherwise take.
3. **Validate.** Parse the candidate against the same grammar.
4. **Repair on failure.** Either resample, or feed the validator's specific error back into the prompt and ask for a corrected output.

The technique works because models have a strong prior for "if I just saw a grammar definition and three derivation→output pairs, the next derivation→output pair should obey those constraints." That prior is what's being amplified.

Here is the prompt anatomy noroshi sends for the task *"Three pink circles in a horizontal row"* on the noroshi-creative DSL — abbreviated for space, but every section is present in the real prompt:

```text
You generate output strictly conforming to the grammar below.

Grammar (BNF/EBNF):
start: block+
block: setup_block | tick_block | stmt
stmt:  shape_stmt | color_stmt | bg_stmt | repeat_stmt
shape_stmt: "circle" expr expr expr
          | "square" expr expr expr
          ...

Examples:
Task: Draw a red circle in the middle of the canvas.
Derivation:
  start → block
  block → bg_stmt, shape_stmt, shape_stmt
  shape_stmt → "circle" expr expr expr
Output:
  background white
  fill red
  circle w / 2 h / 2 50
[… three more examples …]

Task: Three pink circles in a horizontal row.
Output:
```

The model completes after `Output:`. If the completion parses, ship it. If not, the next section is what we do with the failure.

That's the entire technique. Everything below — the retry loop, the parallel sampling, the ranker — is leverage on top of that one shape.

## §3 — The DSL we're going to generate

The benchmark target is a small creative-coding DSL the models almost certainly haven't seen in pre-training. Its entire grammar fits in twenty lines:

```text
start: block+
block: setup_block | tick_block | stmt
setup_block: "setup" "{" stmt* "}"
tick_block:  "tick"  "{" stmt* "}"

stmt: shape_stmt | color_stmt | bg_stmt | repeat_stmt
shape_stmt: "circle" expr expr expr      // x y radius
          | "square" expr expr expr      // x y size
          | "rect"   expr expr expr expr // x y w h
          | "line"   expr expr expr expr
color_stmt: "fill" color | "stroke" color | "no_fill" | "no_stroke"
bg_stmt:    "background" color
repeat_stmt: "repeat" INT "{" stmt* "}"

expr: term (("+" | "-") term)*
term: factor (("*" | "/") factor)*
factor: NUMBER | VAR | "(" expr ")" | func_call

FUNC:       "sin" | "cos" | "random" | "abs"
VAR:        "t" | "f" | "w" | "h" | "mx" | "my" | "i"
COLOR_NAME: "red" | "blue" | "green" | "yellow" | "white"
          | "black" | "pink" | "purple" | "orange" | "gray"
```

A valid program in this DSL transpiles deterministically to p5.js. A model that emits "Three pink circles in a horizontal row" should produce something like:

```text
background white
fill pink
repeat 3 {
  circle i * 100 + 100 h / 2 30
}
```

…which becomes a p5 sketch with three pink dots across the canvas. Twenty-token grammar, twenty-token program, one rendered frame. The whole DSL exists for one reason: to be small enough that a 1-2B model has a fighting chance, and novel enough that the model can't just regurgitate training data.

This is the *DSL* axis of the bench. The *task* axis is twenty natural-language prompts — "A green dot that follows the mouse," "Six small green circles in a row near the top," "Background that flashes between black and white over time" — none of which overlap with the four few-shot examples the prompt carries. We're testing the pipeline's ability to generalise inside the grammar, not its ability to copy from the prompt.

## §4 — The ablation ladder

Five cells. Each cell is the same noroshi pipeline with one component turned on.

| Cell | Adds | Notes |
|---|---|---|
| `baseline` | (just the task description) | Reference floor — no grammar, no few-shot, no validator |
| `grammar-only` | + BNF in the prompt | The grammar is visible to the model but unused for validation |
| `+few-shot` | + 4 derivation-first examples + validator on the chosen output | The original Wang et al. setup, single attempt |
| `+retry` | + retry up to 3 attempts, with the validator's error appended to the next prompt | Sequential repair loop |
| `+rerank` | + best-of-3 sampling, picked by a grammar-aware ranker | Parallel sampling instead of (well, alongside) sequential repair |

Every output is evaluated by the same post-hoc validator regardless of whether the inner pipeline used a validator. This matters: a `baseline` cell that gets lucky and lands on valid DSL still scores as a pass. Cells share one yardstick.

Three models from local Ollama on an RTX 2060 Mobile (6 GB VRAM): `qwen2.5:1.5b`, `gemma2:2b`, `llama3.2:1b`. Twenty tasks each. Five ablations each. Total cells: 300. The slowest ablation (Llama × `+rerank`) takes 18 seconds per task; the fastest (Qwen × `+few-shot`) takes 440 ms. Reproducible in one line:

```bash
ollama pull qwen2.5:1.5b   # or gemma2:2b / llama3.2:1b
npx tsx examples/creative-coding-p5js/bench/run.ts
```

Now we can read the table row by row.

## §5 — Reading the table row by row

| Model | baseline | +grammar | +few-shot | +retry | +rerank |
|---|---:|---:|---:|---:|---:|
| Qwen2.5-1.5B | 0% | 5% | **55%** | **75%** | **85%** |
| Gemma-2-2B | 0% | 10% | 30% | 45% | **75%** |
| Llama-3.2-1B | 0% | 0% | 0% | 0% | **0%** |

**`baseline`: 0% everywhere.** Given only the natural-language task, a 1-2B instruct model has no prior for the noroshi-creative DSL. The outputs are mostly English prose ("Sure! To draw three pink circles, you would…"), CSS/HTML snippets, or Python fragments. The grammar exists nowhere in the model's training distribution, so without an explicit signal of what shape the answer should take, there is no signal at all. This is the reference floor — every gain above it is the pipeline doing work, not the model.

**`+grammar`: 5–10%, with one model still at zero.** Pasting the twenty-line BNF into the system prompt nudges Qwen from 0 → 5% and Gemma from 0 → 10%. The model now knows there *is* a grammar, but without examples it lacks the bridge from "here is a CFG" to "produce a sentence accepted by it." A handful of trivially short programs happen to land on valid output. Llama stays at zero — the grammar by itself isn't enough of a signal to override its priors about what a code completion should look like.

**`+few-shot`: 55%, 30%, 0% — the biggest single jump on every model that responds.** Adding four derivation-first examples (`start → block, block → bg_stmt, bg_stmt → "background" color → background white`) is what teaches the model the DSL's surface. Qwen jumps +50pt, Gemma +20pt. This is Wang et al.'s headline finding reproduced at 100× smaller model size: the *derivation* line in the few-shot examples does more work than the grammar itself. Llama still at zero — more on that in a moment.

**`+retry`: 75%, 45%. Error feedback is dense signal for small models.** When validation fails, we append the validator's specific error (`rgb expects "," at offset 30, got ")"`) to the next prompt and ask again. On Qwen, this recovers 4 of the 9 remaining misses; on Gemma, 3 of 14. The error message functions as a *targeted* in-context update — it tells the model not just "you were wrong" but "you were wrong at exactly this token, expecting exactly this thing." Models this size respond to that pointer surprisingly well.

**`+rerank`: 85%, 75%. Best-of-3 with a grammar-aware ranker is what catches what retry can't.** Some misses are stubborn — the model gives the same wrong answer three retries in a row, and the validator's error doesn't dislodge it. Sampling N=3 in parallel and picking either (a) any valid candidate, or (b) the deepest-parse failure breaks that loop. The ranker's score is `max(1, len - errorOffset)`, so a candidate that parsed 40 characters before failing beats one that died at character 3. Qwen gains +10pt, Gemma +30pt — Gemma benefits more, suggesting its sampling variance is higher and parallelism buys it more diversity than Qwen, which is already pretty consistent.

**Llama, all five columns, exactly zero.** The Llama row is the most interesting cell of the table because the failure mode is so specific. Inspect [`results-llama3.2_1b.json`](https://github.com/velocitylabo/noroshi/blob/main/examples/creative-coding-p5js/bench/results-llama3.2_1b.json) and every output across every ablation starts with the literal token **`start`** — followed by the lex error `unknown identifier "start" at offset 0`. The model has memorised the grammar's leading rule name (`start: block+`) and emits `start` as its first token. Retry doesn't fix it: the next two attempts also begin with `start`. Best-of-3 doesn't fix it either: all three parallel samples begin with `start`. The pipeline depends on having any non-zero probability mass on grammar-valid continuations to amplify — when the model is anchored on a single wrong token with overwhelming confidence, there is nothing for retry or rerank to grip. **noroshi can amplify a model's grammar prior, but it cannot create one.**

<!-- TODO §6 — The code that does it (~400 words) -->
<!-- TODO §7 — What this doesn't fix (~200 words) -->
<!-- TODO §8 — Try it (~100 words) -->
<!-- TODO §9 — Closing (~150 words) -->
