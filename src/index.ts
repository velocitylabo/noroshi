export const VERSION = "0.0.0-pre";

export type {
  FewShotExample,
  GenerateOptions,
  GenerateResult,
  LLMAdapter,
  LLMSampleOptions,
  Ranker,
  RetryOptions,
  ValidationResult,
  Validator,
} from "./types.js";

export { buildPrompt } from "./prompt.js";
export type { PromptInputs } from "./prompt.js";

export { generate } from "./noroshi.js";

export { StubAdapter } from "./adapters/stub.js";
export { FetchAdapter } from "./adapters/fetch.js";
export type { FetchAdapterOptions } from "./adapters/fetch.js";

export { cleanCompletion } from "./util/clean.js";

export { GrammarAwareRanker } from "./rankers/grammar.js";
