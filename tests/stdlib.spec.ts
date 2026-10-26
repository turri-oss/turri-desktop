import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, offers, test } from "./app.ts";

/**
 * ⌘-click - Ctrl on Linux - on a piece of the coloured ***plain, through the textarea over it: in the middle of one of
 * its line boxes, the first or the last, as a piece that wraps - a long link - has its box over two lines and more, and
 * the middle of that box may be on other words.
 */
async function modClick(window: Page, piece: Locator, part: "first" | "last" = "first") {
  const rects = await piece.evaluate((element) => [...element.getClientRects()].map(({ x, y, width, height }) => ({ x, y, width, height })));
  const at = part === "first" ? rects[0]! : rects.at(-1)!;
  const area = window.locator(".editor textarea");
  const box = (await area.boundingBox())!;
  await area.click({ position: { x: at.x - box.x + at.width / 2, y: at.y - box.y + at.height / 2 }, modifiers: ["ControlOrMeta"] });
}

/**
 * ***plain > Standard Library, as the person chooses it from the menu bar: the item is there, and what it sends the
 * window in front - the windows of a test are never in front, so it is sent to the window here.
 */
async function openStdlib(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()!.items.find((menu) => menu.label === "***plain")!.submenu!.items.find((each) => each.label === "Standard Library");
    if (item === undefined) throw new Error("no ***plain > Standard Library");
    BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "view:stdlib");
  });
}

