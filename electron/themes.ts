/**
 * The window's colours. turri's own two themes are the stylesheet's (styles.css, `:root[data-theme]`); every other is a
 * palette made into the same colour tokens here, and given to the window to set over them:
 *
 * - built in: Catppuccin's four flavours and the editors' classics - each mapped by hand, its own names for its roles
 *   (regenerated, conformance tested, the accent, the jellyfish) where it has them;
 * - the person's own: a Base16 or Base24 scheme (tinted-theming's format, YAML or JSON) - the one palette format most
 *   themes are published in - in the app's themes folder, read again whenever it changes.
 *
 * Every token the stylesheet's turri-dark sets as a colour is set by `tokensOf`: tests/themes.spec.ts holds them alike.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

export type Appearance = "dark" | "light";

/** A theme as the settings sheet and the menu list it. */
export interface ThemeInfo {
  id: string;
  name: string;
  appearance: Appearance;
  /** Who made it, and where it is from - for a built-in one. */
  by?: string;
  url?: string;
  /** One of the person's own, from its file in the themes folder. */
  file?: string;
  /** A few of its colours, to show it by: its background, text, accent, regenerated and conformance tested. */
  swatch: string[];
}

/** The theme the window is in: its tokens, set over the stylesheet's - none for turri's own - and its background. */
export interface ResolvedTheme {
  id: string;
  name: string;
  appearance: Appearance;
  tokens: Record<string, string>;
  background: string;
}

export interface Theme {
  info: ThemeInfo;
  tokens: Record<string, string>;
}

/** A file in the themes folder that is not a theme: why. */
export interface ThemeProblem {
  file: string;
  error: string;
}

// ---------- colour ----------

type Rgb = [number, number, number];

