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
