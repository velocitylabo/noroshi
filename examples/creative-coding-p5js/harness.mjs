// Self-contained ESM port of validator.ts + transpile.ts + noroshi core +
// few-shots + WebLLM adapter for the static browser harness in index.html.
// Keep in sync with the TS sources — they are the authoritative
// implementations; this file exists only because the PoC ships a single-file
// static page (no bundler).

const KEYWORDS = new Set([
  "setup", "tick", "circle", "square", "rect", "line",
  "fill", "stroke", "no_fill", "no_stroke", "background",
  "rotate", "translate", "push", "pop", "repeat", "rgb",
]);
const COLOR_NAMES = new Set([
  "red","blue","green","yellow","white","black","pink","purple","orange","gray",
]);
const VARS = new Set(["t","f","w","h","mx","my","i"]);
const FUNCS = new Set(["sin","cos","random","abs"]);
const STMT_STARTERS = new Set([
  "setup","tick","circle","square","rect","line",
  "fill","stroke","no_fill","no_stroke","background",
  "rotate","translate","push","pop","repeat",
]);
const ARITY = { circle:3, square:3, rect:4, line:4, rotate:1, translate:2 };
const COLORS = {
  red:"'#e74c3c'", blue:"'#3498db'", green:"'#2ecc71'", yellow:"'#f1c40f'",
  white:"'#ffffff'", black:"'#000000'", pink:"'#ff8fb1'", purple:"'#9b59b6'",
  orange:"'#e67e22'", gray:"'#95a5a6'",
};
const VAR_MAP = {
  t:"(millis()/1000)", f:"frameCount",
  w:"width", h:"height", mx:"mouseX", my:"mouseY", i:"__i",
};

function lex(src, strict) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i+1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") { toks.push({ kind:"lbrace", value:c, pos:i }); i++; continue; }
    if (c === "}") { toks.push({ kind:"rbrace", value:c, pos:i }); i++; continue; }
    if (c === "(") { toks.push({ kind:"lparen", value:c, pos:i }); i++; continue; }
    if (c === ")") { toks.push({ kind:"rparen", value:c, pos:i }); i++; continue; }
    if (c === ",") { toks.push({ kind:"comma",  value:c, pos:i }); i++; continue; }
    if ("+-*/".includes(c)) {
      const isUnaryNum = c === "-" && /\d/.test(src[i+1] ?? "") && !isOperand(toks);
      if (!isUnaryNum) { toks.push({ kind:"op", value:c, pos:i }); i++; continue; }
    }
    if (c === "-" || /\d/.test(c)) {
      const s = i;
      if (c === "-") i++;
      while (i < src.length && /[\d.]/.test(src[i])) i++;
      toks.push({ kind:"num", value:src.slice(s,i), pos:s });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const s = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      const w = src.slice(s,i);
      if (KEYWORDS.has(w))    toks.push({ kind:"kw",    value:w, pos:s });
      else if (COLOR_NAMES.has(w)) toks.push({ kind:"color", value:w, pos:s });
      else if (VARS.has(w))   toks.push({ kind:"var",   value:w, pos:s });
      else if (FUNCS.has(w))  toks.push({ kind:"func",  value:w, pos:s });
      else if (strict) return { error: `unknown identifier "${w}" at offset ${s}` };
      else toks.push({ kind:"ident", value:w, pos:s });
      continue;
    }
    if (strict) return { error: `unexpected character "${c}" at offset ${i}` };
    i++;
  }
  return toks;
}

function isOperand(toks) {
  const last = toks[toks.length-1];
  if (!last) return false;
  return last.kind === "num" || last.kind === "var" || last.kind === "rparen" || last.value === ")";
}

export function validate(src) {
  const toks = lex(src, true);
  if (!Array.isArray(toks)) return { ok:false, error: toks.error };
  const P = mkParser(toks);
  while (P.p < toks.length) {
    const r = P.block();
    if (!r.ok) return r;
  }
  return { ok:true };
}