function rgb(colour: string): Rgb | null {
  const hex = colour.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return [0, 1, 2].map((at) => parseInt(hex[at]! + hex[at]!, 16)) as Rgb;
  if (/^[0-9a-f]{6}$/i.test(hex)) return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
  return null;
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

/** `a` with `amount` of `b` in it: 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, amount: number): string {
  const from = rgb(a)!;
  const to = rgb(b)!;
  return hex(from.map((channel, at) => channel + (to[at]! - channel) * amount) as Rgb);
}

const alpha = (colour: string, opacity: number) => `rgba(${rgb(colour)!.join(", ")}, ${opacity})`;

function luminance(colour: string): number {
  const [r, g, b] = rgb(colour)!.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Of `a` and `b`, the one that reads better on `ground`. */
const onto = (ground: string, a: string, b: string) => (contrast(ground, a) >= contrast(ground, b) ? a : b);

/** `colour`, taken towards `text` until it reads on `ground` - as a light theme's yellow often does not. */
function legible(colour: string, ground: string, text: string, ratio = 3): string {
  let next = colour;
  for (let step = 1; step <= 10 && contrast(next, ground) < ratio; step++) next = mix(colour, text, step / 10);
  return next;
}

// ---------- palettes ----------

/**
 * A theme's colours as `tokensOf` reads them: its surfaces and text, its hues, and - where its own names say it better
 * than a hue does - its roles.
 */
export interface Palette {
  name: string;
  appearance: Appearance;
  by?: string;
  url?: string;
  bg: string;
  /** The sidebar and the second background; the card; a selected row; the lines. */
  sidebar?: string;
  card?: string;
  selected: string;
  line?: string;
  /** Text, quieter text (grauzone, in turri's words), and the faintest - comments, what is put away. */
  fg: string;
  fg2?: string;
  fg3: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;
  pink?: string;
  /** What is chosen or lit: the switch that is on, the active pixel border. Its blue unless said. */
  accent?: string;
  /** The primary button: its pink unless said. */
  action?: string;
  /** Regenerated, and conformance tested - turri's pink and cyan, wherever either shows. */
  built?: string;
  tested?: string;
  /** turri at work in the preview; the sentinel; where a click took the person, lit a moment. */
  testing?: string;
  sentinel?: string;
  lit?: string;
  /** ***plain's mark: its green unless said. */
  plainMark?: string;
  /** The jellyfish: its bell, the bell's shadow, its core and its tentacles. */
  jelly?: { bell?: string; shadow?: string; core?: string; tentacle?: string; highlight?: string };
}

/** The tokens a palette makes: every colour the stylesheet's turri-dark sets, as the window draws with it. */
export function tokensOf(p: Palette): Record<string, string> {
  const dark = p.appearance === "dark";
  const bg = p.bg;
  const fg = p.fg;
  const fg2 = p.fg2 ?? mix(fg, p.fg3, 0.45);
  const read = (colour: string, ratio = 3) => legible(colour, bg, fg, ratio);
  const pink = p.pink ?? p.purple;
  const accent = read(p.accent ?? p.blue);
  const action = p.action ?? pink;
  const built = read(p.built ?? pink);
  const tested = read(p.tested ?? p.cyan);
  const green = read(p.green);
  const red = read(p.red);
  const plainMark = p.plainMark ?? p.green;
  const onAccent = onto(accent, bg, fg);
  const bell = p.jelly?.bell ?? built;
  const shadow = p.jelly?.shadow ?? mix(p.blue, p.purple, 0.5);
  return {
    bg,
    "bg-2": p.sidebar ?? mix(bg, p.selected, 0.25),
    sidebar: p.sidebar ?? mix(bg, p.selected, 0.25),
    fg,
    "fg-2": fg2,
    "fg-3": p.fg3,
    line: p.line ?? mix(p.selected, p.fg3, 0.25),
    card: p.card ?? (dark ? mix(bg, p.selected, 0.45) : mix(bg, "#ffffff", 0.6)),
    hover: alpha(dark ? fg2 : fg, dark ? 0.08 : 0.05),
    selected: p.selected,
    accent,
    "accent-hover": mix(accent, dark ? "#ffffff" : bg, 0.25),
    "on-accent": onAccent,
    green,
    pink: read(pink),
    amber: read(p.yellow),
    red,
    "diff-add": mix(bg, p.green, dark ? 0.2 : 0.25),
    "diff-del": mix(bg, p.red, dark ? 0.2 : 0.25),
    overlay: alpha(dark ? bg : fg, dark ? 0.7 : 0.35),
    action,
    "action-hover": mix(action, "#ffffff", 0.2),
    "on-action": onto(action, bg, fg),
    edge: fg2,
    "edge-active": accent,
    glow: alpha(fg2, 0.18),
    "float-shade": dark ? alpha("#000000", 0.35) : alpha(fg, 0.12),
    "building-track": dark ? p.selected : alpha(fg, 0.12),
    built,
    tested,
    testing: read(p.testing ?? p.blue),
    lit: read(p.lit ?? p.yellow),
    sentinel: read(p.sentinel ?? mix(p.blue, p.purple, 0.5)),
    "plain-section": read(pink),
    "plain-concept": read(p.cyan),
    "plain-literal": read(p.green),
    "plain-link": read(p.blue),
    "plain-keyword": read(p.purple),
    "plain-meta": fg2,
    "plain-module": read(p.blue),
    "plain-comment": read(p.fg3),
    "plain-bullet": fg2,
    "plain-id": read(p.orange),
    "plain-mark": plainMark,
    "plain-mark-on-accent": contrast(plainMark, accent) >= 2 ? plainMark : onAccent,
    "ansi-black": dark ? p.selected : fg,
    "ansi-red": red,
    "ansi-green": green,
    "ansi-yellow": read(p.yellow),
    "ansi-blue": read(p.blue),
    "ansi-magenta": read(p.purple),
    "ansi-cyan": read(p.cyan),
    "ansi-white": fg2,
    "ansi-bright-black": p.fg3,
    "ansi-bright-white": fg,
    "jelly-bell": bell,
    "jelly-mid": mix(bell, shadow, 0.5),
    "jelly-shadow": shadow,
    "jelly-rim": mix(bell, dark ? bg : fg, 0.5),
    "jelly-core": p.jelly?.core ?? p.orange,
    "jelly-tentacle": p.jelly?.tentacle ?? tested,
    "jelly-highlight": p.jelly?.highlight ?? mix(bell, "#ffffff", 0.25),
    "jelly-ghost": fg2,
    "jelly-ground": p.line ?? mix(p.selected, p.fg3, 0.25),
  };
}

// ---------- built in ----------

interface Catppuccin {
  rosewater: string; flamingo: string; pink: string; mauve: string; red: string; maroon: string; peach: string; yellow: string;
  green: string; teal: string; sky: string; sapphire: string; blue: string; lavender: string; text: string; subtext1: string;
  subtext0: string; overlay2: string; overlay1: string; overlay0: string; surface2: string; surface1: string; surface0: string;
  base: string; mantle: string; crust: string;
}

/** A Catppuccin flavour, by its style guide: mauve the accent, pink what is regenerated, teal what is tested. */
function catppuccin(name: string, appearance: Appearance, c: Catppuccin): Palette {
  return {
    name: `Catppuccin ${name}`,
    appearance,
    by: "Catppuccin",
    url: "https://catppuccin.com",
    bg: c.base,
    sidebar: c.mantle,
    card: appearance === "dark" ? c.surface0 : mix(c.base, "#ffffff", 0.6),
    selected: c.surface1,
    line: c.surface1,
    fg: c.text,
    fg2: c.subtext0,
    fg3: c.overlay0,
    red: c.red,
    orange: c.peach,
    yellow: c.yellow,
    green: c.green,
    cyan: c.sky,
    blue: c.blue,
    purple: c.mauve,
    pink: c.pink,
    accent: c.mauve,
    action: c.pink,
    built: c.pink,
    tested: c.teal,
    sentinel: c.lavender,
    jelly: { bell: c.pink, shadow: c.mauve, core: c.peach, tentacle: c.teal, highlight: c.rosewater },
  };
}

const PALETTES: Record<string, Palette> = {
  "catppuccin-latte": catppuccin("Latte", "light", {
    rosewater: "#dc8a78", flamingo: "#dd7878", pink: "#ea76cb", mauve: "#8839ef", red: "#d20f39", maroon: "#e64553", peach: "#fe640b",
    yellow: "#df8e1d", green: "#40a02b", teal: "#179299", sky: "#04a5e5", sapphire: "#209fb5", blue: "#1e66f5", lavender: "#7287fd",
    text: "#4c4f69", subtext1: "#5c5f77", subtext0: "#6c6f85", overlay2: "#7c7f93", overlay1: "#8c8fa1", overlay0: "#9ca0b0",
    surface2: "#acb0be", surface1: "#bcc0cc", surface0: "#ccd0da", base: "#eff1f5", mantle: "#e6e9ef", crust: "#dce0e8",
  }),
  "catppuccin-frappe": catppuccin("Frappé", "dark", {
    rosewater: "#f2d5cf", flamingo: "#eebebe", pink: "#f4b8e4", mauve: "#ca9ee6", red: "#e78284", maroon: "#ea999c", peach: "#ef9f76",
    yellow: "#e5c890", green: "#a6d189", teal: "#81c8be", sky: "#99d1db", sapphire: "#85c1dc", blue: "#8caaee", lavender: "#babbf1",
    text: "#c6d0f5", subtext1: "#b5bfe2", subtext0: "#a5adce", overlay2: "#949cbb", overlay1: "#838ba7", overlay0: "#737994",
    surface2: "#626880", surface1: "#51576d", surface0: "#414559", base: "#303446", mantle: "#292c3c", crust: "#232634",
  }),
  "catppuccin-macchiato": catppuccin("Macchiato", "dark", {
    rosewater: "#f4dbd6", flamingo: "#f0c6c6", pink: "#f5bde6", mauve: "#c6a0f6", red: "#ed8796", maroon: "#ee99a0", peach: "#f5a97f",
    yellow: "#eed49f", green: "#a6da95", teal: "#8bd5ca", sky: "#91d7e3", sapphire: "#7dc4e4", blue: "#8aadf4", lavender: "#b7bdf8",
    text: "#cad3f5", subtext1: "#b8c0e0", subtext0: "#a5adcb", overlay2: "#939ab7", overlay1: "#8087a2", overlay0: "#6e738d",
    surface2: "#5b6078", surface1: "#494d64", surface0: "#363a4f", base: "#24273a", mantle: "#1e2030", crust: "#181926",
  }),
  "catppuccin-mocha": catppuccin("Mocha", "dark", {
    rosewater: "#f5e0dc", flamingo: "#f2cdcd", pink: "#f5c2e7", mauve: "#cba6f7", red: "#f38ba8", maroon: "#eba0ac", peach: "#fab387",
    yellow: "#f9e2af", green: "#a6e3a1", teal: "#94e2d5", sky: "#89dceb", sapphire: "#74c7ec", blue: "#89b4fa", lavender: "#b4befe",
    text: "#cdd6f4", subtext1: "#bac2de", subtext0: "#a6adc8", overlay2: "#9399b2", overlay1: "#7f849c", overlay0: "#6c7086",
    surface2: "#585b70", surface1: "#45475a", surface0: "#313244", base: "#1e1e2e", mantle: "#181825", crust: "#11111b",
  }),
  dracula: {
    name: "Dracula", appearance: "dark", by: "Dracula", url: "https://draculatheme.com",
    bg: "#282a36", sidebar: "#21222c", card: "#2f3140", selected: "#44475a", line: "#44475a",
    fg: "#f8f8f2", fg2: "#b4b8cf", fg3: "#6272a4",
    red: "#ff5555", orange: "#ffb86c", yellow: "#f1fa8c", green: "#50fa7b", cyan: "#8be9fd", blue: "#bd93f9", purple: "#bd93f9", pink: "#ff79c6",
    accent: "#bd93f9", built: "#ff79c6", tested: "#8be9fd", testing: "#8be9fd", sentinel: "#bd93f9",
  },
  nord: {
    name: "Nord", appearance: "dark", by: "Arctic Ice Studio", url: "https://www.nordtheme.com",
    bg: "#2e3440", sidebar: "#2b303b", card: "#3b4252", selected: "#434c5e", line: "#434c5e",
    fg: "#eceff4", fg2: "#d8dee9", fg3: "#616e88",
    red: "#bf616a", orange: "#d08770", yellow: "#ebcb8b", green: "#a3be8c", cyan: "#88c0d0", blue: "#81a1c1", purple: "#b48ead",
    accent: "#88c0d0", built: "#b48ead", tested: "#8fbcbb", testing: "#5e81ac", sentinel: "#81a1c1",
  },
  "gruvbox-dark": {
    name: "Gruvbox Dark", appearance: "dark", by: "Pavel Pertsev", url: "https://github.com/morhetz/gruvbox",
    bg: "#282828", sidebar: "#1d2021", card: "#32302f", selected: "#504945", line: "#3c3836",
    fg: "#ebdbb2", fg2: "#bdae93", fg3: "#928374",
    red: "#fb4934", orange: "#fe8019", yellow: "#fabd2f", green: "#b8bb26", cyan: "#8ec07c", blue: "#83a598", purple: "#d3869b",
    accent: "#8ec07c", built: "#d3869b", tested: "#8ec07c",
  },
  "gruvbox-light": {
    name: "Gruvbox Light", appearance: "light", by: "Pavel Pertsev", url: "https://github.com/morhetz/gruvbox",
    bg: "#fbf1c7", sidebar: "#f2e5bc", card: "#f9f5d7", selected: "#ebdbb2", line: "#d5c4a1",
    fg: "#3c3836", fg2: "#665c54", fg3: "#928374",
    red: "#9d0006", orange: "#af3a03", yellow: "#b57614", green: "#79740e", cyan: "#427b58", blue: "#076678", purple: "#8f3f71",
    accent: "#427b58", action: "#d3869b", built: "#8f3f71", tested: "#427b58",
  },
  "solarized-dark": {
    name: "Solarized Dark", appearance: "dark", by: "Ethan Schoonover", url: "https://ethanschoonover.com/solarized/",
    bg: "#002b36", sidebar: "#00252f", card: "#073642", selected: "#0b4452", line: "#0b4452",
    fg: "#93a1a1", fg2: "#839496", fg3: "#586e75",
    red: "#dc322f", orange: "#cb4b16", yellow: "#b58900", green: "#859900", cyan: "#2aa198", blue: "#268bd2", purple: "#6c71c4", pink: "#d33682",
    accent: "#268bd2", built: "#d33682", tested: "#2aa198",
  },
  "solarized-light": {
    name: "Solarized Light", appearance: "light", by: "Ethan Schoonover", url: "https://ethanschoonover.com/solarized/",
    bg: "#fdf6e3", sidebar: "#eee8d5", card: "#fffcf4", selected: "#eee8d5", line: "#e0d9c4",
    fg: "#586e75", fg2: "#657b83", fg3: "#93a1a1",
    red: "#dc322f", orange: "#cb4b16", yellow: "#b58900", green: "#859900", cyan: "#2aa198", blue: "#268bd2", purple: "#6c71c4", pink: "#d33682",
    accent: "#268bd2", built: "#d33682", tested: "#2aa198",
  },
  "tokyo-night": {
    name: "Tokyo Night", appearance: "dark", by: "enkia", url: "https://github.com/tokyo-night/tokyo-night-vscode-theme",
    bg: "#1a1b26", sidebar: "#16161e", card: "#1f2335", selected: "#283457", line: "#292e42",
    fg: "#c0caf5", fg2: "#a9b1d6", fg3: "#565f89",
    red: "#f7768e", orange: "#ff9e64", yellow: "#e0af68", green: "#9ece6a", cyan: "#7dcfff", blue: "#7aa2f7", purple: "#bb9af7",
    accent: "#7aa2f7", built: "#bb9af7", tested: "#73daca", sentinel: "#9d7cd8",
  },
  "one-dark": {
    name: "One Dark", appearance: "dark", by: "Atom", url: "https://github.com/atom/atom/tree/master/packages/one-dark-ui",
    bg: "#282c34", sidebar: "#21252b", card: "#2c313a", selected: "#3e4451", line: "#3b4048",
    fg: "#abb2bf", fg2: "#9da5b4", fg3: "#5c6370",
    red: "#e06c75", orange: "#d19a66", yellow: "#e5c07b", green: "#98c379", cyan: "#56b6c2", blue: "#61afef", purple: "#c678dd",
    accent: "#61afef", built: "#c678dd", tested: "#56b6c2",
  },
  "rose-pine": {
    name: "Rosé Pine", appearance: "dark", by: "Rosé Pine", url: "https://rosepinetheme.com",
    bg: "#191724", sidebar: "#1f1d2e", card: "#26233a", selected: "#403d52", line: "#403d52",
    fg: "#e0def4", fg2: "#908caa", fg3: "#6e6a86",
    red: "#eb6f92", orange: "#ebbcba", yellow: "#f6c177", green: "#9ccfd8", cyan: "#9ccfd8", blue: "#31748f", purple: "#c4a7e7", pink: "#ebbcba",
    accent: "#c4a7e7", built: "#ebbcba", tested: "#9ccfd8", testing: "#9ccfd8", sentinel: "#c4a7e7",
    jelly: { bell: "#eb6f92", shadow: "#c4a7e7", core: "#f6c177", tentacle: "#9ccfd8", highlight: "#ebbcba" },
  },
  "rose-pine-dawn": {
    name: "Rosé Pine Dawn", appearance: "light", by: "Rosé Pine", url: "https://rosepinetheme.com",
    bg: "#faf4ed", sidebar: "#f2e9e1", card: "#fffaf3", selected: "#dfdad9", line: "#cecacd",
    fg: "#575279", fg2: "#797593", fg3: "#9893a5",
    red: "#b4637a", orange: "#d7827e", yellow: "#ea9d34", green: "#56949f", cyan: "#56949f", blue: "#286983", purple: "#907aa9", pink: "#d7827e",
    accent: "#907aa9", action: "#b4637a", built: "#b4637a", tested: "#56949f", sentinel: "#907aa9",
    jelly: { bell: "#b4637a", shadow: "#907aa9", core: "#ea9d34", tentacle: "#56949f", highlight: "#d7827e" },
  },
};

/** turri's own: the stylesheet's tokens, so none set over them - only what the menu and the sheet show them by. */
const TURRI: Theme[] = [
  { info: { id: "turri-dark", name: "turri dark", appearance: "dark", swatch: ["#0a0f1a", "#f4f7f9", "#5ce1e6", "#ff5c8d", "#5ce1e6"] }, tokens: {} },
  { info: { id: "turri-light", name: "turri light", appearance: "light", swatch: ["#f4f7f9", "#0a0f1a", "#732553", "#d63a6f", "#22878b"] }, tokens: {} },
];

const themeOf = (id: string, palette: Palette, file?: string): Theme => {
  const tokens = tokensOf(palette);
  return {
    info: {
      id,
      name: palette.name,
      appearance: palette.appearance,
      ...(palette.by ? { by: palette.by } : {}),
      ...(palette.url ? { url: palette.url } : {}),
      ...(file ? { file } : {}),
      swatch: [tokens.bg!, tokens.fg!, tokens.accent!, tokens.built!, tokens.tested!],
    },
    tokens,
  };
};

export const BUILT_IN: Theme[] = [...TURRI, ...Object.entries(PALETTES).map(([id, palette]) => themeOf(id, palette))];

export const DEFAULT_DARK = "turri-dark";
export const DEFAULT_LIGHT = "turri-light";

/** A theme's background, as the window's own colour behind the page has it. */
export const backgroundOf = (theme: Theme) => theme.tokens.bg ?? theme.info.swatch[0]!;

// ---------- the person's own: Base16 and Base24 ----------

const BASE16 = Array.from({ length: 16 }, (_, at) => `base0${at.toString(16).toUpperCase()}`);
const BASE24 = Array.from({ length: 8 }, (_, at) => `base1${at}`);

/** A value as YAML writes it: quoted or not, with or without a comment after. */
function scalar(raw: string): string {
  const value = raw.trim();
  const quoted = /^(["'])(.*)\1/.exec(value);
  if (quoted) return quoted[2]!;
  return value.replace(/\s+#.*$/, "").trim();
}

/**
 * A scheme's keys, from its YAML - tinted-theming's, flat (`base00: "1e1e2e"`) or with its colours under `palette:` - or
 * its JSON: only `key: value` lines, which is all a scheme has.
 */
function schemeKeys(text: string): Record<string, string> {
  if (text.trimStart().startsWith("{")) {
    const json = JSON.parse(text) as Record<string, unknown>;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...json, ...(typeof json.palette === "object" && json.palette !== null ? (json.palette as object) : {}) })) {
      if (typeof value === "string") flat[key] = value;
    }
    return flat;
  }
  const keys: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const pair = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (pair && pair[2]!.trim() !== "") keys[pair[1]!] = scalar(pair[2]!);
  }
  return keys;
}

