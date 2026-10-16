/**
 * The live player knew why a channel failed and threw the answer away: `onError` ignored its
 * payload and set one fixed sentence, so a stream the publisher took down, a host that
 * rejects the app's request, and a container the device cannot read all looked identical to
 * the user and to any report.
 *
 * Android fills the payload in `ReactExoplayerView.java:1994`: `errorString` is
 * `ExoPlaybackException: <NAME>` (so the layer that broke — IO, format, decoder — is already
 * in the string) and `errorCode` is the numeric ExoPlayer code with a `2` prefix. iOS reports
 * through `localizedDescription`/`code` instead.
 */
export type PlayerErrorPayload = Readonly<{
  error?: Readonly<{
    errorString?: string;
    errorCode?: string;
    errorException?: string;
    localizedDescription?: string;
    code?: number;
  }>;
}>;

export const livePlaybackDetail = (payload: PlayerErrorPayload): string | null => {
  const err = payload.error;
  if (!err) return null;
  // `errorException` is deliberately not read: it is a Java stack trace, and an ExoPlayer IO
  // failure quotes the data URI in it. A stream URL can carry an access token.
  const name = (err.errorString ?? err.localizedDescription ?? '').trim();
  const code = err.errorCode ?? (err.code === undefined ? '' : String(err.code));
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return code ? `code ${code}` : null;
};
