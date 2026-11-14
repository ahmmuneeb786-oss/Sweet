// Theme colour names are written by hand in three places. If one falls out of
// step, a colour silently stops working (no error anywhere), so this check
// runs before every build and stops it with a clear message instead.
//
//   1. src/theme/tokens.ts   — the master list (TOKEN_GROUPS)
//   2. tailwind.config.js    — TOKENS: makes classes like bg-th-card exist
//   3. src/index.css :root   — first-paint defaults, must equal the Sweet preset
//
// Run alone: npm run check:theme
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const out = join(tmpdir(), `sweet-theme-check-${process.pid}.mjs`);

// The theme engine is TypeScript; bundle the pure modules so Node can load them.
await build({
  stdin: {
    contents: `
      export { TOKEN_KEYS, cssVar } from './src/theme/tokens';
      export { resolveTheme } from './src/theme/derive';
      export { getAppPreset } from './src/theme/presets';
      export { hexToChannels } from './src/theme/color';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error',
});
const { TOKEN_KEYS, cssVar, resolveTheme, getAppPreset, hexToChannels } = await import(pathToFileURL(out).href);
rmSync(out, { force: true });

const problems = [];
const master = TOKEN_KEYS.map((k) => cssVar(k).replace(/^--th-/, '')); // e.g. 'bubble-mine-to'

// 2. Tailwind list
const tw = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
const twBlock = tw.match(/const TOKENS = \[([\s\S]*?)\];/);
if (!twBlock) {
  problems.push('tailwind.config.js: could not find `const TOKENS = [...]`.');
} else {
  const twNames = [...twBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  for (const n of master) if (!twNames.includes(n)) problems.push(`tailwind.config.js: TOKENS is missing '${n}' (classes like bg-th-${n} won't exist).`);
  for (const n of twNames) if (!master.includes(n)) problems.push(`tailwind.config.js: TOKENS has '${n}', which isn't a token in src/theme/tokens.ts.`);
}

// 3. index.css defaults = Sweet preset
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
if (!rootBlock) {
  problems.push('src/index.css: could not find the :root block.');
} else {
  const cssVars = Object.fromEntries([...rootBlock[1].matchAll(/--th-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const sweet = resolveTheme(getAppPreset('sweet').data);
  TOKEN_KEYS.forEach((key, i) => {
    const name = master[i];
    const want = hexToChannels(sweet[key]);
    if (!(name in cssVars)) problems.push(`src/index.css: :root is missing --th-${name} (should be ${want}, Sweet's ${sweet[key]}).`);
    else if (cssVars[name] !== want) problems.push(`src/index.css: --th-${name} is ${cssVars[name]}, but Sweet's is ${want} (${sweet[key]}).`);
  });
  for (const n of Object.keys(cssVars)) if (!master.includes(n)) problems.push(`src/index.css: --th-${n} isn't a token in src/theme/tokens.ts.`);
}

if (problems.length) {
  console.error(`\nTheme colour lists are out of step (${problems.length}):\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`Theme colour lists in step: ${master.length} colours in tokens.ts, tailwind.config.js and index.css.`);
