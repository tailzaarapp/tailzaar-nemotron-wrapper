/**
 * A minimal client for Nebius Token Factory's OpenAI-compatible
 * POST {base}/chat/completions, on global fetch with a small SSE reader
 * (no SDK dependency). The body is model, max_tokens, messages and stream only.
 *
 * Each attempt is time-boxed (`timeoutMs`, up to the response headers when
 * streaming) and retried once on a network error, a time-out, 408, 409, 429 or
 * >= 500. It returns the message content only, never `reasoning_content`, and
 * throws on any failure: a non-2xx, an in-stream error event, an aborted body.
 */
export interface TokenFactoryMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokenFactoryChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: TokenFactoryMessage[];
  maxTokens: number;
  /** Per-attempt time box. */
  timeoutMs: number;
  /** The caller's overall deadline; aborting it ends the request and its body. */
  signal?: AbortSignal;
}

export class TokenFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenFactoryError';
  }
}

const RETRY_ATTEMPTS = 1;

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 409 || status === 429 || status >= 500;

/** The reply's message content ('' when it has none). */
export async function tokenFactoryChat(
  req: TokenFactoryChatRequest,
): Promise<string> {
  return send(req, async (res) => {
    // Read a clone so the Response itself stays unread (bodyUsed false).
    const body = (await res.clone().json()) as {
      choices?: { message?: { content?: unknown } }[];
    } | null;
    const content = body?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  });
}

/**
 * The reply streamed: `onContent` receives the content so far each time a delta
 * adds to it; resolves with the full content ('' when it has none).
 */
export async function tokenFactoryChatStream(
  req: TokenFactoryChatRequest,
  onContent: (soFar: string) => void,
): Promise<string> {
  return send(req, (res, signal) => readSse(res, signal, onContent), true);
}

async function send(
  req: TokenFactoryChatRequest,
  read: (res: Response, signal: AbortSignal) => Promise<string>,
  stream = false,
): Promise<string> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages,
    ...(stream ? { stream: true } : {}),
  });

  for (let attempt = 0; ; attempt++) {
    const retry = attempt < RETRY_ATTEMPTS;
    const attemptAbort = new AbortController();
    const abort = () => attemptAbort.abort();
    req.signal?.addEventListener('abort', abort);
    const timer = setTimeout(abort, req.timeoutMs);
    try {
      if (req.signal?.aborted) throw new TokenFactoryError('aborted');
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.apiKey}`,
            'Content-Type': 'application/json',
            Accept: stream ? 'text/event-stream' : 'application/json',
          },
          body,
          signal: attemptAbort.signal,
        });
      } catch (e) {
        // A network error or the per-attempt time-out.
        if (retry && !req.signal?.aborted) continue;
        throw e;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        if (retry && isRetryableStatus(res.status) && !req.signal?.aborted) {
          continue;
        }
        throw new TokenFactoryError(`HTTP ${res.status}`);
      }
      // A stream's body is bounded by the caller's deadline, not the time box.
      if (stream) clearTimeout(timer);
      return await read(res, attemptAbort.signal);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', abort);
    }
  }
}

/** Reads `data:` events until `[DONE]` or the end of the body. */
async function readSse(
  res: Response,
  signal: AbortSignal,
  onContent: (soFar: string) => void,
): Promise<string> {
  if (!res.body) throw new TokenFactoryError('no response body');
  const reader = res.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel);
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let content = '';

  /** Handles one complete event; true on `[DONE]`. */
  const dispatch = (): boolean => {
    const payload = data.join('\n');
    const name = event;
    data = [];
    event = '';
    if (!payload) return false;
    if (payload === '[DONE]') return true;
    const parsed = JSON.parse(payload) as {
      error?: unknown;
      choices?: { delta?: { content?: unknown } }[];
    } | null;
    if (name === 'error' || parsed?.error) {
      throw new TokenFactoryError('error event in the stream');
    }
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onContent(content);
    }
    return false;
  };

  /** Feeds complete lines; true on `[DONE]`. */
  const feed = (flush: boolean): boolean => {
    const lines = buffer.split('\n');
    buffer = flush ? '' : (lines.pop() ?? '');
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line === '') {
        if (dispatch()) return true;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        else if (field === 'event') event = value;
      }
    }
    return flush && dispatch();
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new TokenFactoryError('aborted');
      if (done) {
        buffer += decoder.decode();
        feed(true);
        return content;
      }
      buffer += decoder.decode(value, { stream: true });
      if (feed(false)) {
        cancel();
        return content;
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