test.describe("the stdlib view", () => {
  test("opens from the ***plain menu on ⌘4, not from a tab among the views", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await expect(window.locator(".toolbar").getByRole("tab")).toHaveCount(2);
    await expect(window.locator(".toolbar").getByRole("tab", { name: "stdlib" })).toHaveCount(0);
    const item = await app.evaluate(({ Menu }) => {
      const menus = Menu.getApplicationMenu()!.items;
      const found = menus.find((menu) => menu.label === "***plain")!.submenu!.items.find((each) => each.label === "Standard Library");
      return { accelerator: found?.accelerator, inView: menus.find((menu) => menu.label === "View")!.submenu!.items.some((each) => /stdlib|standard library/i.test(each.label)) };
    });
    expect(item).toEqual({ accelerator: "CmdOrCtrl+4", inView: false });
    test.skip(!(await offers(window)).stdlib, "the turri running gives the window no standard library");
    await openStdlib(app);
    await expect(window.getByRole("navigation", { name: "the standard library" })).toBeVisible();
    // No tab is the view's: none of the others is shown as chosen.
    await expect(window.locator(".toolbar").getByRole("tab", { selected: true })).toHaveCount(0);
  });


  // The standard library and the graph, as turri gives them: on a turri whose host entry does.
  test.beforeEach(async ({ launched: { window } }) => {
    const offered = await offers(window);
    test.skip(!offered.stdlib || !offered.links, "the turri running gives the window no standard library or graph");
  });

  test("lists the standard library, and follows a template's imports and its conformance tests", async ({ launched: { app, window, project } }) => {
    // A module of the project's on Spring Boot: the view says the project builds on it, and on what it imports.
    writeFileSync(join(project, "backend.plain"), "---\nimport:\n  - stdlib/backend/java-springboot\ndescription: A backend.\n---\n\n***functional specs***\n\n- It answers.\n");
    await openStdlib(app);

    const list = window.getByRole("navigation", { name: "the standard library" });
    await expect(list).toContainText("backends");
    await expect(list).toContainText("languages");
    // Opened on the stack the project imports.
    const header = window.locator(".stdlib-module .pane-header");
    await expect(header).toContainText("stdlib/backend/java-springboot");
    await expect(window.locator(".stdlib-row.active")).toContainText("in use");
    await expect(window.locator(".stdlib-facts")).toContainText("backend.plain");
    await expect(window.locator(".stdlib-lines")).toContainText("Spring Boot 3");

    // Its import, followed from the ***plain itself - and back.
    await window.locator(".stdlib-import", { hasText: "stdlib/lang/java" }).click();
    await expect(header).toContainText("stdlib/lang/java");
    // Imported by what the project imports: in use too.
    await expect(window.locator(".stdlib-row.active")).toContainText("in use");
    await window.getByRole("button", { name: "back", exact: true }).click();
    await expect(header).toContainText("stdlib/backend/java-springboot");

    // Its conformance tests, a tab away.
    await window.getByRole("tab", { name: "conformance tests" }).click();
    await expect(header).toContainText("stdlib/backend/conformance/java-springboot");
    await expect(window.locator(".stdlib-lines")).toContainText("JUnit 5");
    // Its name, the tabs and copy import on one line, however narrow the view.
    await window.setViewportSize({ width: 1100, height: 800 });
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(37);

    // Found by what it is, and the project's .plain that imports it opened in intent.
    await window.getByRole("searchbox", { name: "find a template" }).fill("fastapi");
    await expect(list.locator(".stdlib-row")).toHaveCount(1);
    await list.locator(".stdlib-row").click();
    await expect(header).toContainText("stdlib/backend/python-fastapi");
    await window.locator(".stdlib-import", { hasText: "stdlib/backend/common" }).click();
    await window.locator(".stdlib-facts").getByRole("button", { name: "stdlib/backend/java-springboot" }).click();
    await window.locator(".stdlib-facts").getByRole("button", { name: /backend\.plain/ }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("backend.plain");
  });

  test("opens a module the ***plain imports, from intent", async ({ launched: { window, project } }) => {
    writeFileSync(join(project, "backend.plain"), "---\nimport:\n  - stdlib/backend/java-springboot\ndescription: A backend.\n---\n\n***functional specs***\n\n- It answers.\n");
    await window.locator(".tree-row", { hasText: "backend.plain" }).click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("backend.plain");

    // From what it builds on, under the header.
    await window.locator(".plain-links").getByRole("button", { name: "stdlib/backend/java-springboot" }).click();
    await expect(window.getByRole("navigation", { name: "the standard library" })).toBeVisible();
    await expect(window.locator(".stdlib-module .pane-header")).toContainText("stdlib/backend/java-springboot");

    // And ⌘-clicked where the ***plain imports it.
    await window.locator(".toolbar").getByRole("tab", { name: "***plain" }).click();
    const area = window.locator(".editor textarea");
    // Coloured by turri's grammar first: the module it names is what a ⌘-click opens.
    await expect(window.locator(".editor-colours [data-line='2'] .plain-module")).toBeVisible();
    const line = (await window.locator(".editor-colours [data-line='2']").boundingBox())!;
    await area.click({ position: { x: 60, y: line.y - (await area.boundingBox())!.y + line.height / 2 }, modifiers: ["ControlOrMeta"] });
    await expect(window.getByRole("navigation", { name: "the standard library" })).toBeVisible();
    await expect(window.locator(".stdlib-module .pane-header")).toContainText("stdlib/backend/java-springboot");
  });

  test("goes up and down the requires chain, and into a template the ***plain imports", async ({ launched: { window, project } }) => {
    mkdirSync(join(project, "template"));
    writeFileSync(join(project, "template", "base.plain"), "---\ndescription: What every module shares.\n---\n\n***implementation reqs***\n\n- :Implementation: is tidy.\n");
    writeFileSync(join(project, "backend.plain"), "---\nimport:\n  - template/base\ndescription: A backend.\n---\n\n***functional specs***\n\n- It answers.\n");
    writeFileSync(join(project, "frontend.plain"), "---\nrequires:\n  - backend\ndescription: A frontend.\n---\n\n***functional specs***\n\n- It shows.\n");
    const links = window.locator(".plain-links");
    const header = window.locator(".editor-pane .pane-header");

    // Up: the backend is required by the frontend.
    await window.locator(".tree-row", { hasText: "backend.plain" }).click();
    await links.getByRole("button", { name: "frontend.plain" }).click();
    await expect(header).toContainText("frontend.plain");
    // Down again: the frontend requires the backend.
    await links.getByRole("button", { name: "backend" }).click();
    await expect(header).toContainText("backend.plain");

    // Into the template it imports, which says who imports it.
    await links.getByRole("button", { name: "template/base" }).click();
    await expect(window.locator(".editor textarea")).toHaveValue(/What every module shares/);
    await expect(links).toContainText("imported by");
    await links.getByRole("button", { name: "backend.plain" }).click();
    await expect(header).toContainText("backend.plain");

    // ⌘-click on the frontend's requires line.
    await window.locator(".tree-row", { hasText: "frontend.plain" }).click();
    await expect(header).toContainText("frontend.plain");
    await expect(links).toContainText("requires");
    const area = window.locator(".editor textarea");
    // Coloured by turri's grammar first: the module it names is what a ⌘-click opens.
    await expect(window.locator(".editor-colours [data-line='2'] .plain-module")).toBeVisible();
    const line = (await window.locator(".editor-colours [data-line='2']").boundingBox())!;
    await area.click({ position: { x: 60, y: line.y - (await area.boundingBox())!.y + line.height / 2 }, modifiers: ["ControlOrMeta"] });
    await expect(header).toContainText("backend.plain");
  });

  test("⌘-click on a concept opens where it is defined, as the module sees it", async ({ launched: { window, project } }) => {
    mkdirSync(join(project, "template"));
    writeFileSync(join(project, "template", "store.plain"), "---\ndescription: Where things are kept.\n---\n\n***definitions***\n\n- :Store: is where the greetings are kept.\n");
    writeFileSync(
      join(project, "backend.plain"),
      "---\nimport:\n  - template/store\ndescription: A backend.\n---\n\n***definitions***\n\n- :Greeting: is what :Store: keeps.\n\n***functional specs***\n\n- It answers with a :Greeting:.\n",
    );
    await window.locator(".tree-row", { hasText: "backend.plain" }).click();
    const area = window.locator(".editor textarea");
    const click = async (concept: string, nth: number) => {
      await modClick(window, window.locator(".editor-colours .plain-concept", { hasText: concept }).nth(nth));
    };

    // Defined in the same ***plain: its definition lit, where it is.
    await expect(window.locator(".editor-colours .plain-concept", { hasText: ":Greeting:" })).toHaveCount(2);
    await click(":Greeting:", 1);
    await expect(window.locator(".editor-colours .rendering")).toContainText("is what :Store: keeps");

    // Defined in the template it imports: that opened, the definition lit.
    await click(":Store:", 0);
    await expect(area).toHaveValue(/Where things are kept/);
    await expect(window.locator(".editor-colours .rendering")).toContainText("is where the greetings are kept");

    // And back: where it is defined, where it is used - and there.
    await click(":Store:", 0);
    const uses = window.getByRole("dialog", { name: "where :Store: is used" });
    await expect(uses).toContainText("one place");
    await uses.getByRole("button", { name: /backend\.plain:9/ }).click();
    await expect(uses).toHaveCount(0);
    await expect(window.locator(".editor-pane .pane-header")).toContainText("backend.plain");
    await expect(window.locator(".editor-colours .rendering")).toContainText("is what :Store: keeps");

    // One defined in this ***plain, used further down it; escape puts the list away.
    await click(":Greeting:", 0);
    await expect(window.getByRole("dialog", { name: "where :Greeting: is used" })).toContainText("backend.plain:13");
    await window.keyboard.press("Escape");
    await expect(window.getByRole("dialog")).toHaveCount(0);
  });

  test("⌘-click on ***plain's own concept says so, in one run of words", async ({ launched: { window } }) => {
    await window.locator(".tree-row", { hasText: "hello.plain" }).click();
    const area = window.locator(".editor textarea");
    await modClick(window, window.locator(".editor-colours .plain-concept", { hasText: ":Implementation:" }));
    const toast = window.locator(".toast");
    await expect(toast).toContainText(":Implementation: is plain's own: no plain file defines it.");
    // Its words one element in the notice's row, ***plain's name and its "'s" with no gap between them.
    await expect(toast.locator("> *")).toHaveCount(1);
    const name = (await toast.locator(".plain-name").first().boundingBox())!;
    const line = (await toast.boundingBox())!;
    expect(name.height).toBeLessThan(line.height);
  });

  test("⌘-click on a linked resource opens its file", async ({ launched: { window, project } }) => {
    test.skip(!(await offers(window)).resources, "the turri running gives no linked resources in its graph");
    // Narrow enough that the second link on its line wraps, as it does on Linux's wider font at any width.
    await window.setViewportSize({ width: 1200, height: 800 });
    mkdirSync(join(project, "resources"));
    writeFileSync(join(project, "resources", "database.yaml"), "tables:\n  - greetings\n");
    writeFileSync(join(project, "resources", "schema.json"), '{ "greeting": "string" }\n');
    writeFileSync(
      join(project, "backend.plain"),
      "---\ndescription: A backend.\n---\n\n***functional specs***\n\n- It keeps [the database](resources/database.yaml) as [the schema](resources/schema.json) says.\n- It reads [the archive](resources/gone.md).\n",
    );
    const open = async (nth: number, part: "first" | "last" = "first") => {
      await window.locator(".tree-row", { hasText: "backend.plain" }).click();
      await expect(window.locator(".editor-colours .plain-link")).toHaveCount(3);
      await modClick(window, window.locator(".editor-colours .plain-link").nth(nth), part);
      return window.locator(".editor textarea");
    };

    // The first link on its line, and the second - which wraps at this width, on every system: followed from either of
    // its lines.
    await window.locator(".tree-row", { hasText: "backend.plain" }).click();
    await expect(window.locator(".editor-colours .plain-link")).toHaveCount(3);
    expect(await window.locator(".editor-colours .plain-link").nth(1).evaluate((element) => element.getClientRects().length)).toBeGreaterThan(1);
    await expect(await open(0)).toHaveValue(/greetings/);
    await expect(await open(1)).toHaveValue(/"greeting": "string"/);
    await expect(await open(1, "last")).toHaveValue(/"greeting": "string"/);
    // One to a file that is not there: said so, and the ***plain stays open.
    await open(2);
    await expect(window.locator(".toast")).toContainText("resources/gone.md is not in the project.");
    await expect(window.locator(".editor-pane .pane-header")).toContainText("backend.plain");
  });
});
