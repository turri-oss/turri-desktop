import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { conformFromScratch } from "../engine/commands.mjs";
import { expect, test } from "./app.ts";

// What the window does with turri 0.2.4's work loop - its look ahead, conformance tests written again, the config keys
// it does not read - with the engine's calls that would reach a model answered by the test.

/**
 * The engine's calls of these methods answered by the test - `answers`, by method: a function of the params, or the
 * value - with what the window asked kept, to read back. The rest go to the real engine.
 */
async function answering(app: ElectronApplication, answers: Record<string, unknown>): Promise<() => Promise<Array<{ method: string; params: unknown }>>> {
  await app.evaluate(({ ipcMain }, answers) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
    const real = handlers.get("engine:call")!;
    const taken: Array<{ method: string; params: unknown }> = [];
    (globalThis as unknown as { taken: unknown[] }).taken = taken;
    handlers.set("engine:call", (event, method, params) => {
      if (!(method as string in answers)) return real(event, method, params);
      taken.push({ method: method as string, params });
      return answers[method as string];
    });
  }, answers);
  return () => app.evaluate(() => (globalThis as unknown as { taken: Array<{ method: string; params: unknown }> }).taken);
}

const send = (app: ElectronApplication, channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);

/** Whether a menu item is there and enabled, by its label. */
const menuItem = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const inside = item.submenu ? find(item.submenu.items) : undefined;
        if (inside) return inside;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()!.items);
    return item === undefined ? null : { enabled: item.enabled };
  }, label);

const CASES = { fresh: true, add: [{ module: "hello", funcId: "print-hello" }], patch: [], again: [], delete: [], mechanical: false };
const LOOKED_AHEAD = "looked ahead - planned, and nothing starts until regenerate, conform or /regenerate asks for it";

