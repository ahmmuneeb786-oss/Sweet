/**
 * Makes the browser/hardware back button close just the top-most open
 * screen (a chat, Settings, a profile panel, etc.) instead of leaving the
 * app entirely — without a full router migration.
 *
 * How it works: each open screen pushes one virtual history entry via
 * pushBackLayer(). A single shared popstate listener pops the most
 * recently opened one and calls its close handler. If a screen is closed
 * normally (its own X button, not the back button), it calls
 * popBackLayer() itself to remove its entry and keep the stack in sync —
 * otherwise back-button presses would build up "phantom" entries.
 *
 * Known limitation: this assumes screens mostly close in the reverse order
 * they opened (LIFO) — true for how this app's panels are actually used
 * (they close each other when switching, and nest predictably), but not
 * physically enforced. Worth knowing if a future screen breaks that pattern.
 */

type CloseHandler = () => void;
const stack: CloseHandler[] = [];

let listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    const handler = stack.pop();
    if (handler) handler();
  });
}

export function pushBackLayer(onClose: CloseHandler) {
  ensureListener();
  window.history.pushState({ appLayer: true }, '');
  stack.push(onClose);
}

/** Call when a layer closes WITHOUT the back button (its own close/X button). */
export function popBackLayer() {
  if (stack.length > 0) {
    stack.pop();
    window.history.back();
  }
}