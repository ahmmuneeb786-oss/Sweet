// Tokens -> CSS custom properties. Values are "R G B" channels so Tailwind
// classes like bg-th-card/60 can add opacity.
import { TOKEN_KEYS, cssVar, type Tokens } from './tokens';
import { hexToChannels, isDarkColor } from './color';

export function tokensToVars(tokens: Tokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const k of TOKEN_KEYS) vars[cssVar(k)] = hexToChannels(tokens[k]);
  return vars;
}

/** Paint tokens onto an element (the page root, or a preview box). */
export function applyTokens(el: HTMLElement, tokens: Tokens) {
  for (const [name, value] of Object.entries(tokensToVars(tokens))) el.style.setProperty(name, value);
}

/** Page-level extras: native control colours and the browser/PWA bar colour (the chat header colour, so on a phone
 * the status bar runs straight into the header). */
export function applyPageChrome(tokens: Tokens) {
  const root = document.documentElement;
  root.style.colorScheme = isDarkColor(tokens.bg) ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.chatHeader);
}
