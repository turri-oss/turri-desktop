import { APP_COMMAND, entryItem, withoutEchoes } from "../engine/entries.mjs";
import { expect, tellChat, test } from "./app.ts";

// The fixture is not built yet - so changed, all of it to build. Built from its ***plain as it is now, as the engine
// would say it after a regeneration, is sent here: no test regenerates.
test.describe("regenerating what changed", () => {
  test("is offered only when the ***plain has changed since it was built", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await expect(page.locator(".hint", { hasText: "regenerate what changed" })).toBeVisible();
    // How the module stands read, after the project opens: what the engine would say after a regeneration is sent over it.
    await expect(page.locator(".editor-pane .pane-header")).toContainText("0 of 1 regenerated");

    type Summary = { specs: Array<{ functionalSpecs: object[] }> };
    const summary = (await page.evaluate(() => window.turri.call("summary"))) as Summary;
    const built = {
      ...summary,
      specs: summary.specs.map((spec) => ({ ...spec, built: true, drifted: false, functionalSpecs: spec.functionalSpecs.map((entry) => ({ ...entry, built: true })) })),
    };
    await app.evaluate(({ BrowserWindow }, built) => BrowserWindow.getAllWindows()[0]!.webContents.send("project:opened", built), built);
    await expect(page.locator(".editor-pane .pane-header")).toContainText("1 of 1 regenerated");
    await expect(page.locator(".hint", { hasText: "regenerate what changed" })).toHaveCount(0);

  });
});

test.describe("regenerating from scratch", () => {
  test("asks this module or its whole chain, and runs turri's /regenerate under its box in the chat", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    // The regenerate sheet's choice, taken where the main process hears it: no model is called.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
      const real = handlers.get("engine:call")!;
      const taken: unknown[] = [];
      (globalThis as unknown as { taken: unknown[] }).taken = taken;
      handlers.set("engine:call", (event, method, params) => (method === "regenerate" ? (taken.push(params), true) : real(event, method, params)));
    });

    // The toolbar's button, and ***plain > Regenerate…, open it: hello requires no other module, so it has no chain.
    await page.locator(".toolbar .regenerate-open").click();
    const sheet = page.locator(".sheet.regenerate");
    await expect(sheet.locator("h2")).toHaveText("regenerate hello from scratch");
    await expect(sheet.getByRole("button", { name: "whole chain" })).toBeDisabled();
    await sheet.getByRole("button", { name: "cancel" }).click();
    await expect(sheet).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "regenerate-how"));
    await sheet.getByRole("button", { name: "this module" }).click();
    await expect(sheet).toHaveCount(0);
    const taken = await app.evaluate(() => (globalThis as unknown as { taken: unknown[] }).taken);
    expect(taken).toEqual([expect.objectContaining({ scratch: true, chain: false })]);

    // The box the engine puts in the chat, then turri's echo of the command - left out, as the box says it.
    const command = "/regenerate hello.plain from scratch";
    const box = entryItem({ type: "custom", customType: APP_COMMAND, data: { kind: "regenerate", title: "hello, from scratch", command } });
    const echo = entryItem({ type: "custom", customType: "turri_command_outcome", data: { command } });
    expect(withoutEchoes([box, echo])).toEqual([box]);
    expect(withoutEchoes([echo])).toEqual([echo]);
    await tellChat(app, page, "chat:message", box);
    const drawn = page.locator(".msg.action[data-kind=regenerate]");
    await expect(drawn.locator(".action-name")).toHaveText("regenerate");
    await expect(drawn.locator(".action-title")).toHaveText("hello, from scratch");

    // While it deletes and plans, outside any turn: turri at work, said as a turn is - with no stop, as the planner is turri's.
    await tellChat(app, page, "chat:preparing", { text: "deleting the code, then planning its regeneration" });
    await expect(page.locator(".chat-working")).toContainText("deleting the code, then planning its regeneration");
    await expect(page.getByRole("button", { name: "stop" })).toHaveCount(0);
    await tellChat(app, page, "chat:preparing", { text: null });
    await expect(page.locator(".chat-working")).toHaveCount(0);
  });
});
