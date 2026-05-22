import type { Validator, ValidationResult } from "../../src/index.js";

/**
 * Minimal validator for the noroshi-creative DSL.
 *
 * NOT a full parser — does enough to catch common LLM mistakes:
 *  - unknown tokens (typos, extra English words)
 *  - unbalanced braces / parens
 *  - shapes called with wrong arity
 *  - bare numbers / unknown function names in expressions
 *
 * Once nearley is wired in, this can be replaced by a real parser. For PoC
 * the goal is "good enough to drive retry-with-feedback".
 */

const KEYWORDS = new Set([
  "setup", "tick",
  "circle", "square", "rect", "line",
  "fill", "stroke", "no_fill", "no_stroke",
  "background",
  "rotate", "translate", "push", "pop",
  "repeat",
  "rgb",
]);

const COLOR_NAMES = new Set([
  "red", "blue", "green", "yellow",
  "white", "black", "pink", "purple",
  "orange", "gray",
]);

const VARS = new Set(["t", "f", "w", "h", "mx", "my", "i"]);
const FUNCS = new Set(["sin", "cos", "random", "abs"]);

/** Token shape coming out of the lexer below. */
interface Tok {
  kind:
    | "kw" | "color" | "var" | "func"
    | "num" | "lbrace" | "rbrace" | "lparen" | "rparen"
    | "comma" | "op";
  value: string;
  pos: number;
}

interface LexError { error: string; errorOffset: number }

