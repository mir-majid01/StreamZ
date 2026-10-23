/**
 * The live player's tuning and its play-flow instrumentation.
 *
 * The wiring half is asserted against the screen's source text for the same reason the
 * rest of this repo does it: `src/screens/*` cannot be imported in Jest (react-native-css
 * throws during module evaluation), so the props and handlers are pinned by reading the
 * file, and every decision behind them is a pure function tested here.
 */
import { readFileSync } from 'fs';
import path from 'path';
import {
  EMPTY_LIVE_TELEMETRY,
  LIVE_BUFFER_CONFIG,
  LIVE_FORWARD_BUFFER_SECONDS,
  formatLiveTelemetry,
  liveSilentStreamNotice,
  audioFormatsOf,
  anyAudioTrackSelected,
  undecodableAudioFormat,
} from '@/src/services/liveTv/livePlaybackTuning';

const ROOT = path.resolve(__dirname, '..');
const screen = readFileSync(path.join(ROOT, 'src/screens/LivePlayerScreen.tsx'), 'utf8');

describe('live buffer bounds are live bounds, not VOD ones', () => {
  it('refills to the minimum and stops at the maximum', () => {
    expect(LIVE_BUFFER_CONFIG.minBufferMs).toBeGreaterThan(0);
    expect(LIVE_BUFFER_CONFIG.maxBufferMs).toBeGreaterThan(LIVE_BUFFER_CONFIG.minBufferMs!);
    expect(LIVE_BUFFER_CONFIG.bufferForPlaybackMs!).toBeLessThanOrEqual(
      LIVE_BUFFER_CONFIG.minBufferMs!,
    );
    expect(LIVE_BUFFER_CONFIG.bufferForPlaybackAfterRebufferMs!).toBeLessThanOrEqual(
      LIVE_BUFFER_CONFIG.minBufferMs!,
    );
  });

  it('holds a bounded offset behind the live edge', () => {
    const live = LIVE_BUFFER_CONFIG.live!;
    expect(live.targetOffsetMs).toBeGreaterThan(0);
    expect(live.minOffsetMs!).toBeLessThan(live.targetOffsetMs!);
    expect(live.maxOffsetMs!).toBeGreaterThan(live.targetOffsetMs!);
    expect(live.maxOffsetMs!).toBeLessThanOrEqual(LIVE_BUFFER_CONFIG.maxBufferMs!);
  });

  it('corrects drift at a speed a viewer cannot hear', () => {
    const live = LIVE_BUFFER_CONFIG.live!;
    expect(live.maxPlaybackSpeed!).toBeGreaterThan(1);
    expect(live.maxPlaybackSpeed!).toBeLessThanOrEqual(1.1);
    expect(live.minPlaybackSpeed!).toBeLessThan(1);
    expect(live.minPlaybackSpeed!).toBeGreaterThanOrEqual(0.95);
  });

  it('never asks for a disk cache of a live stream', () => {
    expect(LIVE_BUFFER_CONFIG.cacheSizeMB).toBeUndefined();
  });

  it('gives iOS the same offset, in the unit that platform takes', () => {
    const live = LIVE_BUFFER_CONFIG.live!;
    expect(LIVE_FORWARD_BUFFER_SECONDS * 1000).toBe(live.targetOffsetMs);
  });
});

