import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN, contrast, readOwnThemes, schemePalette, tokensOf } from "../electron/themes.ts";

// The themes as electron/themes.ts makes them: no window - the palettes, the schemes read, the tokens they make.

/** The colour tokens turri-dark sets in the stylesheet: what every other theme has to set over it. */
function stylesheetColours(): string[] {
  const css = readFileSync(join(import.meta.dirname, "..", "src", "styles.css"), "utf8");
  const block = /:root,\s*:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)![1]!;
  // Not colours: the fonts and the square - and what is made of the colour tokens, so follows them.
  const made = new Set(["mono", "radius", "radius-small", "sans", "body", "shadow", "bevel", "pixel-border", "pixel-border-active", "glow-card", "float"]);
  return [...block.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((match) => match[1]!).filter((name) => !made.has(name));
}

const MOCHA_LEGACY = `scheme: "Catppuccin Mocha"
author: "https://github.com/catppuccin/catppuccin"
base00: "1e1e2e" # base
base01: "181825"
base02: "313244"
base03: "45475a"
base04: "585b70"
base05: "cdd6f4"
base06: "f5e0dc"
base07: "b4befe"
base08: "f38ba8"
base09: "fab387"
base0A: "f9e2af"
base0B: "a6e3a1"
base0C: "94e2d5"
base0D: "89b4fa"
base0E: "cba6f7"
base0F: "f2cdcd"
`;

const LATTE_TINTED = `system: "base24"
name: "Catppuccin Latte"
author: "https://github.com/catppuccin/catppuccin"
variant: "light"
palette:
  base00: "#eff1f5"
  base01: "#e6e9ef"
  base02: "#ccd0da"
  base03: "#bcc0cc"
  base04: "#acb0be"
  base05: "#4c4f69"
  base06: "#dc8a78"
  base07: "#7287fd"
  base08: "#d20f39"
  base09: "#fe640b"
  base0A: "#df8e1d"
  base0B: "#40a02b"
  base0C: "#179299"
  base0D: "#1e66f5"
  base0E: "#8839ef"
  base0F: "#dd7878"
  base10: "#e6e9ef"
  base11: "#dce0e8"
  base12: "#e64553"
  base13: "#df8e1d"
  base14: "#40a02b"
  base15: "#04a5e5"
  base16: "#7287fd"
  base17: "#ea76cb"
`;

test.describe("a theme", () => {
  test("sets every colour the stylesheet's turri-dark does, and nothing it does not", () => {
    const colours = stylesheetColours().sort();
    expect(colours.length).toBeGreaterThan(60);
    for (const theme of BUILT_IN.filter((each) => Object.keys(each.tokens).length > 0)) expect(Object.keys(theme.tokens).sort(), theme.info.id).toEqual(colours);
  });

  test("built in, reads: text on its background, and what is written on its accent and its button", () => {
    for (const { info, tokens } of BUILT_IN.filter((each) => Object.keys(each.tokens).length > 0)) {
      expect(contrast(tokens.fg!, tokens.bg!), `${info.id}: text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["fg-2"]!, tokens.bg!), `${info.id}: quieter text`).toBeGreaterThanOrEqual(3);
      for (const role of ["accent", "built", "tested", "plain-keyword", "plain-literal", "ansi-yellow"]) {
        expect(contrast(tokens[role]!, tokens.bg!), `${info.id}: ${role}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(tokens["on-accent"]!, tokens.accent!), `${info.id}: on the accent`).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens["on-action"]!, tokens.action!), `${info.id}: on the button`).toBeGreaterThanOrEqual(3);
    }
  });

  test("built in, has turri's own first, then Catppuccin's four flavours among the others", () => {
    const ids = BUILT_IN.map((each) => each.info.id);
    expect(ids.slice(0, 2)).toEqual(["turri-dark", "turri-light"]);
    expect(ids).toEqual(expect.arrayContaining(["catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha", "dracula", "nord", "gruvbox-dark", "solarized-light"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

test.describe("a base16 scheme", () => {
  test("is read flat, as tinted-theming's first schemes are, its comments and quotes aside", () => {
    const palette = schemePalette(MOCHA_LEGACY, "catppuccin-mocha.yaml");
    expect(palette).toMatchObject({ name: "Catppuccin Mocha", appearance: "dark", bg: "#1e1e2e", fg: "#cdd6f4", built: "#cba6f7", tested: "#94e2d5", green: "#a6e3a1" });
    expect(tokensOf(palette).bg).toBe("#1e1e2e");
  });

  test("is read with its colours under palette, light by its variant, Base24's bright magenta its pink", () => {
    const palette = schemePalette(LATTE_TINTED, "latte.yaml");
    expect(palette).toMatchObject({ name: "Catppuccin Latte", appearance: "light", bg: "#eff1f5", pink: "#ea76cb" });
  });

  test("is read from JSON, named by its file if it has no name, light or dark by its background", () => {
    const keys = Object.fromEntries([...MOCHA_LEGACY.matchAll(/^(base0[0-9A-F]): "([0-9a-f]+)"/gm)].map((match) => [match[1], `#${match[2]}`]));
    const palette = schemePalette(JSON.stringify({ ...keys, base00: "#fafafa" }), "/somewhere/paper.json");
    expect(palette).toMatchObject({ name: "paper", appearance: "light", bg: "#fafafa" });
  });

  test("that is not one says why", () => {
    expect(() => schemePalette(MOCHA_LEGACY.replace(/^base0E.*\n/m, ""), "x.yaml")).toThrow("it has no base0E");
    expect(() => schemePalette(MOCHA_LEGACY.replace('"1e1e2e"', '"midnight"'), "x.yaml")).toThrow('its base00, "midnight", is not a colour');
    expect(() => schemePalette(`system: "base17"\n${MOCHA_LEGACY}`, "x.yaml")).toThrow("it is a base17 scheme");
    expect(() => schemePalette("{ nope", "x.json")).toThrow("it could not be read as JSON");
  });

  test("in the themes folder is one of the person's own; anything else there is said to be wrong", () => {
    const dir = mkdtempSync(join(tmpdir(), "turri-themes-"));
    try {
      writeFileSync(join(dir, "mocha.yaml"), MOCHA_LEGACY);
      writeFileSync(join(dir, "broken.yml"), "base00: nothing");
      writeFileSync(join(dir, "notes.txt"), "not a scheme, not read");
      const { themes, problems } = readOwnThemes(dir);
      expect(themes.map((each) => each.info)).toEqual([expect.objectContaining({ id: "own:mocha.yaml", name: "Catppuccin Mocha", file: "mocha.yaml" })]);
      expect(problems).toEqual([{ file: "broken.yml", error: expect.stringContaining("it has no base01") }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
