import type { LLMAdapter, LLMSampleOptions } from "../types.js";

/**
 * Echo / canned adapter for tests and offline development.
 *
 * Construct with a `responder` callback that maps prompt → output. Useful for
 * exercising the noroshi pipeline (prompt build → validate → retry) without
 * a real LLM. Real adapters (WebLLM, transformers.js, LiteRT-LM, fetch-based
 * OpenAI/Anthropic) follow the same {@link LLMAdapter} contract.
 */
export class StubAdapter implements LLMAdapter {
  readonly id = "stub";

  constructor(private readonly responder: (prompt: string) => string | string[]) {}

  async complete(prompt: string, _opts?: LLMSampleOptions): Promise<string> {
    const r = this.responder(prompt);
    return Array.isArray(r) ? r[0] ?? "" : r;
  }

  async sampleN(prompt: string, n: number, _opts?: LLMSampleOptions): Promise<string[]> {
    const r = this.responder(prompt);
    if (Array.isArray(r)) return r.slice(0, n);
    return Array.from({ length: n }, () => r);
  }
}
