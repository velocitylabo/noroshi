# On-device LLM × novel DSL: How a 1.5B model gets to 85% without fine-tuning

*What Wang et al.'s Grammar Prompting actually buys when you can't reach the logits, and how each component pulls its weight.*

> **Draft status (2026-05-22).** First-pass complete (§0–§9, ~2,680 words). Pre-publish editing pass still pending: tighten the hook, confirm citations, finalise lead image, decide author byline. Numbers track the frozen results under [`examples/creative-coding-p5js/bench/`](../../examples/creative-coding-p5js/bench/).

![Task to validated DSL to p5.js canvas, all running on a local 1.5B LLM](./assets/lead-image.svg)

## §0 — Hook

**0% vs 85%.** Same twenty tasks. Same prompt pipeline. Same model size class. The only thing that changed between those two numbers is which 1-2 billion-parameter open-weights LLM is on the other end of the HTTP call.

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

Now we can read the table column by column.

## §5 — Reading the table column by column

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

## §6 — The code that does it

Three pieces, each small enough to fit on screen.

### 6.1 `buildPrompt` — derivation-first few-shot

The entire prompt construction is one function:

```ts
export function buildPrompt(p: PromptInputs): string {
  const parts: string[] = [];
  parts.push(p.systemPrompt ?? DEFAULT_SYSTEM);
  parts.push("\nGrammar (BNF/EBNF):\n```");
  parts.push(p.grammar.trim());
  parts.push("```");
  if (p.examples.length > 0) {
    parts.push("\nExamples:");
    for (const ex of p.examples) {
      parts.push(`Task: ${ex.input}`);
      if (ex.derivation) parts.push(`Derivation:\n${ex.derivation.trim()}`);
      parts.push(`Output:\n${ex.output.trim()}\n`);
    }
  }
  if (p.errorFeedback) {
    parts.push(`\nPrior attempt failed validation with: ${p.errorFeedback}\n` +
               `Produce a new output that fixes this error.\n`);
  }
  parts.push(`\nTask: ${p.task}`);
  parts.push("Output:");
  return parts.join("\n");
}
```

A single string. No chat-message scaffolding, no per-provider templating. Every column in the table from `+grammar` through `+rerank` uses this exact function — the columns differ only in what gets passed in.

### 6.2 Retry with feedback

The retry loop is the next twenty lines, inside `generate()`:

```ts
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const prompt = buildPrompt({
    task, grammar, examples,
    errorFeedback: includeErr ? lastError : undefined,
  });
  const candidates = await sample(opts.llm, prompt, n, opts.sample);
  const picked = await pick(candidates, opts);

  if (picked.validation?.ok) return { output: picked.output, attempts, ... };

  lastError = picked.validation && !picked.validation.ok
    ? picked.validation.error
    : "unknown";
}
```

The crucial line is `errorFeedback: includeErr ? lastError : undefined`. When validation fails on attempt *n*, the *n+1*-th call to `buildPrompt` will inject the validator's exact error string (`rgb expects "," at offset 30, got ")"`) into the prompt. That's what got us +20pt on the Qwen row.

### 6.3 `GrammarAwareRanker`

The ranker that scores best-of-N candidates is the smallest piece — twenty lines for the whole class:

```ts
export class GrammarAwareRanker implements Ranker {
  readonly id = "grammar-aware";

