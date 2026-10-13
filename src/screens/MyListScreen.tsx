import { useState } from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bookmark } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ContentCard } from '@/src/components/ContentCard';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { Focusable } from '@/src/components/Focusable';
import { useMyList } from '@/src/hooks/useMyList';
import { useDeviceKind } from '@/src/hooks/useDeviceKind';
import { getGridColumns, getHorizontalPadding } from '@/src/utils/responsive';
import { getTitle, type MediaItem } from '@/src/types';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import type { RootStackScreenProps } from '@/src/navigation/types';

/**
 * The dedicated "My List" destination. Home shows a preview row only when the
 * list is non-empty; this screen is the always-present entry point — reachable
 * from Settings even with zero saves — and is where a user prunes titles.
 */
export const MyListScreen = ({ navigation }: RootStackScreenProps<'MyList'>) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const deviceKind = useDeviceKind();
  const { items, loaded, remove } = useMyList();

  // Editing is opt-in so a normal tap opens the title; only in edit mode do
  // cards show their remove affordance and suppress the body tap.
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);

  const columns = getGridColumns(deviceKind);
  const padding = getHorizontalPadding(deviceKind);
  const gap = 12;
  const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center px-4 py-3">
        <Focusable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          className="rounded-full"
          focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
        >
          <Icon as={ArrowLeft} size="xl" className="text-foreground" />
        </Focusable>
        <Heading size="xl" bold className="flex-1 text-foreground" numberOfLines={1}>
          My List
        </Heading>
        {items.length > 0 ? (
          <Focusable
            onPress={() => setEditing((e) => !e)}
            className="rounded-full bg-primary/20 px-3 py-1"
            focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
          >
            <Text size="sm" className="font-semibold text-primary">
              {editing ? 'Done' : 'Edit'}
            </Text>
          </Focusable>
        ) : null}
      </HStack>

      {!loaded ? (
        <Center className="flex-1">
          <Text className="text-muted-foreground">Loading your list…</Text>
        </Center>
      ) : items.length === 0 ? (
        <Center className="flex-1 px-8">
          <Icon as={Bookmark} size="xl" className="mb-3 text-muted-foreground" />
          <Text className="text-center text-muted-foreground">
            Your list is empty. Tap “+ My List” on any title to save it here for
            later.
          </Text>
        </Center>
      ) : (
        <FlatList
          data={items}
          key={`${columns}-${editing}`}
          numColumns={columns}
          keyExtractor={(item) => `${item.media_type ?? 'movie'}-${item.id}`}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{
            gap,
            paddingHorizontal: padding,
            paddingBottom: insets.bottom + 16,
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ContentCard
              item={item}
              width={cardWidth}
              onPress={(i) => navigation.navigate('Detail', { item: i })}
              selectable={editing}
              onRequestDelete={(i) => setPendingDelete(i)}
            />
          )}
        />
      )}

      <ConfirmDialog
        visible={pendingDelete != null}
        title="Remove from My List?"
        message={pendingDelete ? `Remove "${getTitle(pendingDelete)}"?` : ''}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  );
};
