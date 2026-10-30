/**
 * Asks NVIDIA Nemotron one question through Nebius Token Factory.
 *
 *   NEBIUS_API_KEY=... npm run example -- "How often should I brush my dog's teeth?"
 *   NEBIUS_API_KEY=... npm run example:stream -- "Is chocolate safe for cats?"
 */
import { tokenFactoryChat, tokenFactoryChatStream } from '../src/token-factory-chat';
import type { TokenFactoryMessage } from '../src/token-factory-chat';

async function main(): Promise<void> {
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) {
    console.error('Set NEBIUS_API_KEY to your Nebius Token Factory API key.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const stream = args.includes('--stream');
  const question =
    args.filter((a) => a !== '--stream').join(' ') ||
    "How often should I brush my dog's teeth?";
  const messages: TokenFactoryMessage[] = [
    {
      role: 'system',
      content:
        'You are a friendly pet-care assistant. Answer briefly and suggest a vet visit when health is at stake.',
    },
    { role: 'user', content: question },
  ];
  const req = {
    baseUrl: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1',
    apiKey,
    model: process.env.NEBIUS_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
    messages,
    maxTokens: 2048,
    timeoutMs: 60_000,
  };

  if (stream) {
    let printed = 0;
    const reply = await tokenFactoryChatStream(req, (soFar) => {
      process.stdout.write(soFar.slice(printed));
      printed = soFar.length;
    });
    process.stdout.write(reply.slice(printed) + '\n');
  } else {
    console.log((await tokenFactoryChat(req)).trim());
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
