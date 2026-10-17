import { useMemo, useState } from 'react';
import { Box } from '@/components/ui/box';
import { Image } from '@/components/ui/image';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import { LIVE_TV, RADIUS } from '@/src/theme/tokens';
import {
  createLogoHostBudget,
  getMonogramForTile,
  normalizeLogoUri,
} from './liveTvLayout';

/**
 * One budget for the process. Playlist logos live on third-party CDNs that fail in
 * whole playlists, so after a few failures from a host this stops asking it and
 * every later row on that host paints its monogram instead — no spinner, no broken
 * image, no queue of doomed requests behind a scrolling list.
 */
const logoBudget = createLogoHostBudget();

interface ChannelLogoProps {
  name: string;
  logoUrl?: string;
  tile?: number;
}

/**
 * Real artwork where the playlist carries a `tvg-logo`, a monogram derived from the
 * name where it does not. Nothing is invented: the tile is the same size, border and
 * surface either way, so a channel with no logo still holds the row's rhythm, and
 * `resizeMode="contain"` means a wide station bug is never cropped or stretched into
 * a square it was not drawn for.
 */
export const ChannelLogo = ({
  name,
  logoUrl,
  tile = LIVE_TV.logoTile,
}: ChannelLogoProps) => {
  const uri = useMemo(() => normalizeLogoUri(logoUrl), [logoUrl]);
  const monogram = useMemo(() => getMonogramForTile(name, tile), [name, tile]);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const requestable = uri != null && uri !== failedUri && logoBudget.shouldLoad(uri);

  return (
    <Box
      className="items-center justify-center overflow-hidden border border-border bg-muted/60"
      style={{ width: tile, height: tile, borderRadius: RADIUS.sm }}
    >
      {requestable ? (
        <Image
          source={{ uri }}
          alt=""
          resizeMode="contain"
          className="h-full w-full"
          style={{ padding: LIVE_TV.logoInset }}
          onError={() => {
            logoBudget.reportFailure(uri);
            setFailedUri(uri);
          }}
        />
      ) : (
        <StreamZText
          variant={tile >= LIVE_TV.monogramTwoLetterMin ? 'cardTitle' : 'caption'}
          className="text-muted-foreground"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          accessible={false}
        >
          {monogram}
        </StreamZText>
      )}
    </Box>
  );
};
