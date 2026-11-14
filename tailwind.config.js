// Theme tokens (src/theme/tokens.ts) as Tailwind colours: bg-th-card,
// text-th-ink, from-th-bubble-mine, bg-th-primary/80 … The values are CSS
// variables set by ThemeProvider, so one class follows every theme.
const TOKENS = [
  'bg', 'panel', 'card', 'card-hover', 'input', 'border',
  'ink', 'ink-soft', 'ink-faint', 'link',
  'primary', 'on-primary', 'secondary', 'on-secondary', 'danger',
  'bubble-mine', 'bubble-mine-to', 'on-bubble-mine', 'bubble-theirs', 'on-bubble-theirs', 'chat-header', 'chat-header-to', 'on-chat-header', 'wallpaper',
  'toggle-on', 'toggle-off', 'badge', 'online',
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        th: Object.fromEntries(TOKENS.map((t) => [t, `rgb(var(--th-${t}) / <alpha-value>)`])),
      },
    },
  },
  plugins: [],
}
