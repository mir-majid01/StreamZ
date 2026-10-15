import { WYZIE_SUBS_CONFIG } from '@/src/config/env';

export interface WyzieSubtitle {
  id: string;
  url: string;
  flagUrl?: string;
  format: string;
  encoding?: string;
  display: string;
  language: string;
  media?: string;
  isHearingImpaired?: boolean;
  source?: string;
  fileName?: string;
}

export class WyzieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WyzieError';
  }
}

/**
 * `fetch` rejects with a DOMException named AbortError when a signal fires, and
 * with a plain TypeError for everything else the platform could not do. Naming
 * the timeout as a timeout is what makes "the CDN was slow" distinguishable from
 * "the request was blocked" on a screen that shows one line.
 */
const failureFor = (err: unknown, url: string, timeoutMessage: string): WyzieError => {
  if (err instanceof Error && err.name === 'AbortError') return new WyzieError(timeoutMessage);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'the subtitle server';
    }
  })();
  return new WyzieError(`Could not reach ${host}. ${err instanceof Error ? err.message : ''}`.trim());
};

/** Browser-like UA so Cloudflare (vdrk) does not 403 RN/okhttp fetches. */
export const SUBTITLE_FETCH_HEADERS: Record<string, string> = {
  Accept: 'text/vtt, text/plain, application/x-subrip, application/json, */*',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};

interface SearchParams {
  tmdbId: number;
  season?: number;
  episode?: number;
  language?: string;
  format?: string;
}

/**
 * Wyzie Subs client using native fetch.
 * Docs: https://docs.wyzie.io/subs/usage/direct
 */
class WyzieServiceImpl {
  private readonly baseUrl = WYZIE_SUBS_CONFIG.BASE_URL;
  private readonly apiKey = WYZIE_SUBS_CONFIG.API_KEY;

  async searchSubtitles({
    tmdbId,
    season,
    episode,
    language,
    format = 'srt',
  }: SearchParams): Promise<WyzieSubtitle[]> {
    if (!this.apiKey) {
      throw new WyzieError(
        'No Wyzie API key is configured. Set EXPO_PUBLIC_WYZIE_API_KEY and rebuild — ' +
          'EXPO_PUBLIC_* values are inlined into the bundle at build time.',
      );
    }

    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('id', String(tmdbId));
    url.searchParams.set('key', this.apiKey);
    // Omit `language` to receive tracks across all languages.
    if (language) {
      url.searchParams.set('language', language);
    }
    url.searchParams.set('format', format);
    if (season != null && episode != null) {
      url.searchParams.set('season', String(season));
      url.searchParams.set('episode', String(episode));
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      WYZIE_SUBS_CONFIG.TIMEOUT,
    );

    const requestUrl = url.toString();
    try {
      const response = await fetch(requestUrl, {
        headers: { ...SUBTITLE_FETCH_HEADERS, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WyzieError(`Wyzie request failed (${response.status})`);
      }
      const data = (await response.json()) as WyzieSubtitle[] | WyzieSubtitle;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'url' in data) return [data];
      return [];
    } catch (err) {
      if (err instanceof WyzieError) throw err;
      throw failureFor(err, requestUrl, 'Wyzie search timed out.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Downloads the cue file itself. This needs the same timeout the search has:
   * without one, a subtitle host that accepts the connection and never answers
   * leaves the picker spinning, and the player looks like it has no subtitles
   * at all rather than like one download hung.
   */
  async fetchSubtitleText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WYZIE_SUBS_CONFIG.TIMEOUT);
    try {
      const response = await fetch(url, {
        headers: SUBTITLE_FETCH_HEADERS,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WyzieError(`Failed to download subtitle (${response.status})`);
      }
      const text = await response.text();
      const trimmed = text.replace(/^\uFEFF/, '').trim();
      if (/^<!DOCTYPE html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
        throw new WyzieError('Subtitle download returned HTML instead of cues.');
      }
      return text;
    } catch (err) {
      if (err instanceof WyzieError) throw err;
      throw failureFor(err, url, 'Subtitle download timed out.');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const WyzieService = new WyzieServiceImpl();
