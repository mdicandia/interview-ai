import { createTtsClient, type TtsClient, type TtsEvents } from './tts'
import { createKokoroTtsClient, preloadKokoro } from './tts-kokoro'

/**
 * Picks which voice the interviewer speaks with.
 *
 * Two implementations behind one `TtsClient`, which is the only reason swapping
 * them is a config change rather than a refactor. They differ in exactly one
 * way that matters to the rest of the system, and it is a trade rather than a
 * ranking:
 *
 *   kokoro    local, free, ~550ms to first audio on a typical sentence
 *   cartesia  hosted, ~1 credit per character, ~40ms to first audio
 *
 * Local is the default. A tool you practise with daily should not have a meter
 * running on it, and half a second of extra latency per turn is a fair price for
 * that — most of it hidden behind the backchannel clips anyway.
 *
 * Both emit PCM16 at `PLAYBACK_SAMPLE_RATE`, so the browser cannot tell them
 * apart.
 */

export type TtsProvider = 'kokoro' | 'cartesia'

export function selectedTtsProvider(): TtsProvider {
  return process.env.TTS_PROVIDER === 'cartesia' ? 'cartesia' : 'kokoro'
}

export async function createVoice(
  events: TtsEvents,
  cartesiaKey: string,
): Promise<TtsClient> {
  if (selectedTtsProvider() === 'cartesia') return createTtsClient(cartesiaKey, events)
  return createKokoroTtsClient(events)
}

/**
 * Loads the local model ahead of the first session.
 *
 * A cold load is ~17s of reading weights off disk. Without this it lands on
 * whoever presses "Start interview" first, who has no idea why the button is
 * hanging. Safe to call when the provider is hosted — it does nothing.
 */
export function warmVoice(): void {
  if (selectedTtsProvider() !== 'kokoro') return
  const started = Date.now()
  void preloadKokoro()
    .then(() => console.log(`[voice] local speech model ready in ${Date.now() - started}ms`))
    .catch((error: unknown) => {
      console.error(
        `[voice] the local speech model failed to load: ${
          error instanceof Error ? error.message : String(error)
        }\n` +
          '        Set TTS_PROVIDER=cartesia in .env.local to use the hosted voice instead.',
      )
    })
}