function mkParser(toks) {
  const P = {
    p: 0, toks,
    peek(o=0) { return toks[P.p+o]; },
    eat()     { return toks[P.p++]; },
    block() {
      const t = P.peek();
      if (!t) return { ok:true };
      if (t.kind === "kw" && (t.value === "setup" || t.value === "tick")) {
        P.eat();
        return P.brace();
      }
      return P.stmt();
    },
    brace() {
      const o = P.eat();
      if (!o || o.kind !== "lbrace") return { ok:false, error:`expected "{" at offset ${o?.pos ?? -1}` };
      while (P.peek() && P.peek().kind !== "rbrace") {
        const r = P.stmt(); if (!r.ok) return r;
      }
      const c = P.eat();
      if (!c || c.kind !== "rbrace") return { ok:false, error:"unbalanced { ... }" };
      return { ok:true };
    },
    stmt() {
      const t = P.peek();
      if (!t) return { ok:false, error:"unexpected end of input" };
      if (t.kind !== "kw") return { ok:false, error:`expected a statement keyword at offset ${t.pos}, got "${t.value}"` };
      P.eat();
      switch (t.value) {
        case "fill": case "stroke": case "background": return P.color();
        case "no_fill": case "no_stroke": case "push": case "pop": return { ok:true };
        case "rgb": return { ok:false, error:`"rgb" cannot start a statement` };
        case "rotate": case "translate":
        case "circle": case "square": case "rect": case "line": {
          const n = ARITY[t.value];
          for (let k = 0; k < n; k++) { const r = P.expr(); if (!r.ok) return r; }
          return { ok:true };
        }
        case "repeat": {
          const c = P.eat();
          if (!c || c.kind !== "num" || !/^\d+$/.test(c.value)) return { ok:false, error:`repeat expects a positive integer at offset ${c?.pos ?? -1}` };
          return P.brace();
        }
        case "setup": case "tick":
          return { ok:false, error:`"${t.value}" block is only valid at the top level` };
      }
      return { ok:false, error:`unhandled keyword "${t.value}"` };
    },
    color() {
      const t = P.peek();
      if (!t) return { ok:false, error:"expected color" };
      if (t.kind === "color") { P.eat(); return { ok:true }; }
      if (t.kind === "kw" && t.value === "rgb") {
        P.eat();
        const lp = P.eat();
        if (!lp || lp.kind !== "lparen") return { ok:false, error:`rgb expects "(" at offset ${lp?.pos ?? -1}` };
        for (let k = 0; k < 3; k++) {
          const r = P.expr(); if (!r.ok) return r;
          if (k < 2) { const cm = P.eat(); if (!cm || cm.kind !== "comma") return { ok:false, error:`rgb expects "," at offset ${cm?.pos ?? -1}` }; }
        }
        const rp = P.eat();
        if (!rp || rp.kind !== "rparen") return { ok:false, error:`rgb expects ")" at offset ${rp?.pos ?? -1}` };
        return { ok:true };
      }
      return { ok:false, error:`expected color or rgb(...) at offset ${t.pos}, got "${t.value}"` };
    },
    expr() {
      const r = P.term(); if (!r.ok) return r;
      while (P.peek()?.kind === "op" && (P.peek().value === "+" || P.peek().value === "-")) {
        P.eat(); const r2 = P.term(); if (!r2.ok) return r2;
      }
      return { ok:true };
    },
    term() {
      const r = P.factor(); if (!r.ok) return r;
      while (P.peek()?.kind === "op" && (P.peek().value === "*" || P.peek().value === "/")) {
        P.eat(); const r2 = P.factor(); if (!r2.ok) return r2;
      }
      return { ok:true };
    },
    factor() {
      const t = P.eat();
      if (!t) return { ok:false, error:"expected expression, got end of input" };
      if (t.kind === "num" || t.kind === "var") return { ok:true };
      if (t.kind === "lparen") {
        const r = P.expr(); if (!r.ok) return r;
        const rp = P.eat();
        if (!rp || rp.kind !== "rparen") return { ok:false, error:`expected ")" at offset ${rp?.pos ?? -1}` };
        return { ok:true };
      }
      if (t.kind === "func") {
        const lp = P.eat();
        if (!lp || lp.kind !== "lparen") return { ok:false, error:`${t.value} expects "("` };
        const r = P.expr(); if (!r.ok) return r;
        while (P.peek()?.kind === "comma") { P.eat(); const rk = P.expr(); if (!rk.ok) return rk; }
        const rp = P.eat();
        if (!rp || rp.kind !== "rparen") return { ok:false, error:`${t.value} expects ")"` };
        return { ok:true };
      }
      return { ok:false, error:`expected number/variable/func/"(...)" at offset ${t.pos}, got "${t.value}"` };
    },
  };
  return P;
}