test.describe("preview the plan", () => {
  test("is turri's look ahead - offered once its session is up - the pulses, and the first one's prompt", async ({ launched: { app, window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    // The real engine says its session can look ahead; asking it would call the planner, a model, so the test answers.
    expect(await page.evaluate(() => window.turri.call<{ offers: { lookAhead?: boolean } }>("summary").then((summary) => summary.offers.lookAhead))).toBe(true);
    await expect.poll(() => menuItem(app, "Preview the Plan")).toEqual({ enabled: true });
    const status = { module: "hello", plainFile: spec, planned: [{ title: "print-hello", cases: CASES, track: "code" }, { title: "conformance tests", cases: CASES, track: "conformance", afterCode: true }], why: LOOKED_AHEAD };
    const taken = await answering(app, {
      lookAhead: { statuses: [status], firsts: [{ module: "hello", title: "print-hello", track: "code", cases: CASES, prompt: "You are the coding agent. Build print-hello.", why: null }] },
    });
    await send(app, "menu", "look-ahead");
    const sheet = page.locator(".sheet", { has: page.locator("h2", { hasText: "the plan for hello" }) });
    await expect(sheet.locator(".planned li")).toHaveText(["1print-hello", "2conformance testsconformance"]);
    await expect(sheet).toContainText("nothing started: the work waits for regenerate");
    await expect(sheet.locator(".first p").first()).toHaveText("first: print-hello - new hello:print-hello");
    await sheet.getByRole("button", { name: "show what the coding agent will be told" }).click();
    await expect(sheet.locator(".prompt-preview")).toHaveText("You are the coding agent. Build print-hello.");
    expect(await taken()).toEqual([{ method: "lookAhead", params: { file: spec } }]);
  });

  test("says why a first pulse has no prompt to show, in turri's words", async ({ launched: { app, window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const why = "The ***plain or the steering changed since it was planned: regenerate would plan it again. Look ahead again to see the new plan.";
    await answering(app, { lookAhead: { statuses: [{ module: "hello", plainFile: spec, planned: [{ title: "print-hello", cases: CASES, track: "code" }] }], firsts: [{ module: "hello", title: "print-hello", track: "code", cases: CASES, prompt: null, why }] } });
    await send(app, "menu", "look-ahead");
    const first = page.locator(".sheet .first");
    await expect(first).toContainText("regenerate would plan it again");
    await expect(first.getByRole("button", { name: "show what the coding agent will be told" })).toHaveCount(0);
  });

  test("leaves the module waiting for regenerate in regen - not stuck - with regenerate beside it", async ({ launched: { app, window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const taken = await answering(app, { regenerate: true });
    const held = { module: "hello", plainFile: spec, planned: [{ title: "print-hello", cases: CASES, track: "code" }], why: LOOKED_AHEAD, lookedAhead: true };
    await send(app, "engine:status", { modules: [held], jobs: [], planned: [] });
    await send(app, "menu", "dive");
    const head = page.locator(".dive .module-plan-head", { hasText: "hello" });
    await expect(head.locator(".tag.looked-ahead")).toHaveText("waiting for regenerate");
    await expect(head).toContainText("nothing starts until regenerate");
    await head.getByRole("button", { name: "regenerate" }).click();
    expect(await taken()).toEqual([{ method: "regenerate", params: { file: spec } }]);
  });
});

/**
 * hello's print-hello told the window as built - and, given a scenario, conformance tested - no pulse runs. Its mark's
 * menu then says `conform again`, or, with no scenarios, `conform` with them written first.
 */
async function built(app: ElectronApplication, page: Page, project: string, { scenarios }: { scenarios: boolean }) {
  type Summary = { specs: Array<{ functionalSpecs: Array<{ testPlainFile: string | null } & Record<string, unknown>> }> };
  const summary = () => page.evaluate(() => window.turri.call<Summary>("summary"));
  if (scenarios) {
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), "---\nmodule: hello\nfunc_id: print-hello\n---\n\n***conformance tests***\n\n# prints-hello\nRunning :Greeter: prints \"hello, world\".\n");
    await expect.poll(async () => (await summary()).specs[0]!.functionalSpecs[0]?.testPlainFile ?? null, { timeout: 15_000 }).not.toBeNull();
  } else await expect.poll(async () => (await summary()).specs[0]!.functionalSpecs.length, { timeout: 15_000 }).toBe(1);
  const now = await summary();
  const told = { ...now, specs: now.specs.map((each) => ({ ...each, built: true, drifted: false, functionalSpecs: each.functionalSpecs.map((entry) => ({ ...entry, built: true, conformed: scenarios })) })) };
  const item = scenarios ? "conform again" : "conform - its scenarios written first";
  // Sent until it holds: the engine's own read of how the module stands may still come after it, saying it is not built.
  await expect(async () => {
    await send(app, "project:opened", told);
    for (let i = 0; i < 2; i++) {
      await page.locator('.editor-colours .mark[aria-label^="functional spec print-hello,"]').click();
      await expect(page.getByRole("menu").getByRole("menuitem", { name: item })).toBeVisible({ timeout: 1_000 });
      await page.keyboard.press("Escape");
      if (i === 0) await page.waitForTimeout(1_000);
    }
  }).toPass({ timeout: 20_000 });
}

test.describe("conformance tests written again", () => {
  test("a conformance-tested functional spec's mark says conform again - and asks for its tests by name", async ({ launched: { app, window: page, project, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await built(app, page, project, { scenarios: true });
    const taken = await answering(app, { conform: true });
    await page.locator('.editor-colours .mark[aria-label^="functional spec print-hello,"]').click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["regenerate", "conform again", "open its scenarios"]);
    await menu.getByRole("menuitem", { name: "conform again" }).click();
    expect(await taken()).toEqual([{ method: "conform", params: { file: spec, funcIds: ["print-hello"] } }]);
  });

  test("a built functional spec with no scenarios: its mark's conform has the chat write them first, then conform it", async ({ launched: { app, window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await built(app, page, project, { scenarios: false });
    const taken = await answering(app, { sendAction: true, conform: true });
    await page.locator('.editor-colours .mark[aria-label^="functional spec print-hello,"]').click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["regenerate", "conform - its scenarios written first", "write testing scenarios"]);
    await menu.getByRole("menuitem", { name: "conform - its scenarios written first" }).click();
    expect(await taken()).toEqual([
      { method: "sendAction", params: { action: { kind: "conform", title: "hello:print-hello", detail: "its testing scenarios written first", prompt: "Write testing scenarios for hello:print-hello, then write and run its conformance tests." } } },
    ]);
  });

  test("conform…: this module or its whole chain from scratch, as regenerate… - from the toolbar or the ***plain menu, never with functional specs named", async ({ launched: { app, window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    expect(await menuItem(app, "Conform…")).toEqual({ enabled: true });
    const taken = await answering(app, { conform: true });
    // Beside regenerate… in the toolbar, and ***plain > Conform…: the one sheet, with regenerate's choices and no more.
    await page.locator(".toolbar .conform-open").click();
    const sheet = page.getByRole("dialog", { name: "conform hello" });
    await expect(sheet.locator("h2")).toHaveText("conform hello from scratch");
    await expect(sheet.getByRole("button")).toHaveText(["cancel", "whole chain", "this module"]);
    await sheet.getByRole("button", { name: "cancel" }).click();
    await expect(sheet).toHaveCount(0);
    await send(app, "menu", "conform-how");
    await expect(sheet).toContainText("its code is untouched");
    // hello requires no other module: no chain.
    await expect(sheet.getByRole("button", { name: "whole chain" })).toBeDisabled();
    await sheet.getByRole("button", { name: "this module" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await taken()).toEqual([{ method: "conform", params: { file: spec, scratch: true, chain: false } }]);
    // The words the engine has the chat run, as the person would type them.
    expect(conformFromScratch("hello.plain", false)).toBe("/conform hello.plain from scratch");
    expect(conformFromScratch("app/todo.plain", true)).toBe("/conform app/todo.plain from scratch, whole chain");
  });

  test("the engine refuses functional specs named with from scratch, before anything runs", async ({ launched: { window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const refused = await page.evaluate((file) => window.turri.call("conform", { file, funcIds: ["print-hello"], scratch: true }).then(() => "", (error: Error) => error.message), spec);
    expect(refused).toContain("not both");
  });
});

test.describe("config keys turri does not read", () => {
  test("are said as the project opens, in turri's words, with the way to have the chat take them out", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const line = "config.turri.yaml has a key turri does not read - test-advisor: no setting turri has, so it does nothing. Take it out, or see docs/config.md for the spelling.";
    const summary = await page.evaluate(() => window.turri.call<Record<string, unknown>>("summary"));
    const taken = await answering(app, { sendAction: true });
    await send(app, "project:opened", { ...summary, configWarnings: [line] });
    await page.getByRole("button", { name: /^notifications:/ }).click();
    const note = page.locator(".notification.warning", { hasText: "test-advisor" });
    await expect(note).toContainText(`turri warns · ${line}`);
    await note.getByRole("button", { name: "take it out" }).click();
    expect(await taken()).toEqual([{ method: "sendAction", params: { action: expect.objectContaining({ kind: "config", detail: line }) } }]);
  });

  test("are read from turri's banner - none in a project whose config turri reads whole", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    expect(await page.evaluate(() => window.turri.call<{ configWarnings: string[] }>("summary").then((summary) => summary.configWarnings))).toEqual([]);
  });
});

test.describe("config keys turri does not read, in a project that still has test-advisor", () => {
  test.use({ configLines: ["test-advisor: true"] });

  test("are said from the banner of the chat turri started, in its words", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const warnings = await page.evaluate(() => window.turri.call<{ configWarnings: string[] }>("summary").then((summary) => summary.configWarnings));
    expect(warnings).toEqual([expect.stringMatching(/^config\.turri\.yaml has a key turri does not read - test-advisor/)]);
    await page.getByRole("button", { name: /^notifications:/ }).click();
    await expect(page.locator(".notification.warning", { hasText: "test-advisor" }).getByRole("button", { name: "take it out" })).toBeVisible();
  });
});

test.describe("conform…, with conformance tests off", () => {
  test.use({ conformance: false });

  test("says they are off, with the way to turn them on - no sheet", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    // Once the module is read: until then, whether they are on is not known.
    await expect(page.locator(".editor-pane .conformed-count.off")).toContainText("conformance tests off");
    await page.locator(".toolbar .conform-open").click();
    await expect(page.locator(".status-said")).toHaveText("conformance tests are off for hello.plain.");
    await expect(page.getByRole("dialog", { name: "conform hello" })).toHaveCount(0);
  });
});
