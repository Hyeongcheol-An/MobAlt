// Themes: the terminal palettes (xterm.js ITheme objects) and the chrome palette derived from each of them —
// window, panels, dialogs, menus, toasts, banners, status colours — so that Settings → Theme recolours the whole
// program, not only the terminal area. Pure colour maths, no DOM: app.js puts the tokens on <html>, main.js gets
// the window background, test/unit/theme.test.js asserts the contrast guarantees for every theme.

export const THEMES = {
  'moba-dark': { background: '#1e1e1e', foreground: '#ececec', cursor: '#b4b4c0', cursorAccent: '#1e1e1e', selectionBackground: 'rgba(78,161,255,.35)',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff' },
  'one-dark': { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: 'rgba(82,139,255,.3)',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: 'rgba(68,71,90,.8)',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  'solarized-dark': { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: 'rgba(7,54,66,.9)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  'gruvbox-dark': { background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: 'rgba(80,73,69,.9)',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' },
  light: { background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: 'rgba(0,120,215,.25)',
    black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
    brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5' },
};

// ---------- colour maths ('#rrggbb' in, '#rrggbb' out) ----------
export const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
/** `a` weighted by `t` (0…1) over `b`: mix(a, b, 1) is `a`, mix(a, b, 0) is `b`. */
export const mix = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(...A.map((v, i) => v * t + B[i] * (1 - t)));
};
export const lighten = (hex, t) => mix('#ffffff', hex, t);
export const darken = (hex, t) => mix('#000000', hex, t);
/** Relative luminance (WCAG): 0 black … 1 white. */
export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio between two colours (1 … 21). */
export const contrast = (a, b) => {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
/** `fg` moved towards `towards` (usually white or black) in 2% steps until it reads at `min`:1 on `bg`. */
export function ensureContrast(fg, bg, min, towards) {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(towards, fg, t);
    if (contrast(c, bg) >= min) return c;
  }
  return towards;
}
/** The same for several backgrounds at once (they are all on one side of `fg`, so the furthest move wins). */
export function ensureContrastAll(fg, bgs, min, towards) {
  let c = fg;
  for (let pass = 0; pass < 2; pass++) for (const bg of bgs) c = ensureContrast(c, bg, min, towards);
  return c;
}
/** A fill colour pushed (darker under light text, lighter under dark text) until `text` reads at `min`:1 on it. */
export function fillFor(fill, text, min) {
  return ensureContrast(fill, text, min, luminance(text) > 0.5 ? '#000000' : '#ffffff');
}
export const isLightTheme = (theme) => luminance(theme.background || '#1e1e1e') > 0.4;

/**
 * Taste overrides on top of the derivation (any token name chromePalette() returns). The values are seeds: the contrast
 * passes still run over them, so an override that already reads well is kept exactly and one that does not is nudged.
 * moba-dark pins the chrome MobAlt has always had (it is the reference look); light is a proper light application.
 */
export const CHROME_OVERRIDES = {
  'moba-dark': {
    bg: '#1e1f22', 'bg-panel': '#26282c', 'bg-elev': '#2e3136', 'bg-dialog': '#26282c', 'bg-control': '#2e3136', 'bg-input': '#1e1f22',
    'bg-hover': '#2e3136', 'bg-active': '#383b41', divider: '#3a3d43',
    fg: '#d7dae0', 'fg-dim': '#9aa0a8', 'fg-faint': '#8a9099',
    accent: '#4ea1ff', selection: '#2a6fc4', 'selection-fg-dim': '#dbe9ff',
    danger: '#e5534b', 'danger-fg': '#ffb3ae', 'danger-bg': '#5a2d2d', 'danger-fill': '#c9403a',
    warn: '#e6b422', 'warn-fg': '#ffe3c2', 'warn-bg': '#5a3a1e',
    ok: '#4caf50', 'ok-fg': '#c9f5cf', 'ok-bg': '#2f5e36',
    'info-bg': '#203a5a', 'info-fg': '#dbe9ff', 'info-border': '#4f6f94',
    scrollbar: '#4a4e56',
    'ico-ssh': '#7cc4ff', 'ico-local': '#9ad28e', 'ico-telnet': '#e3c36d', 'ico-rdp': '#8fb5ff', 'ico-vnc': '#d99cff',
  },
  light: {
    bg: '#f5f6f8', 'bg-panel': '#e9ebee', 'bg-elev': '#ffffff', 'bg-dialog': '#ffffff', 'bg-control': '#f7f8fa', 'bg-input': '#ffffff',
    'bg-hover': '#dfe2e7', 'bg-active': '#d0d4db', divider: '#d4d7dc',
    accent: '#1a5fb4', selection: '#2a6fc4', scrollbar: '#c1c5cc',
  },
};

/**
 * The chrome palette for a terminal theme: a map of token name → '#rrggbb' (plus `scheme` and two alpha values) that
 * styles.css reads as `--<name>`. Dark themes get a chrome a step lighter than the terminal background in the
 * theme's own hue; a light theme (luminance > .4) gets near-white panels and dark text. Guarantees, asserted in
 * test/unit/theme.test.js for every theme: text tokens read at ≥ 4.5:1 on every surface they sit on, the accent at
 * ≥ 4.5:1 and borders at ≥ 3:1 on the main surfaces and on the hover surface (focused pane head, hovered rows),
 * status/icon colours at ≥ 3:1, and the text on accent fills (selection, primary button, danger button) at ≥ 4.5:1.
 */
export function chromePalette(theme, name) {
  theme = theme || THEMES['moba-dark'];
  name = name || Object.keys(THEMES).find((k) => THEMES[k] === theme) || '';
  const o = CHROME_OVERRIDES[name] || {};
  const pick = (key, derived) => o[key] || derived;
  const bg0 = theme.background || '#1e1e1e', fg0 = theme.foreground || '#ececec';
  const light = isLightTheme(theme);
  const strong = light ? '#000000' : '#ffffff'; // the direction text moves to gain contrast
  const step = (c, t) => (light ? darken(c, t) : lighten(c, t)); // "a step away from the terminal background"

  // surfaces
  const bg = pick('bg', light ? darken(bg0, 0.03) : bg0);
  const bgPanel = pick('bg-panel', step(bg0, light ? 0.07 : 0.045));
  const bgElev = pick('bg-elev', light ? bg0 : lighten(bg0, 0.08));
  const bgDialog = pick('bg-dialog', light ? bgElev : bgPanel);
  const bgHover = pick('bg-hover', step(bg0, light ? 0.10 : 0.09));
  const bgActive = pick('bg-active', step(bg0, light ? 0.16 : 0.14));
  const bgControl = pick('bg-control', light ? bg : bgHover);
  const bgInput = pick('bg-input', light ? bgElev : bg);
  const divider = pick('divider', step(bg0, light ? 0.17 : 0.15));
  const surfaces = [bg, bgPanel, bgElev, bgDialog, bgControl, bgInput, bgHover, bgActive];
  const textSurfaces = surfaces.filter((s) => s !== bgActive); // dim text never sits on the pressed/active fill
  const lineSurfaces = [bg, bgPanel, bgElev, bgDialog];
  const accentSurfaces = [...lineSurfaces, bgHover]; // the accent and the outlines also sit on hovered rows and the focused pane head

  // lines and text: `border` outlines controls (inputs, buttons, chips: 3:1), `divider` is the hairline between surfaces
  const border = ensureContrastAll(pick('border', mix(fg0, bg, 0.45)), accentSurfaces, 3, strong);
  const fg = ensureContrastAll(pick('fg', fg0), surfaces, 4.5, strong);
  const fgDim = ensureContrastAll(pick('fg-dim', mix(fg, bg, 0.72)), textSurfaces, 4.5, strong);
  const fgFaint = ensureContrastAll(pick('fg-faint', mix(fg, bg, 0.62)), textSurfaces, 4.5, strong);
  const fgStrong = pick('fg-strong', strong);

  // accent: the theme's blue as text/ring colour (4.5:1), and as a fill that carries white text
  const blue = theme.blue || '#2472c8';
  const accentBase = o.accent || [blue, theme.brightBlue].filter(Boolean).find((c) => accentSurfaces.every((s) => contrast(c, s) >= 4.5)) || blue;
  const accent = ensureContrastAll(accentBase, accentSurfaces, 4.5, strong);
  const selectionFg = pick('selection-fg', '#ffffff');
  const selection = fillFor(pick('selection', o['accent-2'] || blue), selectionFg, 4.5);
  const accent2 = fillFor(pick('accent-2', selection), selectionFg, 4.5);
  const selectionHover = fillFor(pick('selection-hover', light ? darken(selection, 0.12) : lighten(selection, 0.12)), selectionFg, 4.5);
  const dangerFill = fillFor(pick('danger-fill', theme.red || '#e5534b'), selectionFg, 4.5); // the danger button and a hovered / focused danger menu item
  const selectionFgDim = ensureContrastAll(pick('selection-fg-dim', mix(selectionFg, selection, 0.85)), [selection, selectionHover, accent2, dangerFill], 4.5, selectionFg);

  // status colours: dot/icon level (3:1 on the panels), a tinted fill, and a text level (4.5:1 on the panels and the fill)
  // (the text level is seeded from the colour itself, not the theme's "bright" slot: Solarized keeps greys there)
  const status = (key, base) => {
    const c = ensureContrastAll(pick(key, base), [bg, bgPanel], 3, strong);
    const tint = pick(key + '-bg', mix(c, bgPanel, light ? 0.16 : 0.3));
    const text = ensureContrastAll(pick(key + '-fg', light ? c : lighten(c, 0.3)), [...textSurfaces, tint], 4.5, strong);
    return [c, text, tint];
  };
  const [danger, dangerFg, dangerBg] = status('danger', theme.red || '#e5534b');
  const [warn, warnFg, warnBg] = status('warn', theme.yellow || '#e6b422');
  const [ok, okFg, okBg] = status('ok', theme.green || '#4caf50');
  const infoBg = pick('info-bg', mix(selection, bgPanel, light ? 0.14 : 0.45));
  const infoFg = ensureContrastAll(pick('info-fg', light ? accent : selectionFgDim), [infoBg], 4.5, strong);
  const infoBorder = ensureContrastAll(pick('info-border', mix(accent, infoBg, 0.5)), [infoBg], 3, strong);
  const icon = (key, base) => ensureContrastAll(pick(key, base), [bg, bgPanel], 3, strong);

  return {
    scheme: light ? 'light' : 'dark',
    bg, 'bg-panel': bgPanel, 'bg-elev': bgElev, 'bg-dialog': bgDialog, 'bg-control': bgControl, 'bg-input': bgInput, 'bg-hover': bgHover, 'bg-active': bgActive,
    border, divider,
    fg, 'fg-dim': fgDim, 'fg-faint': fgFaint, 'fg-strong': fgStrong,
    accent, 'accent-2': accent2, selection, 'selection-fg': selectionFg, 'selection-fg-dim': selectionFgDim, 'selection-hover': selectionHover,
    danger, 'danger-fg': dangerFg, 'danger-bg': dangerBg, 'danger-fill': dangerFill,
    warn, 'warn-fg': warnFg, 'warn-bg': warnBg,
    ok, 'ok-fg': okFg, 'ok-bg': okBg,
    'info-bg': infoBg, 'info-fg': infoFg, 'info-border': infoBorder,
    scrollbar: pick('scrollbar', step(bg0, light ? 0.25 : 0.2)),
    'shadow-a': light ? '.18' : '.4', 'backdrop-a': light ? '.3' : '.45',
    'ico-ssh': icon('ico-ssh', accent), 'ico-local': icon('ico-local', ok), 'ico-telnet': icon('ico-telnet', warn),
    'ico-rdp': icon('ico-rdp', accent), 'ico-vnc': icon('ico-vnc', theme.magenta || accent),
  };
}

/**
 * The xterm theme a pane paints with: the palette plus a text-selection band derived from it. The band is the theme's
 * blue mixed into the terminal background and pushed until it reads at ≥ 2:1 against it (Solarized's own selection
 * was 1.14:1: invisible). The theme's text stays on the band where it still reads at ≥ 3:1; where it would not (One
 * Dark, Solarized: dim foregrounds), the selected text is drawn in white / black instead (`selectionForeground`,
 * ≥ 4.5:1 on the band). The same band is used while the terminal is unfocused.
 */
export function terminalTheme(theme) {
  theme = theme || THEMES['moba-dark'];
  const bg = theme.background || '#1e1e1e', fg = theme.foreground || '#ececec', light = isLightTheme(theme);
  const strong = light ? '#000000' : '#ffffff';
  const band = ensureContrast(mix(theme.blue || '#2472c8', bg, 0.45), bg, 2, strong);
  const t = { ...theme, selectionBackground: band, selectionInactiveBackground: band };
  if (contrast(fg, band) >= 3) delete t.selectionForeground;
  else t.selectionForeground = ensureContrast(strong, band, 4.5, strong);
  return t;
}

/** The palette as CSS custom properties: { '--bg': '#1e1f22', … } (everything but `scheme`). */
export const cssVars = (palette) => Object.fromEntries(Object.entries(palette).filter(([k]) => k !== 'scheme').map(([k, v]) => ['--' + k, v]));

/**
 * Find-bar highlight colours for a terminal palette: the matches in a tint of the theme's blue, the active match in a tint
 * of its yellow, both pushed towards the terminal background until the theme's own text reads on them (4.5:1 — or 3:1 on
 * a theme whose text is so dim that a 4.5:1 highlight would vanish into the background, like Solarized). The active match
 * keeps a full-strength yellow border so it stands out from the other matches.
 */
export function searchDecorations(theme) {
  const bg = theme.background || '#1e1e1e', fg = theme.foreground || '#ececec', light = isLightTheme(theme);
  const blue = theme.blue || '#0451a5', yellow = theme.yellow || '#e6b422';
  const highlight = (seed) => {
    const c = ensureContrast(seed, fg, 4.5, bg);
    return contrast(c, bg) >= 1.4 ? c : ensureContrast(seed, fg, 3, bg);
  };
  const matchBackground = highlight(mix(blue, bg, light ? 0.25 : 0.55));
  const activeMatchBackground = highlight(mix(yellow, bg, light ? 0.45 : 0.55));
  const activeMatchBorder = ensureContrast(yellow, bg, 3, fg);
  return { matchBackground, activeMatchBackground, activeMatchBorder, matchOverviewRuler: mix(fg, bg, 0.5), activeMatchColorOverviewRuler: activeMatchBorder };
}
