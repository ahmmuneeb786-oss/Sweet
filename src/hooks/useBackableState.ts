import { useEffect, useRef } from 'react';
import { pushBackLayer, popBackLayer } from '../lib/backNavigationStack';

/**
 * Wire any "is this screen open" boolean up to the back button.
 *
 * Usage: useBackableState(!!selectedChatId, () => setSelectedChatId(null));
 *
 * When isOpen becomes true, a virtual history entry is pushed. Pressing
 * back closes just this screen (calls onClose) instead of leaving the
 * app. Closing the screen normally (its own close button) automatically
 * keeps the history stack in sync — nothing extra needed at the call site.
 */
export function useBackableState(isOpen: boolean, onClose: () => void) {
  const openRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen && !openRef.current) {
      openRef.current = true;
      pushBackLayer(() => {
        openRef.current = false;
        onCloseRef.current();
      });
    } else if (!isOpen && openRef.current) {
      openRef.current = false;
      popBackLayer();
    }
  }, [isOpen]);
}