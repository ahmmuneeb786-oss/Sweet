// Colours for panels opened from inside a chat (profile, menus, sheets,
// photo viewer, confirm dialogs). ChatWindow decides them:
//   mobile  -> the chat's own theme (the chat fills the screen, so its
//              panels should feel like part of it)
//   desktop -> the app theme (the chat is only the right half)
// Panels portalled to <body> can't inherit CSS variables from the chat's
// root element, so they read them from here and put them on their own root.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

const PanelThemeContext = createContext<CSSProperties | undefined>(undefined);

export function PanelThemeScope({ style, children }: { style: CSSProperties | undefined; children: ReactNode }) {
  return <PanelThemeContext.Provider value={style}>{children}</PanelThemeContext.Provider>;
}

/** CSS variables for a panel's root, or undefined to use the app theme. */
export function usePanelThemeStyle(): CSSProperties | undefined {
  return useContext(PanelThemeContext);
}
