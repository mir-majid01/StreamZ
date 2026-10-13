import { originOf } from '@/src/utils/streamUrl';
import {
  STREAMFLIX_PLAYBACK_HEADERS,
  isStreamflixServer,
} from '@/src/services/StreamflixService';
import { isFlixQuestServer } from '@/src/services/FlixQuestService';

export type ServerResolver = 'webview' | 'streamflix' | 'flixquest';

/**
 * The mobile-Chrome UA the scraper WebView presents (see WebViewScraper). Media
 * hosts that gate on a browser UA hand the WebView a playable stream but reject
 * a plain OkHttp/download request with no (or WebView-flavoured) User-Agent, so
 * downloads for webview-resolver servers must present the very same UA.
 */
export const WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export const isRestResolverServer = (server: {
  resolver?: string;
  id?: string;
}): boolean => isStreamflixServer(server) || isFlixQuestServer(server);

export const playbackHeadersFor = (server: {
  resolver?: string;
  id?: string;
  url: string;
}): Record<string, string> => {
  if (isStreamflixServer(server)) return { ...STREAMFLIX_PLAYBACK_HEADERS };
  if (isFlixQuestServer(server)) return {};
  return {
    Referer: `${server.url}/`,
    Origin: originOf(server.url),
    'User-Agent': WEBVIEW_USER_AGENT,
  };
};
