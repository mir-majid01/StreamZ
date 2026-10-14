import { File, Paths } from 'expo-file-system';
import type { TextStore } from './playlistCatalog';

/**
 * Playlist catalogues are megabytes of JSON (the merged list is ~12k channels), which is
 * more than AsyncStorage is comfortable holding on Android, so they live as files instead.
 * Favourites and recents stay in AsyncStorage — those are tiny and keyed to the user.
 */
export const createFileTextStore = (): TextStore => ({
  async read(key) {
    try {
      const file = new File(Paths.document, `${key}.json`);
      return file.exists ? file.textSync() : null;
    } catch {
      return null;
    }
  },
  async write(key, value) {
    const file = new File(Paths.document, `${key}.json`);
    if (!file.exists) file.create();
    file.write(value);
  },
});
