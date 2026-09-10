import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveMediaItem } from '@rntp/player';

export const TAB_BAR_BASE_HEIGHT = 60;
export const MINI_PLAYER_HEIGHT = 64;

/**
 * Returns the exact dynamic pixel padding required for any scrollable list
 * to ensure content is never covered by the TabBar, MiniPlayer, or Android Navigation Bar.
 */
export function useBottomClearance(extraPadding = 24) {
  const insets = useSafeAreaInsets();
  const currentTrack = useActiveMediaItem();

  const isMiniPlayerVisible = Boolean(currentTrack);
  const miniPlayerOffset = isMiniPlayerVisible ? MINI_PLAYER_HEIGHT : 0;
  const bottomInset = insets.bottom > 0 ? insets.bottom : 8; // Fallback for devices without bottom notch/insets

  const totalBarHeight = TAB_BAR_BASE_HEIGHT + bottomInset;
  const totalBottomPadding = totalBarHeight + miniPlayerOffset + extraPadding;

  return {
    insets,
    totalBarHeight,
    miniPlayerOffset,
    totalBottomPadding,
    isMiniPlayerVisible,
  };
}
