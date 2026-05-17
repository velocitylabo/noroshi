/**
 * noroshi-creative DSL → p5.js source.
 *
 * Strategy: tokenise once, walk linearly mirroring the validator's grammar.
 * The transpiler trusts that input has already been validated; behavior on
 * invalid input is undefined.
 *
 * Output shape:
 *
 *   function setup() { createCanvas(W, H); <SETUP_BODY> }
 *   function draw()  { <TICK_BODY_OR_FULL_PROGRAM> }
 *
 * If the program contains no `setup`/`tick` blocks, all top-level statements
 * are emitted into draw() ONCE — i.e. `noLoop()` is called at the end of
 * setup. Mixing top-level stmts with a `tick` block puts top-level stmts in
 * setup; with no `tick`, draw is single-shot.
 */

const CANVAS_W = 400;
const CANVAS_H = 400;

interface Tok { kind: string; value: string }

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if ("{}(),".includes(c)) { toks.push({ kind: c, value: c }); i++; continue; }
    if ("+-*/".includes(c)) {
      if (c === "-" && /\d/.test(src[i + 1] ?? "") && !isOperand(toks)) {
        // fallthrough → number
      } else {
        toks.push({ kind: "op", value: c });
        i++;
        continue;
      }
    }
    if (c === "-" || /\d/.test(c)) {
      const s = i;
      if (c === "-") i++;
      while (i < src.length && /[\d.]/.test(src[i]!)) i++;
      toks.push({ kind: "num", value: src.slice(s, i) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const s = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      toks.push({ kind: "ident", value: src.slice(s, i) });
      continue;
    }
    // unknown char — skip defensively (validator should have caught it)
    i++;
  }
  return toks;
}

function isOperand(toks: Tok[]): boolean {
  const last = toks[toks.length - 1];
  if (!last) return false;
  return last.kind === "num" || last.kind === "ident" || last.value === ")";
}

const COLORS: Record<string, string> = {
  red: "'#e74c3c'", blue: "'#3498db'", green: "'#2ecc71'",
  yellow: "'#f1c40f'", white: "'#ffffff'", black: "'#000000'",
  pink: "'#ff8fb1'", purple: "'#9b59b6'", orange: "'#e67e22'",
  gray: "'#95a5a6'",
};

const VAR_MAP: Record<string, string> = {
  t: "(millis()/1000)",
  f: "frameCount",
  w: "width",
  h: "height",
  mx: "mouseX",
  my: "mouseY",
  i: "__i",
};

class Transpiler {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}
  peek(o = 0): Tok | undefined { return this.toks[this.p + o]; }
  eat(): Tok | undefined { return this.toks[this.p++]; }

  /** Transpile a sequence of stmts until brace close or EOF. */
  stmts(stopOnBrace: boolean): string[] {
    const out: string[] = [];
    while (this.peek() && !(stopOnBrace && this.peek()!.kind === "}")) {
      out.push(this.stmt());
    }
    return out;
  }

  stmt(): string {
    const t = this.eat()!;
    if (t.kind !== "ident") return "";
    switch (t.value) {
      case "background": return `background(${this.color()});`;
      case "fill":       return `fill(${this.color()});`;
      case "stroke":     return `stroke(${this.color()});`;
      case "no_fill":    return "noFill();";
      case "no_stroke":  return "noStroke();";
      case "push":       return "push();";
      case "pop":        return "pop();";
      case "rotate":     return `rotate(${this.expr()});`;
      case "translate":  return `translate(${this.expr()}, ${this.expr()});`;
      case "circle": {
        const x = this.expr(), y = this.expr(), r = this.expr();
        return `circle(${x}, ${y}, ${r} * 2);`;
      }
      case "square": {
        const x = this.expr(), y = this.expr(), s = this.expr();
        return `square(${x}, ${y}, ${s});`;
      }
      case "rect": {
        const x = this.expr(), y = this.expr(), w = this.expr(), h = this.expr();
        return `rect(${x}, ${y}, ${w}, ${h});`;
      }
      case "line": {
        const a = this.expr(), b = this.expr(), c = this.expr(), d = this.expr();
        return `line(${a}, ${b}, ${c}, ${d});`;
      }
      case "repeat": {
        const n = this.eat()!.value;
        // consume "{" ... "}"
        this.eat(); // {
        const body = this.stmts(true);
        this.eat(); // }
        return `for (let __i = 0; __i < ${n}; __i++) { ${body.join(" ")} }`;
      }
    }
    return "";
  }

  color(): string {
    const t = this.eat()!;
    if (t.value === "rgb") {
      this.eat(); // (
      const r = this.expr(); this.eat(); // ,
      const g = this.expr(); this.eat(); // ,
      const b = this.expr(); this.eat(); // )
      return `${r}, ${g}, ${b}`;
    }
    return COLORS[t.value] ?? "'#888'";
  }

  expr(): string { return this.exprBp(0); }

  /**
   * Pratt-style operator precedence (additive=10, multiplicative=20).
   * Output JS infix with explicit parens around each binary op for safety.
   */
  exprBp(minBp: number): string {
    let lhs = this.factor();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op") break;
      const bp = t.value === "+" || t.value === "-" ? 10 : 20;
      if (bp < minBp) break;
      const op = this.eat()!.value;
      const rhs = this.exprBp(bp + 1);
      lhs = `(${lhs} ${op} ${rhs})`;
    }
    return lhs;
  }

  factor(): string {
    const t = this.eat()!;
    if (t.kind === "num") return t.value;
    if (t.value === "(") {
      const e = this.exprBp(0);
      this.eat(); // )
      return `(${e})`;
    }
    if (t.kind === "ident") {
      // function call?
      if (this.peek()?.value === "(") {
        this.eat(); // (
        const args: string[] = [this.exprBp(0)];
        while (this.peek()?.kind === ",") { this.eat(); args.push(this.exprBp(0)); }
        this.eat(); // )
        return `${t.value}(${args.join(", ")})`;
      }
      return VAR_MAP[t.value] ?? t.value;
    }
    return "0";
  }
}

