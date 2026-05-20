import type { LLMAdapter, LLMSampleOptions } from "../types.js";

/**
 * Options for {@link FetchAdapter}.
 *
 * Works with any OpenAI-compatible `/chat/completions` endpoint, including
 * Ollama (`http://localhost:11434/v1`), llama.cpp `llama-server`, vLLM, LM
 * Studio, OpenAI, OpenRouter. For non-OpenAI providers (Anthropic, Gemini)
 * use a translating proxy or write a dedicated adapter.
 */
export interface FetchAdapterOptions {
  /**
   * Base URL up to and including the `/v1` segment. `/chat/completions` is
   * appended automatically. Trailing slashes are stripped.
   */
  endpoint: string;

  /** Model identifier as recognized by the server (e.g. `gemma4:e2b`). */
  model: string;

  /** Optional bearer token. Omit for unauthenticated local servers. */
  apiKey?: string;

  /** Override the adapter id (defaults to `fetch:<model>`). */
  id?: string;

  /** Inject a custom fetch (e.g. for tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;

  /** Extra request headers. */
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * LLM adapter that talks OpenAI-compatible chat completions over HTTP.
 *
 * The current scope is single-completion only. Native `n` sampling (when
 * the server supports it) is not used — noroshi's `_sample` falls back to N
 * parallel `complete` calls. If a provider's `n > 1` ever becomes the
 * bottleneck, override `sampleN` here.
 */
export class FetchAdapter implements LLMAdapter {
  readonly id: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: FetchAdapterOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? `fetch:${opts.model}`;
    this.fetchImpl = opts.fetch ?? fetch;
    this.extraHeaders = opts.headers ?? {};
  }

  async complete(prompt: string, opts: LLMSampleOptions = {}): Promise<string> {
    const url = `${this.endpoint}/chat/completions`;
    const body = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.2,
      top_p: opts.topP ?? 0.95,
      max_tokens: opts.maxTokens ?? 256,
      stop: opts.stop,
      stream: false,
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `FetchAdapter ${url} returned ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        `FetchAdapter ${url} unexpected response: ${JSON.stringify(json).slice(0, 500)}`,
      );
    }
    return content;
  }
}
