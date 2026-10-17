import type { LiveChannel, LiveEpgChannel } from '@/src/services/DaddyLiveService';

/**
 * Id-keyed lookups over the merged Live TV catalogue.
 *
 * The catalogue is ~12.5k channels, so "find the channel with this id" is a linear scan of
 * twelve and a half thousand entries. It used to run once per rendered schedule row, per
 * render, which is what kept the JS thread busy while the schedule tab was on screen.
 */

/**
 * First occurrence wins, matching `Array.prototype.find`, so a catalogue that somehow
 * carries the same id twice resolves exactly the way the previous scan did.
 */
export const buildChannelIndex = (
  channels: readonly LiveChannel[],
): Map<string, LiveChannel> => {
  const index = new Map<string, LiveChannel>();
  for (const channel of channels) {
    if (!index.has(channel.id)) index.set(channel.id, channel);
  }
  return index;
};

/**
 * The full channel behind an EPG row. An event can name a channel the catalogue does not
 * carry — a source that dropped out between the EPG fetch and the list fetch — so the
 * reference itself is the fallback, with the same empty arrays the schedule used to build.
 */
export const resolveScheduleChannel = (
  index: ReadonlyMap<string, LiveChannel>,
  reference: LiveEpgChannel,
): LiveChannel =>
  index.get(reference.id) ?? {
    id: reference.id,
    name: reference.name,
    categories: [],
    eventTitles: [],
  };

/**
 * Appends only the ids `existing` does not have yet. A list keyed by id — the channel
 * drawer's `keyExtractor` — cannot hold the same id twice, and a full re-fetch appended
 * onto a catalogue that already carried those channels would do exactly that.
 */
export const appendUniqueChannels = (
  existing: readonly LiveChannel[],
  incoming: readonly LiveChannel[],
): LiveChannel[] => {
  if (!existing.length) return [...incoming];
  const seen = new Set(existing.map((channel) => channel.id));
  const missing = incoming.filter((channel) => !seen.has(channel.id));
  return missing.length ? [...existing, ...missing] : [...existing];
};