describe('play telemetry says only what it measured', () => {
  it('prints nothing when nothing was measured', () => {
    expect(formatLiveTelemetry(EMPTY_LIVE_TELEMETRY)).toBe('');
  });

  it('names the first frame once there is one', () => {
    expect(formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, firstFrameMs: 1830 })).toBe(
      'first frame 1830 ms · no rebuffers',
    );
  });

  it('counts rebuffers with their total stall time', () => {
    expect(
      formatLiveTelemetry({
        firstFrameMs: 900,
        rebufferCount: 2,
        rebufferTotalMs: 4300,
        playlistLatencyMs: 412,
        audioTrackCount: null,
        audioFormats: [],
        audioSelected: null,
      }),
    ).toBe('first frame 900 ms · playlist 412 ms · 2 rebuffers (4300 ms)');
  });

  it('uses the singular for one rebuffer', () => {
    expect(
      formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, firstFrameMs: 1, rebufferCount: 1, rebufferTotalMs: 50 }),
    ).toContain('1 rebuffer (50 ms)');
  });

  it('never claims a first frame a failed tune did not produce', () => {
    const line = formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, playlistLatencyMs: 300 });
    expect(line).toBe('playlist 300 ms');
    expect(line).not.toContain('first frame');
  });
});

describe('the screen actually uses the tuning and the instrumentation', () => {
  it('hands the player the live buffer config and the iOS duration', () => {
    expect(screen).toContain('bufferConfig={LIVE_BUFFER_CONFIG}');
    expect(screen).toContain('preferredForwardBufferDuration={LIVE_FORWARD_BUFFER_SECONDS}');
  });

  it('listens for the events a time-to-first-frame and a rebuffer count need', () => {
    expect(screen).toContain('onLoadStart={handleLoadStart}');
    expect(screen).toContain('onReadyForDisplay={handleFirstFrame}');
    expect(screen).toContain('onBuffer={handleBuffer}');
  });

  it('forgets the previous tune’s numbers when a new one starts', () => {
    expect(screen).toContain('setTelemetry(EMPTY_LIVE_TELEMETRY);');
    expect(screen).toContain('loadStartedAtRef.current = null;');
    expect(screen).toContain('bufferingSinceRef.current = null;');
  });

  it('shows the numbers only on the failure panel', () => {
    expect(screen).toContain('{telemetryLine ?');
  });
});

describe('the player reports whether a tune carried any audio', () => {
  it('starts unknown, not at zero', () => {
    // A tune that never loaded has not been measured; claiming "0 audio tracks" would be a
    // statement about a stream the player never read.
    expect(EMPTY_LIVE_TELEMETRY.audioTrackCount).toBeNull();
    expect(formatLiveTelemetry(EMPTY_LIVE_TELEMETRY)).toBe('');
  });

  it('prints the zero case, because no-audio is the finding', () => {
    expect(formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, audioTrackCount: 0 })).toBe(
      '0 audio tracks',
    );
    expect(formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, audioTrackCount: 1 })).toBe(
      '1 audio track',
    );
    expect(formatLiveTelemetry({ ...EMPTY_LIVE_TELEMETRY, audioTrackCount: 3 })).toContain(
      '3 audio tracks',
    );
  });

  it('is captured from the player event, not from the playlist text', () => {
    const at = screen.indexOf('onLoad={(payload)');
    expect(at).toBeGreaterThan(-1);
    const body = screen.slice(at, at + 700);
    expect(body).toContain('audioTracks?.length ?? 0');
    expect(body).toContain('audioTrackCount');
  });
});

describe('a silent live stream says so while it is playing', () => {
  it('says nothing until the player has reported', () => {
    // null means "not measured"; printing "0 audio tracks" for a tune that never loaded would be
    // a claim about a stream the player never read.
    expect(liveSilentStreamNotice(EMPTY_LIVE_TELEMETRY)).toBeNull();
    expect(liveSilentStreamNotice({ ...EMPTY_LIVE_TELEMETRY, audioTrackCount: 2 })).toBeNull();
  });

  it('says the feed carries no audio when the count is zero', () => {
    const notice = liveSilentStreamNotice({ ...EMPTY_LIVE_TELEMETRY, audioTrackCount: 0 });
    expect(notice).toContain('No sound');
    expect(notice).toContain('not sending any audio');
    // Zero tracks is the player's own report; nothing here may blame the phone for it.
    expect(notice).not.toMatch(/phone|decoder|decode/i);
  });

  it('is rendered over playback rather than only on the failure panel', () => {
    const at = screen.indexOf('silentNotice !== null');
    expect(at).toBeGreaterThan(-1);
    const before = screen.slice(0, at);
    expect(before).toContain('const silentNotice = liveSilentStreamNotice(telemetry)');
    const block = screen.slice(at, screen.indexOf('{visible && !loading ?', at));
    expect(block).toContain('!error');
    expect(block).toContain('!loading');
    // Touch-through: the picture is playing and the bar must not eat a press meant for the controls.
    expect(block).toContain('pointerEvents="none"');
    expect(block).toContain('{silentNotice}');
  });
});