interface BlockSplit {
  setup: string[];
  tick: string[];
  top: string[];
  hadTick: boolean;
}

/**
 * Split the program into setup / tick / top-level by scanning for
 * `setup { ... }` and `tick { ... }` markers, then transpile each.
 */
function split(toks: Tok[]): BlockSplit {
  const r: BlockSplit = { setup: [], tick: [], top: [], hadTick: false };
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (t.kind === "ident" && (t.value === "setup" || t.value === "tick") && toks[i + 1]?.kind === "{") {
      const which = t.value;
      const start = i + 2;
      let depth = 1, j = start;
      while (j < toks.length && depth > 0) {
        if (toks[j]!.kind === "{") depth++;
        else if (toks[j]!.kind === "}") depth--;
        if (depth > 0) j++;
      }
      const slice = toks.slice(start, j);
      const out = new Transpiler(slice).stmts(false);
      if (which === "setup") r.setup.push(...out);
      else { r.tick.push(...out); r.hadTick = true; }
      i = j + 1;
      continue;
    }
    // top-level stmt: hand a single-stmt slice to the transpiler.
    const start = i;
    // a stmt starts with an ident keyword; advance i to the next ident that
    // starts a new stmt OR EOF. Cheap heuristic: scan until we hit another
    // top-level keyword that we recognize as a stmt starter, balancing braces
    // & parens.
    i++;
    let depth = 0;
    while (i < toks.length) {
      const u = toks[i]!;
      if (u.kind === "{" || u.kind === "(") depth++;
      else if (u.kind === "}" || u.kind === ")") depth--;
      else if (
        depth === 0 &&
        u.kind === "ident" &&
        STMT_STARTERS.has(u.value)
      ) break;
      i++;
    }
    const slice = toks.slice(start, i);
    r.top.push(...new Transpiler(slice).stmts(false));
  }
  return r;
}

const STMT_STARTERS = new Set([
  "setup", "tick",
  "circle", "square", "rect", "line",
  "fill", "stroke", "no_fill", "no_stroke",
  "background",
  "rotate", "translate", "push", "pop",
  "repeat",
]);

/** Public entry: noroshi-creative source → p5.js sketch source. */
export function transpile(src: string): string {
  const toks = lex(src);
  const { setup, tick, top, hadTick } = split(toks);

  const setupBody = [
    `createCanvas(${CANVAS_W}, ${CANVAS_H});`,
    ...setup,
    ...(hadTick ? [] : ["noLoop();"]),
  ].join("\n  ");

  const drawBody = (hadTick ? tick : top).join("\n  ") || "/* empty */";

  return `function setup() {\n  ${setupBody}\n}\n\nfunction draw() {\n  ${drawBody}\n}\n`;
}