// --- transpiler ---

function mkT(toks) {
  const T = {
    p: 0, toks,
    peek(o=0) { return toks[T.p+o]; },
    eat()     { return toks[T.p++]; },
    stmts(stopOnBrace) {
      const out = [];
      while (T.peek() && !(stopOnBrace && T.peek().kind === "rbrace")) {
        out.push(T.stmt());
      }
      return out;
    },
    stmt() {
      const t = T.eat();
      if (!t) return "";
      const v = t.value;
      switch (v) {
        case "background": return `background(${T.color()});`;
        case "fill":       return `fill(${T.color()});`;
        case "stroke":     return `stroke(${T.color()});`;
        case "no_fill":    return "noFill();";
        case "no_stroke":  return "noStroke();";
        case "push":       return "push();";
        case "pop":        return "pop();";
        case "rotate":     return `rotate(${T.expr()});`;
        case "translate":  return `translate(${T.expr()}, ${T.expr()});`;
        case "circle": {
          const x = T.expr(), y = T.expr(), r = T.expr();
          return `circle(${x}, ${y}, ${r} * 2);`;
        }
        case "square": { const x=T.expr(),y=T.expr(),s=T.expr(); return `square(${x}, ${y}, ${s});`; }
        case "rect":   { const x=T.expr(),y=T.expr(),w=T.expr(),h=T.expr(); return `rect(${x}, ${y}, ${w}, ${h});`; }
        case "line":   { const a=T.expr(),b=T.expr(),c=T.expr(),d=T.expr(); return `line(${a}, ${b}, ${c}, ${d});`; }
        case "repeat": {
          const n = T.eat().value; T.eat(); // {
          const body = T.stmts(true); T.eat(); // }
          return `for (let __i = 0; __i < ${n}; __i++) { ${body.join(" ")} }`;
        }
      }
      return "";
    },
    color() {
      const t = T.eat();
      if (t.value === "rgb") {
        T.eat(); const r=T.expr(); T.eat();
        const g=T.expr(); T.eat();
        const b=T.expr(); T.eat();
        return `${r}, ${g}, ${b}`;
      }
      return COLORS[t.value] ?? "'#888'";
    },
    expr() { return T.bp(0); },
    bp(min) {
      let lhs = T.factor();
      while (true) {
        const t = T.peek();
        if (!t || t.kind !== "op") break;
        const bp = (t.value === "+" || t.value === "-") ? 10 : 20;
        if (bp < min) break;
        const op = T.eat().value;
        const rhs = T.bp(bp + 1);
        lhs = `(${lhs} ${op} ${rhs})`;
      }
      return lhs;
    },
    factor() {
      const t = T.eat();
      if (t.kind === "num") return t.value;
      if (t.kind === "lparen") { const e = T.bp(0); T.eat(); return `(${e})`; }
      if (t.kind === "func") {
        T.eat(); // (
        const args = [T.bp(0)];
        while (T.peek()?.kind === "comma") { T.eat(); args.push(T.bp(0)); }
        T.eat(); // )
        return `${t.value}(${args.join(", ")})`;
      }
      if (t.kind === "var") return VAR_MAP[t.value] ?? t.value;
      return "0";
    },
  };
  return T;
}