describe('the player reports the audio format, not just that something is wrong', () => {
  const track = (type: string, selected = false) => ({ type, selected });

  it('reads the MIME strings react-native-video fills from Format.sampleMimeType', () => {
    expect(audioFormatsOf([track('audio/mp4a-latm'), track('audio/ac-3', true)])).toEqual([
      'audio/mp4a-latm',
      'audio/ac-3',
    ]);
    // A video track is not audio evidence.
    expect(audioFormatsOf([{ type: 'video/avc' }])).toEqual([]);
    expect(audioFormatsOf([{ type: undefined }])).toEqual([]);
    expect(audioFormatsOf([])).toEqual([]);
  });

  it('names the formats a phone is not guaranteed to decode', () => {
    expect(undecodableAudioFormat(['audio/ac-3'])).toBe('Dolby Digital');
    // `audio/eac-3` also contains `ac-3`; reading it as Dolby Digital would misinform the user.
    expect(undecodableAudioFormat(['audio/eac-3'])).toBe('Dolby Digital Plus');
    expect(undecodableAudioFormat(['audio/mp2'])).toBe('MPEG Layer II');
    expect(undecodableAudioFormat(['audio/dts-hd'])).toBe('DTS-HD');
    expect(undecodableAudioFormat(['audio/mp4a-latm'])).toBeNull();
    expect(undecodableAudioFormat([])).toBeNull();
  });

  it('says the specific thing when the sound is missing, and nothing when it cannot tell', () => {
    const base = { ...EMPTY_LIVE_TELEMETRY };
    expect(liveSilentStreamNotice(base)).toBeNull();
    expect(liveSilentStreamNotice({ ...base, audioTrackCount: 0 })).toContain(
      'not sending any audio',
    );
    expect(
      liveSilentStreamNotice({ ...base, audioTrackCount: 1, audioFormats: ['audio/ac-3'] }),
    ).toContain('Dolby Digital');
    // AAC present and playing: silence is not something this notice can explain, so it stays quiet
    // rather than guessing at the phone's volume or audio focus.
    expect(
      liveSilentStreamNotice({ ...base, audioTrackCount: 1, audioFormats: ['audio/mp4a-latm'] }),
    ).toBeNull();
  });

  it('keeps the selection flag so a wrong-track tune can be told from a dead feed', () => {
    expect(anyAudioTrackSelected([])).toBeNull();
    expect(anyAudioTrackSelected([track('audio/ac-3', true)])).toBe(true);
    expect(anyAudioTrackSelected([track('audio/ac-3')])).toBe(false);
  });

  it('prints the formats on the failure line', () => {
    const line = formatLiveTelemetry({
      ...EMPTY_LIVE_TELEMETRY,
      audioTrackCount: 2,
      audioFormats: ['audio/mp4a-latm', 'audio/ac-3'],
    });
    expect(line).toContain('2 audio tracks (mp4a-latm, ac-3)');
  });

  it('is captured from the load event together with the formats', () => {
    const at = screen.indexOf('audioFormatsOf(payload?.audioTracks ?? [])');
    expect(at).toBeGreaterThan(-1);
    expect(screen.slice(at - 300, at + 300)).toContain('anyAudioTrackSelected');
    expect(screen.slice(at - 300, at + 300)).toContain('audioTrackCount');
  });
});
