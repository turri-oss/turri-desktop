import { expect, test } from "./app.ts";

// The fixture is not built yet - so changed, all of it to build. Built from its ***plain as it is now, as the engine
// would say it after a regeneration, is sent here: no test regenerates.
test.describe("regenerating what changed", () => {
  test("is offered only when the ***plain has changed since it was built", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await expect(page.locator(".hint", { hasText: "regenerate what changed" })).toBeVisible();

    type Summary = { specs: Array<{ functionalSpecs: object[] }> };
    const summary = (await page.evaluate(() => window.turri.call("summary"))) as Summary;
    const built = {
      ...summary,
      specs: summary.specs.map((spec) => ({ ...spec, built: true, drifted: false, functionalSpecs: spec.functionalSpecs.map((entry) => ({ ...entry, built: true })) })),
    };
    await app.evaluate(({ BrowserWindow }, built) => BrowserWindow.getAllWindows()[0]!.webContents.send("project:opened", built), built);
    await expect(page.locator(".editor-pane .pane-header")).toContainText("1 of 1 regenerated");
    await expect(page.locator(".hint", { hasText: "regenerate what changed" })).toHaveCount(0);

    // The ***plain menu's Regenerate…: the toolbar has no button for it.
    await expect(page.getByRole("button", { name: "regenerate…" })).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "regenerate-how"));
    const sheet = page.locator(".sheet.regenerate");
    await expect(sheet.locator(".option").first()).toContainText("chosen functional specs again");
    await expect(sheet.locator(".option", { hasText: "what changed" })).toHaveCount(0);
  });
});