export function transpile(src) {
  const toks = lex(src, false);
  if (!Array.isArray(toks)) throw new Error(toks.error);
  let setup = [], tick = [], top = [], hadTick = false;
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const isBlock = (t.kind === "kw" || t.kind === "ident") &&
                    (t.value === "setup" || t.value === "tick") &&
                    toks[i+1]?.kind === "lbrace";
    if (isBlock) {
      const which = t.value, start = i + 2;
      let depth = 1, j = start;
      while (j < toks.length && depth > 0) {
        if (toks[j].kind === "lbrace") depth++;
        else if (toks[j].kind === "rbrace") depth--;
        if (depth > 0) j++;
      }
      const out = mkT(toks.slice(start, j)).stmts(false);
      if (which === "setup") setup.push(...out);
      else { tick.push(...out); hadTick = true; }
      i = j + 1;
      continue;
    }
    const start = i; i++;
    let depth = 0;
    while (i < toks.length) {
      const u = toks[i];
      if (u.kind === "lbrace" || u.kind === "lparen") depth++;
      else if (u.kind === "rbrace" || u.kind === "rparen") depth--;
      else if (depth === 0 && (u.kind === "kw" || u.kind === "ident") && STMT_STARTERS.has(u.value)) break;
      i++;
    }
    top.push(...mkT(toks.slice(start, i)).stmts(false));
  }

  const setupBody = [
    `createCanvas(400, 400);`,
    ...setup,
    ...(hadTick ? [] : ["noLoop();"]),
  ].join("\n  ");
  const drawBody = (hadTick ? tick : top).join("\n  ") || "/* empty */";
  return `function setup() {\n  ${setupBody}\n}\n\nfunction draw() {\n  ${drawBody}\n}\n`;
}

// --- few-shot bank (mirrors examples.ts) ---

export const FEW_SHOTS = [
  {
    input: "Draw a red circle in the middle of the canvas.",
    derivation: [
      "start → block",
      "block → stmt",
      "stmt → bg_stmt | shape_stmt (×2)",
      "shape_stmt → fill color (red), circle expr expr expr",
    ].join("\n"),
    output: ["background white", "fill red", "circle w / 2 h / 2 50"].join("\n"),
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
    derivation: ["tick → background black, fill pink, circle mx my 30"].join("\n"),
    output: [
      "tick {",
      "  background black",
      "  fill pink",
      "  circle mx my 30",
      "}",
    ].join("\n"),
  },
];

// --- noroshi core (mirrors src/prompt.ts + src/noroshi.ts) ---

const DEFAULT_SYSTEM = [
  "You generate output strictly conforming to the grammar below.",
  "Do not include explanation, prose, code fences, or commentary —",
  "emit only the DSL string that the grammar would accept.",
].join(" ");

export function buildPrompt(p) {
  const parts = [];
  parts.push(p.systemPrompt ?? DEFAULT_SYSTEM);
  parts.push("\nGrammar (BNF/EBNF):\n```");
  parts.push(p.grammar.trim());
  parts.push("```");
  if (p.examples?.length) {
    parts.push("\nExamples:");
    for (const ex of p.examples) {
      parts.push(`Task: ${ex.input}`);
      if (ex.derivation) parts.push(`Derivation:\n${ex.derivation.trim()}`);
      parts.push(`Output:\n${ex.output.trim()}\n`);
    }
  }
  if (p.errorFeedback) {
    parts.push(
      `\nPrior attempt failed validation with: ${p.errorFeedback}\n` +
        `Produce a new output that fixes this error.\n`,
    );
  }
  parts.push(`\nTask: ${p.task}`);
  parts.push("Output:");
  return parts.join("\n");
}

