import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, offers, test } from "./app.ts";
import { keys } from "./keys.ts";

/** A functional spec's mark in the gutter, by its number. */
const mark = (window: Page, frid: number) => window.locator(`.editor-colours .mark[aria-label^="functional spec ${frid},"]`);

/** The caret at the end of the spec, for typing there: no key does it on every system - ⌘End is not macOS's. */
const atTheEnd = (window: Page) =>
  window.locator(".editor textarea").evaluate((area: HTMLTextAreaElement) => {
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });

test.describe("the spec editor", () => {
  test("shows the spec, coloured by turri's grammar, with its functional spec marked", async ({ launched: { window } }) => {
    await expect(window.locator(".editor-pane .pane-header")).toContainText("0 of 1 regenerated");
    // Named beside ***plain's own mark, in its green.
    await expect(window.locator(".editor-pane .pane-header img.plain-mark")).toHaveAttribute("src", "./plain/plain-mark.svg");
    // And in the tree, its state beside how much of it is built.
    const row = window.locator(".tree-row", { hasText: "hello.plain" });
    await expect(row.locator("img.plain-mark")).toBeVisible();
    await expect(row.locator(".tree-state")).toHaveAttribute("title", "not built");
    await expect(window.locator(".editor-colours .plain-concept").first()).toBeVisible();
    // In the coloured layer, which is hidden from the accessibility tree: the textarea over it reads the spec.
    await expect(mark(window, 1)).toHaveAttribute("aria-label", "functional spec 1, to build");
  });

  test("takes the pane's whole width, as far in from the right as from the left, wrapping what is longer", async ({ launched: { window } }) => {
    await window.setViewportSize({ width: 2200, height: 900 });
    await expect(window.locator(".editor textarea")).toHaveValue(/Greeter/);
    await atTheEnd(window);
    await window.keyboard.type(`\n- :Greeter: ${"says hello again and again, ".repeat(40)}then stops.`);
    const measured = await window.evaluate(() => {
      const editor = document.querySelector<HTMLElement>(".editor")!.getBoundingClientRect();
      const pre = document.querySelector<HTMLPreElement>(".editor-colours")!;
      const style = getComputedStyle(pre);
      const box = pre.getBoundingClientRect();
      const text = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
      const last = pre.lastElementChild as HTMLElement;
      return { left: text.left - editor.left, right: editor.right - text.right, wide: editor.width, lines: last.offsetHeight / parseFloat(style.lineHeight) };
    });
    // Far wider than the 920px it used to be kept to.
    expect(measured.wide).toBeGreaterThan(1000);
    // A scrollbar, if any, is on the right: within its width of symmetric.
    expect(Math.abs(measured.left - measured.right)).toBeLessThanOrEqual(16);
    // The long line wraps within it.
    expect(measured.lines).toBeGreaterThan(1.5);
  });

  test("keeps its two layers alike, so the caret is on the line it shows", async ({ launched: { window } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    // A line long enough to wrap: both layers must wrap it at the same place.
    await atTheEnd(window);
    await window.keyboard.type(`\n- :Greeter: ${"says hello again and again, ".repeat(12)}then stops.`);

    const layers = await window.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>(".editor textarea")!;
      const pre = document.querySelector<HTMLPreElement>(".editor-colours")!;
      const of = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          width: box.width,
          font: `${style.fontFamily} ${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.letterSpacing}`,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
          wrap: `${style.whiteSpace} ${style.overflowWrap} ${style.wordBreak} ${style.tabSize}`,
        };
      };
      return { area: of(area), pre: of(pre), coloured: pre.offsetHeight, height: area.clientHeight, scroll: area.scrollHeight };
    });
    expect(layers.area).toEqual(layers.pre);
    // The textarea is as tall as the coloured text - or the editor, when that is taller - and scrolls nothing inside
    // itself, out of step with the other layer.
    expect(layers.height).toBeGreaterThanOrEqual(layers.coloured);
    expect(layers.scroll).toBeLessThanOrEqual(layers.height);
  });

  test("colours code - a resource the ***plain links - in its palette, its two layers alike", async ({ launched: { window, project, spec } }) => {
    // The tree shows a resource the ***plain links: on a turri whose graph gives them.
    test.skip(!(await offers(window)).resources, "the turri running gives no linked resources in its graph");
    mkdirSync(join(project, "resources"));
    writeFileSync(join(project, "resources", "database.yaml"), '# where the greetings are kept\ntables:\n  greetings:\n    name: "greeting"\n    rows: 3\n');
    writeFileSync(spec, readFileSync(spec, "utf8").replace("greets the person running it.", "greets the person running it, as [the database](resources/database.yaml) says."));
    await window.locator(".tree-row", { hasText: "resources" }).click();
    await window.locator(".tree-row", { hasText: "database.yaml" }).click();
    await expect(window.locator(".editor textarea")).toHaveValue(/greetings/);

    const colours = window.locator(".editor-colours");
    await expect(colours.locator(".plain-comment", { hasText: "# where the greetings are kept" })).toBeVisible();
    await expect(colours.locator(".plain-keyword", { hasText: "tables" })).toBeVisible();
    await expect(colours.locator(".plain-literal", { hasText: '"greeting"' })).toBeVisible();
    await expect(colours.locator(".plain-concept", { hasText: "3" })).toBeVisible();

    // Monospaced in both layers, and coloured only: no span of it bolder or slanted than the text under the caret.
    const layers = await window.evaluate(() => {
      const font = (element: Element) => {
        const style = getComputedStyle(element);
        return `${style.fontFamily} ${style.fontSize} ${style.fontWeight} ${style.fontStyle} ${style.lineHeight}`;
      };
      const pre = document.querySelector(".editor-colours")!;
      return { area: font(document.querySelector(".editor textarea")!), pre: font(pre), spans: [...new Set([...pre.querySelectorAll("span")].map(font))] };
    });
    expect(layers.area).toEqual(layers.pre);
    expect(layers.pre).toMatch(/Menlo|monospace/);
    expect(layers.spans).toEqual([layers.pre]);
  });

  test("colours a linked resource apart from the text, not underlined", async ({ launched: { window, spec } }) => {
    writeFileSync(spec, readFileSync(spec, "utf8").replace("greets the person running it.", "greets the person running it, as [resources/greeting.yaml](resources/greeting.yaml) says."));
    const link = window.locator(".editor-colours .plain-link", { hasText: "[resources/greeting.yaml](resources/greeting.yaml)" });
    await expect(link).toBeVisible();
    // Not underlined: it is a link only while ⌘ is held.
    const style = await link.evaluate((element) => ({ colour: getComputedStyle(element).color, line: getComputedStyle(element).textDecorationLine, text: getComputedStyle(element.parentElement!).color }));
    expect(style.line).toBe("none");
    expect(style.colour).not.toBe(style.text);
  });

  test("saves an edit to the file", async ({ launched: { window, spec } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    await expect(window.locator(".pane-header-right")).toContainText("saved");

    await atTheEnd(window);
    await window.keyboard.type("\n- :Greeter: says goodbye when interrupted.");
    await expect(window.getByRole("button", { name: /^save/ })).toBeVisible();
    await expect(mark(window, 2)).toBeVisible();

    await window.keyboard.press(`${keys.mod}+s`);
    await expect(window.locator(".pane-header-right")).toContainText("saved");
    expect(readFileSync(spec, "utf8")).toContain("- :Greeter: says goodbye when interrupted.");
  });

  test("shows a change made on disk", async ({ launched: { window, spec } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    writeFileSync(spec, readFileSync(spec, "utf8") + "\n- :Greeter: waves.\n");
    await expect(area).toHaveValue(/:Greeter: waves\./);
  });
});
