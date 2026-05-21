/**
 * Core types for noroshi — Grammar Prompting for browser-side LLMs.
 *
 * Design notes:
 * - The library is **runtime-agnostic**: no direct dependency on WebLLM,
 *   transformers.js, LiteRT-LM, Node fetch, or any specific transport.
 *   Consumers plug in an {@link LLMAdapter}.
 * - The validator is **pluggable** and optional. Default implementation will
 *   adapt nearley, but core types never reference nearley directly so the
 *   bundle stays small when validation is skipped.
 * - Grammar is passed as an opaque string: in the prompt it is shown to the
 *   model verbatim, so authors should write it in BNF/EBNF (what LLMs see
 *   most in pre-training data — typically `.lark` / `.ne` flavors).
 */

/** A single few-shot example. */
export interface FewShotExample {
  /** User-side natural-language task. */
  input: string;
  /** Expected DSL output that satisfies the grammar. */
  output: string;
  /**
   * Optional grammar derivation. When present, noroshi will render it before
   * the output in the few-shot block, following Wang et al.'s "derivation
   * first, then surface form" pattern. Effective on novel DSLs.
   */
  derivation?: string;
}

/** Sampling options passed to the underlying LLM. */
export interface LLMSampleOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  /**
   * Free-form per-runtime hints. Examples:
   *   - LiteRT-LM web: `{ numResponses: 4 }` for native N-sampling.
   *   - WebLLM:        `{ logit_bias: {...} }`.
   * Adapters are responsible for forwarding only fields they recognize.
   */
  runtimeHints?: Record<string, unknown>;
}

/**
 * Adapter to call any LLM. Implementations exist for the browser (WebLLM,
 * transformers.js, LiteRT-LM web) or for server transports (fetch → OpenAI /
 * Anthropic). Consumers may write their own.
 */
export interface LLMAdapter {
  /** Friendly id for logging / debugging. */
  readonly id: string;

  /** Complete a single prompt → single string. */
  complete(prompt: string, opts?: LLMSampleOptions): Promise<string>;

  /**
   * Optional native N-sampling. When the runtime supports it (e.g. LiteRT-LM
   * `numResponses`), implement this for a single-call speedup. Otherwise
   * noroshi falls back to N calls to {@link complete}.
   */
  sampleN?(prompt: string, n: number, opts?: LLMSampleOptions): Promise<string[]>;
}

/** Result of validating one candidate output. */
export type ValidationResult =
  | { ok: true; ast?: unknown }
  | { ok: false; error: string };

/** Pluggable validator. Sync because parsers are typically fast and pure. */
export interface Validator {
  /** Friendly id for logging. */
  readonly id: string;
  validate(output: string): ValidationResult;
}

/**
 * Optional ranker for self-consistency rerank.
 * Lower score = better (consistent with "loss"-style semantics).
 * If absent, noroshi uses majority-vote-by-validation: pick the first
 * candidate that passes the validator.
 */
export interface Ranker {
  readonly id: string;
  rank(candidates: string[]): Promise<number[]>;
}

/** Options for a single generation. */
export interface GenerateOptions {
  /** The natural-language task. */
  task: string;

  /** Grammar text injected into the prompt verbatim. */
  grammar: string;

  /** Few-shot examples (3–5 recommended). */
  examples: FewShotExample[];

  /** LLM adapter. */
  llm: LLMAdapter;

  /** Optional system instruction prepended to the prompt. */
  systemPrompt?: string;

  /** Optional validator. */
  validator?: Validator;

  /** Optional self-consistency settings. */
  selfConsistency?: {
    /** Number of candidates to sample. */
    n: number;
    /** Optional ranker; defaults to "first valid wins". */
    ranker?: Ranker;
  };

  /**
   * Retry on validation failure. Default: no retry.
   * If {@link RetryOptions.includeErrorInPrompt} is true, the validator's
   * error string is appended to the next prompt to give the model a hint.
   */
  retry?: RetryOptions;

  /** Sampling options. */
  sample?: LLMSampleOptions;
}

export interface RetryOptions {
  maxAttempts: number;
  includeErrorInPrompt?: boolean;
}

export interface GenerateResult {
  /** The chosen output. */
  output: string;
  /** Parsed AST when a validator with AST support was used. */
  ast?: unknown;
  /** Total LLM calls (including retries and self-consistency samples). */
  attempts: number;
  /** All candidates if self-consistency was enabled. */
  candidates?: string[];
  /** Validation result for the chosen output. */
  validation?: ValidationResult;
}