/**
 * A Base16 or Base24 scheme as a palette, by Base16's own roles: base00 to base07 the surfaces to the text, base08 to
 * base0F red, orange, yellow, green, cyan, blue, purple and brown - Base24's bright ones beside. Throws, in words for the
 * person, if it is not one.
 */
export function schemePalette(text: string, file: string): Palette {
  let keys: Record<string, string>;
  try {
    keys = schemeKeys(text);
  } catch (error) {
    throw new Error(`it could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (keys.system !== undefined && !/^base(16|24)$/.test(keys.system)) throw new Error(`it is a ${keys.system} scheme - turri reads base16 and base24 ones.`);
  const colour = (key: string) => {
    const value = keys[key];
    if (value === undefined) return undefined;
    const parsed = rgb(value);
    if (parsed === null) throw new Error(`its ${key}, "${value}", is not a colour.`);
    return hex(parsed);
  };
  const missing = BASE16.filter((key) => keys[key] === undefined && keys[key.toLowerCase()] === undefined);
  if (missing.length > 0) throw new Error(`it has no ${missing.join(", ")} - a base16 scheme has base00 to base0F.`);
  // Base16's keys are written base0A or base0a, as each scheme has it.
  const base = (n: string) => colour(`base${n}`) ?? colour(`base${n.toLowerCase()}`)!;
  const bright = Object.fromEntries(BASE24.map((key) => [key, colour(key)]).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const bg = base("00");
  const appearance: Appearance = keys.variant === "light" || keys.variant === "dark" ? keys.variant : luminance(bg) > 0.4 ? "light" : "dark";
  return {
    name: keys.name ?? keys.scheme ?? basename(file, extname(file)),
    appearance,
    ...(keys.author ? { by: keys.author } : {}),
    bg,
    sidebar: mix(bg, base("01"), 0.5),
    card: base("01"),
    selected: base("02"),
    line: mix(base("02"), base("03"), 0.3),
    fg: base("05"),
    fg2: base("04"),
    fg3: base("03"),
    red: base("08"),
    orange: base("09"),
    yellow: base("0A"),
    green: base("0B"),
    cyan: base("0C"),
    blue: base("0D"),
    purple: base("0E"),
    ...(bright.base17 ? { pink: bright.base17 } : {}),
    accent: base("0D"),
    built: base("0E"),
    tested: base("0C"),
  };
}

/** The files a themes folder may hold. */
export const SCHEME_FILES = new Set([".yaml", ".yml", ".json"]);

/** The person's own themes, each a scheme file in `dir` - and why any other file there is not one. */
export function readOwnThemes(dir: string): { themes: Theme[]; problems: ThemeProblem[] } {
  const themes: Theme[] = [];
  const problems: ThemeProblem[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => SCHEME_FILES.has(extname(file).toLowerCase())).sort();
  } catch {
    return { themes, problems };
  }
  for (const file of files) {
    try {
      themes.push(themeOf(ownId(file), schemePalette(readFileSync(join(dir, file), "utf8"), file), file));
    } catch (error) {
      problems.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { themes, problems };
}

/** One of the person's own themes, by its file's name. */
export const ownId = (file: string) => `own:${file}`;
