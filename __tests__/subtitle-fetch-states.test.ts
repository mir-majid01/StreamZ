/**
 * Failure states of the subtitle transport. Under Jest no `EXPO_PUBLIC_WYZIE_API_KEY`
 * exists, which is exactly the CI build a tester sees, so the config refusal is
 * asserted as the default and the network paths are driven with a stubbed fetch —
 * `fetchSubtitleText` never touches the key.
 */
import { WyzieError, WyzieService } from '@/src/services/WyzieService';

const TRACK_URL = 'https://cache.vdrk.site/v1/vtt/movie/550/English.vtt';

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const withFetch = (impl: (input: string, init?: { signal?: AbortSignal }) => Promise<unknown>) => {
  globalThis.fetch = impl as typeof fetch;
};

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
  jest.useRealTimers();
});

describe('search without a configured key', () => {
  it('names the variable and says a rebuild is required', async () => {
    // A key baked into the bundle cannot appear at runtime, so the message has to
    // send the reader to the build, not to the network.
    let message = '';
    await WyzieService.searchSubtitles({ tmdbId: 550 }).catch((err: Error) => {
      message = err.message;
    });
    expect(message).toContain('EXPO_PUBLIC_WYZIE_API_KEY');
    expect(message).toContain('rebuild');
  });

  it('refuses without attempting any request', async () => {
    let attempted = false;
    withFetch(async () => {
      attempted = true;
      return jsonResponse([]);
    });
    await WyzieService.searchSubtitles({ tmdbId: 550 }).catch(() => undefined);
    expect(attempted).toBe(false);
  });
});

describe('fetchSubtitleText', () => {
  it('reports the status a subtitle host returned', async () => {
    withFetch(async () => jsonResponse('nope', false, 404));
    await expect(WyzieService.fetchSubtitleText(TRACK_URL)).rejects.toThrow(
      'Failed to download subtitle (404)',
    );
  });

  it('calls a challenge page what it is instead of passing it to the parser', async () => {
    withFetch(async () => jsonResponse('<!DOCTYPE html><html><body>Blocked</body></html>'));
    await expect(WyzieService.fetchSubtitleText(TRACK_URL)).rejects.toThrow(
      'Subtitle download returned HTML instead of cues.',
    );
  });

  it('names the host that could not be reached', async () => {
    withFetch(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(WyzieService.fetchSubtitleText(TRACK_URL)).rejects.toThrow(
      /Could not reach cache\.vdrk\.site/,
    );
  });

  it('separates a hung host from a failed request', async () => {
    jest.useFakeTimers();
    withFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const pending = WyzieService.fetchSubtitleText(TRACK_URL);
    jest.advanceTimersByTime(11_000);
    await expect(pending).rejects.toThrow('Subtitle download timed out.');
  });

  it('returns the cue text of a good file', async () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello';
    withFetch(async () => jsonResponse(vtt));
    await expect(WyzieService.fetchSubtitleText(TRACK_URL)).resolves.toBe(vtt);
  });
});

describe('error type', () => {
  it('is one error class the UI can catch once', async () => {
    withFetch(async () => jsonResponse('', false, 500));
    await expect(WyzieService.fetchSubtitleText(TRACK_URL)).rejects.toBeInstanceOf(WyzieError);
  });
});