export async function generate(opts) {
  const maxAttempts = opts.retry?.maxAttempts ?? 1;
  const includeErr = opts.retry?.includeErrorInPrompt ?? false;

  let attempts = 0;
  let lastError;
  let lastCandidates;
  let lastValidation;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prompt = buildPrompt({
      task: opts.task,
      grammar: opts.grammar,
      examples: opts.examples,
      systemPrompt: opts.systemPrompt,
      errorFeedback: includeErr ? lastError : undefined,
    });

    if (opts.onPrompt) opts.onPrompt(prompt, attempt);

    const n = opts.selfConsistency?.n ?? 1;
    const candidates = await _sample(opts.llm, prompt, n, opts.sample);
    attempts += candidates.length;
    lastCandidates = candidates;

    if (opts.onCandidates) opts.onCandidates(candidates, attempt);

    const picked = _pick(candidates, opts);
    lastValidation = picked.validation;

    if (!opts.validator) {
      return { output: picked.output, attempts, candidates: n > 1 ? candidates : undefined };
    }
    if (picked.validation?.ok) {
      return {
        output: picked.output,
        attempts,
        candidates: n > 1 ? candidates : undefined,
        validation: picked.validation,
      };
    }
    lastError = picked.validation && !picked.validation.ok ? picked.validation.error : "unknown";
  }

  return {
    output: lastCandidates?.[0] ?? "",
    attempts,
    candidates: lastCandidates,
    validation: lastValidation,
  };
}

async function _sample(llm, prompt, n, opts) {
  if (n === 1) return [await llm.complete(prompt, opts)];
  if (llm.sampleN) return llm.sampleN(prompt, n, opts);
  return Promise.all(Array.from({ length: n }, () => llm.complete(prompt, opts)));
}

function _pick(candidates, opts) {
  if (!opts.validator) return { output: candidates[0] ?? "" };
  for (const c of candidates) {
    const v = opts.validator.validate(c);
    if (v.ok) return { output: c, validation: v };
  }
  const fallback = candidates[0] ?? "";
  return { output: fallback, validation: opts.validator.validate(fallback) };
}

// --- validator wrapper that conforms to the noroshi Validator interface ---

export class CreativeCodingValidator {
  constructor() { this.id = "creative-coding"; }
  validate(output) { return validate(output); }
}

// --- WebLLM adapter ---
//
// Wraps an MLCEngine from @mlc-ai/web-llm. The engine is created OUTSIDE this
// adapter (so the caller controls model id / progress callback / cache); the
// adapter only knows how to drive chat.completions.create. The completion is
// post-processed to strip the most common LLM noise we observe with small
// instruct models: code fences, leading prose, trailing comments. Validator
// + retry handles the rest.

const FENCE_RE = /^\s*```[a-zA-Z]*\n?|\n?```\s*$/g;

function _cleanCompletion(raw) {
  let s = String(raw ?? "").replace(FENCE_RE, "");
  // If the model emitted "Output:" again, take what follows.
  const m = s.match(/(?:^|\n)\s*Output:\s*\n?([\s\S]*)$/);
  if (m) s = m[1];
  // Strip a leading task echo like "Task: ...\n".
  s = s.replace(/^\s*Task:[^\n]*\n+/, "");
  // Stop at a fresh "Task:" line — small models love to continue with more
  // few-shot turns. Keep only the first program.
  const next = s.match(/\n\s*Task:\s/);
  if (next) s = s.slice(0, next.index);
  return s.trim();
}

export class WebLLMAdapter {
  constructor(engine, { id = "webllm" } = {}) {
    this.id = id;
    this.engine = engine;
  }

  async complete(prompt, opts = {}) {
    const reply = await this.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.2,
      top_p: opts.topP ?? 0.95,
      max_tokens: opts.maxTokens ?? 256,
      stop: opts.stop,
    });
    const content = reply?.choices?.[0]?.message?.content ?? "";
    return _cleanCompletion(content);
  }

  async sampleN(prompt, n, opts = {}) {
    return Promise.all(Array.from({ length: n }, () => this.complete(prompt, opts)));
  }
}