  async rank(
    candidates: string[],
    context?: { validations?: ValidationResult[] },
  ): Promise<number[]> {
    const validations = context?.validations;
    return candidates.map((c, i) => {
      const v = validations?.[i];
      if (!v) return c.length;
      if (v.ok) return 0;
      const offset = typeof v.errorOffset === "number" ? v.errorOffset : 0;
      return Math.max(1, c.length - offset);
    });
  }
}
```

Three rules. Validation succeeds → score 0 (always best). Validation fails → score equals how much input the parser had to throw away (`len - errorOffset`). No validation context → fall back to length (prefer shorter, on the heuristic that a short hallucination is less bad than a long one). The whole reranker is what got us the final +10pt on Qwen and the +30pt on Gemma.

Three pieces, ~200 lines together, no fine-tuning, no logit access, no model-specific anything. Everything else in the noroshi repo — adapters, the example app, the safety checker around `new Function`, the test suite — is plumbing around these three shapes.

## §7 — What this doesn't fix

Four boundaries worth naming explicitly:

- **The Llama row is unsolved.** I tried two things off the page (a different grammar header with no rule named `start`, heavier derivation labelling on the few-shot block) and neither dislodged the prior. This may be specific to Llama-3.2-1B's instruct-tuning, or it may be a general fragility of 1B Llama-family models on novel BNF. Open question, plausibly worth a follow-up post.
- **Latency.** `+rerank` triples-to-10× wall time per task. Qwen goes from 440ms to 1.5s, Gemma from 0.9s to 7.2s, Llama from 2s to 18s. Acceptable for one-shot generations behind a "Generate" button; wrong for keystroke-level interactivity where you'd want N=1 with no retry.
- **The grammar guarantee is still soft.** Outlines (with a token-level DFA) and WebLLM (with its WASM CFG mode) give a true grammar guarantee at the cost of logit access. noroshi gives a near-guarantee — 85% on the model that responds, less on the others — at the cost of latency. That tradeoff is right for the runtimes where logits aren't reachable (Apple Foundation Models, Chrome Prompt API, any OpenAI-compatible endpoint), wrong where they are.
- **Single-domain bench.** noroshi-creative is one small DSL. Wang et al.'s numbers come from SMCalFlow, GeoQuery, SMILES — domains with very different difficulty profiles and very different ambient training-data exposure. The ablation curve shape held here; whether it holds on a denser DSL like SQL or a more obscure one like a planning-domain definition language is an open empirical question.

## §8 — Try it

```bash
npm install noroshi@next
```

Smallest possible loop, no network, just to see the shape:

```ts
import { generate, StubAdapter } from "noroshi";

const result = await generate({
  task: "Greet Alice.",
  grammar: `start: "hello" NAME\nNAME: /[A-Za-z]+/`,
  examples: [{ input: "Greet Bob", output: "hello Bob" }],
  llm: new StubAdapter(() => "hello Alice"),
});
```

Real loop, against a local Ollama:

```ts
import { generate, FetchAdapter, GrammarAwareRanker } from "noroshi";

const llm = new FetchAdapter({
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5:1.5b",
});

const result = await generate({
  task, grammar, examples,
  llm, validator,
  retry: { maxAttempts: 3, includeErrorInPrompt: true },
  selfConsistency: { n: 3, ranker: new GrammarAwareRanker() },
});
```

Repo: [velocitylabo/noroshi](https://github.com/velocitylabo/noroshi). The creative-coding example with the live browser harness is under [`examples/creative-coding-p5js/`](https://github.com/velocitylabo/noroshi/tree/main/examples/creative-coding-p5js). MIT.

## §9 — Closing

The interesting finding here isn't that 85% is a high number — it's not, GPT-4 would get higher on a harder DSL, and the noroshi-creative DSL is deliberately small. The interesting finding is that **the entire ablation curve survives at a 100× drop in model size**. Each piece of the Grammar Prompting pipeline — the BNF prompt, the derivation-first few-shot, the validator-feedback retry, the grammar-aware best-of-N — adds roughly the same magnitude of lift it adds at GPT-3.5 scale, just from a lower floor.

That matters because the on-device LLM era is starting now. Apple Foundation Models ships with iOS 26 / macOS 26. Chrome Prompt API hits Stable in Chrome 145-150. Apps built on those runtimes will want structured output, will not get CFG-level constrained decoding from the platform, and will run on 1-3B models that look very much like the Qwen and Gemma rows of the table above. Prompt-side Grammar Prompting is one of the only techniques that survives that constraint set.

noroshi is one implementation. The technique is general — if you're building creative tooling, educational software, or any feature that needs DSL output on a small or browser-resident model, the three pieces in §6 will get you most of the way there. If you try it on a domain I haven't, I'd genuinely like to see your numbers.
