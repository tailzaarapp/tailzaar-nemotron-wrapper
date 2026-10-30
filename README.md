# TailZaar Nemotron wrapper

A small, dependency-free TypeScript client for **NVIDIA Nemotron** served on
**Nebius Token Factory**, published by [TailZaar](https://tailzaar.com), a
pet-care app based in Riyadh.

TailZaar's in-app AI pet assistant can send its replies through NVIDIA Nemotron
(`nvidia/nemotron-3-super-120b-a12b`) on Nebius Token Factory using this module,
behind a server-side switch that is off by default. This repository contains
only that call module and a runnable example; the rest of the TailZaar app is
not open source.

## What it does

- Calls Token Factory's OpenAI-compatible `POST {baseUrl}/chat/completions`
  with `fetch`, no SDK.
- Two entry points: `tokenFactoryChat` (one reply) and `tokenFactoryChatStream`
  (server-sent events, with a callback for the text so far).
- Time-boxes each attempt (`timeoutMs`; for the stream, up to the response
  headers, the body then bounded by your `signal`) and retries once on a
  network error, a time-out, or HTTP 408, 409, 429 or 5xx.
- Returns the message content only (never `reasoning_content`) and throws on
  any failure: a `TokenFactoryError` for a non-2xx, an in-stream error event or
  an abort, otherwise the underlying error.

## Requirements

- Node.js 18 or newer (for the global `fetch`).
- A Nebius Token Factory API key: https://tokenfactory.nebius.com

## Setup

```bash
git clone https://github.com/tailzaarapp/tailzaar-nemotron-wrapper.git
cd tailzaar-nemotron-wrapper
npm install
export NEBIUS_API_KEY="<your Token Factory API key>"
```

## Run the example

```bash
npm run example -- "How often should I brush my dog's teeth?"
npm run example:stream -- "Is chocolate safe for cats?"
```

| Variable | Required | Default |
|---|---|---|
| `NEBIUS_API_KEY` | yes | none |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1` |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-super-120b-a12b` |

## Use it in your code

```ts
import { tokenFactoryChat } from './src/token-factory-chat';

const reply = await tokenFactoryChat({
  baseUrl: 'https://api.tokenfactory.nebius.com/v1',
  apiKey: process.env.NEBIUS_API_KEY!,
  model: 'nvidia/nemotron-3-super-120b-a12b',
  messages: [{ role: 'user', content: 'How much should a 10 kg dog eat a day?' }],
  maxTokens: 1024,
  timeoutMs: 60_000,
});
```

Pass `signal` (an `AbortSignal`) to cancel a request from the caller's side.

## Build

```bash
npm run typecheck
npm run build   # compiles src/ to dist/
```

## License

[MIT](LICENSE)