function lex(src: string): Tok[] | LexError {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") { toks.push({ kind: "lbrace", value: c, pos: i }); i++; continue; }
    if (c === "}") { toks.push({ kind: "rbrace", value: c, pos: i }); i++; continue; }
    if (c === "(") { toks.push({ kind: "lparen", value: c, pos: i }); i++; continue; }
    if (c === ")") { toks.push({ kind: "rparen", value: c, pos: i }); i++; continue; }
    if (c === ",") { toks.push({ kind: "comma", value: c, pos: i }); i++; continue; }
    if ("+-*/".includes(c)) {
      // Could be a unary minus on a number — let the parser sort it out.
      // For "-" followed by a digit with no preceding operand, treat as part
      // of a number to allow negative literals.
      if (c === "-" && /\d/.test(src[i + 1] ?? "") && !isOperandTail(toks)) {
        // fall through to number branch
      } else {
        toks.push({ kind: "op", value: c, pos: i });
        i++;
        continue;
      }
    }
    if (c === "-" || /\d/.test(c)) {
      const start = i;
      if (c === "-") i++;
      while (i < src.length && /[\d.]/.test(src[i]!)) i++;
      toks.push({ kind: "num", value: src.slice(start, i), pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      const w = src.slice(start, i);
      if (KEYWORDS.has(w)) toks.push({ kind: "kw", value: w, pos: start });
      else if (COLOR_NAMES.has(w)) toks.push({ kind: "color", value: w, pos: start });
      else if (VARS.has(w)) toks.push({ kind: "var", value: w, pos: start });
      else if (FUNCS.has(w)) toks.push({ kind: "func", value: w, pos: start });
      else return { error: `unknown identifier "${w}" at offset ${start}`, errorOffset: start };
      continue;
    }
    return { error: `unexpected character "${c}" at offset ${i}`, errorOffset: i };
  }
  return toks;
}

function isOperandTail(toks: Tok[]): boolean {
  const last = toks[toks.length - 1];
  if (!last) return false;
  return last.kind === "num" || last.kind === "var" || last.kind === "rparen";
}

/** Arity of each shape/transform keyword (in expressions, post-keyword). */
const ARITY: Record<string, number> = {
  circle: 3, square: 3, rect: 4, line: 4,
  rotate: 1, translate: 2,
};

class Parser {
  private p = 0;
  private lastPos = 0;
  constructor(private readonly toks: Tok[]) {}

  peek(o = 0): Tok | undefined { return this.toks[this.p + o]; }
  eat(): Tok | undefined {
    const t = this.toks[this.p++];
    if (t) this.lastPos = t.pos;
    return t;
  }

  /** Build a failure with errorOffset filled from the supplied pos or the
   *  most recently consumed token's position. */
  private fail(error: string, posHint?: number): ValidationResult {
    return {
      ok: false,
      error,
      errorOffset: typeof posHint === "number" ? posHint : this.lastPos,
    };
  }

  parse(): ValidationResult {
    while (this.p < this.toks.length) {
      const r = this.block();
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  block(): ValidationResult {
    const t = this.peek();
    if (!t) return { ok: true };
    if (t.kind === "kw" && (t.value === "setup" || t.value === "tick")) {
      this.eat();
      return this.braceBlock();
    }
    return this.stmt();
  }

  braceBlock(): ValidationResult {
    const open = this.eat();
    if (!open || open.kind !== "lbrace") {
      return this.fail(`expected "{" at offset ${open?.pos ?? -1}`, open?.pos);
    }
    while (this.peek() && this.peek()!.kind !== "rbrace") {
      const r = this.stmt();
      if (!r.ok) return r;
    }
    const close = this.eat();
    if (!close || close.kind !== "rbrace") {
      return this.fail("unbalanced { ... } block");
    }
    return { ok: true };
  }

  stmt(): ValidationResult {
    const t = this.peek();
    if (!t) return this.fail("unexpected end of input");
    if (t.kind !== "kw") {
      return this.fail(`expected a statement keyword at offset ${t.pos}, got "${t.value}"`, t.pos);
    }
    this.eat();
    switch (t.value) {
      case "fill":
      case "stroke":
      case "background":
        return this.color();
      case "no_fill":
      case "no_stroke":
      case "push":
      case "pop":
        return { ok: true };
      case "rgb":
        return this.fail(`"rgb" cannot start a statement (use it after fill/stroke/background)`, t.pos);
      case "rotate":
      case "translate":
      case "circle":
      case "square":
      case "rect":
      case "line": {
        const n = ARITY[t.value]!;
        for (let k = 0; k < n; k++) {
          const r = this.expr();
          if (!r.ok) return r;
        }
        return { ok: true };
      }
      case "repeat": {
        const count = this.eat();
        if (!count || count.kind !== "num" || !/^\d+$/.test(count.value)) {
          return this.fail(`repeat expects a positive integer at offset ${count?.pos ?? -1}`, count?.pos);
        }
        return this.braceBlock();
      }
      case "setup":
      case "tick":
        return this.fail(`"${t.value}" block is only valid at the top level`, t.pos);
    }
    return this.fail(`unhandled keyword "${t.value}"`, t.pos);
  }

  color(): ValidationResult {
    const t = this.peek();
    if (!t) return this.fail("expected color");
    if (t.kind === "color") { this.eat(); return { ok: true }; }
    if (t.kind === "kw" && t.value === "rgb") {
      this.eat();
      const lp = this.eat();
      if (!lp || lp.kind !== "lparen") return this.fail(`rgb expects "(" at offset ${lp?.pos ?? -1}`, lp?.pos);
      for (let k = 0; k < 3; k++) {
        const r = this.expr();
        if (!r.ok) return r;
        if (k < 2) {
          const c = this.eat();
          if (!c || c.kind !== "comma") return this.fail(`rgb expects "," at offset ${c?.pos ?? -1}`, c?.pos);
        }
      }
      const rp = this.eat();
      if (!rp || rp.kind !== "rparen") return this.fail(`rgb expects ")" at offset ${rp?.pos ?? -1}`, rp?.pos);
      return { ok: true };
    }
    return this.fail(`expected color name or rgb(...) at offset ${t.pos}, got "${t.value}"`, t.pos);
  }

  /** expr → term (("+"|"-") term)* */
  expr(): ValidationResult {
    const r = this.term();
    if (!r.ok) return r;
    while (this.peek()?.kind === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      this.eat();
      const r2 = this.term();
      if (!r2.ok) return r2;
    }
    return { ok: true };
  }

  /** term → factor (("*"|"/") factor)* */
  term(): ValidationResult {
    const r = this.factor();
    if (!r.ok) return r;
    while (this.peek()?.kind === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      this.eat();
      const r2 = this.factor();
      if (!r2.ok) return r2;
    }
    return { ok: true };
  }

  factor(): ValidationResult {
    const t = this.eat();
    if (!t) return this.fail("expected expression, got end of input");
    if (t.kind === "num" || t.kind === "var") return { ok: true };
    if (t.kind === "lparen") {
      const r = this.expr();
      if (!r.ok) return r;
      const rp = this.eat();
      if (!rp || rp.kind !== "rparen") return this.fail(`expected ")" at offset ${rp?.pos ?? -1}`, rp?.pos);
      return { ok: true };
    }
    if (t.kind === "func") {
      const lp = this.eat();
      if (!lp || lp.kind !== "lparen") return this.fail(`${t.value} expects "(" at offset ${lp?.pos ?? -1}`, lp?.pos);
      // at least one arg
      const r = this.expr();
      if (!r.ok) return r;
      while (this.peek()?.kind === "comma") {
        this.eat();
        const rk = this.expr();
        if (!rk.ok) return rk;
      }
      const rp = this.eat();
      if (!rp || rp.kind !== "rparen") return this.fail(`${t.value} expects ")" at offset ${rp?.pos ?? -1}`, rp?.pos);
      return { ok: true };
    }
    return this.fail(`expected number, variable, function call, or "(...)" at offset ${t.pos}, got "${t.value}"`, t.pos);
  }
}

export class CreativeCodingValidator implements Validator {
  readonly id = "creative-coding-v0";

  validate(src: string): ValidationResult {
    const toks = lex(src);
    if (!Array.isArray(toks)) {
      return { ok: false, error: toks.error, errorOffset: toks.errorOffset };
    }
    return new Parser(toks).parse();
  }
}
