import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "./app.ts";

/** An event the engine sends the window - an incident, say - as the main process passes it on. */
async function tellWindow(app: ElectronApplication, channel: string, data: unknown) {
  await app.evaluate(({ BrowserWindow }, { channel, data }) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel, data), { channel, data });
}

test.describe("the status panel", () => {
  test("keeps what the window is told along the bottom - said a moment in the strip, an error opening the panel - until dismissed", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const bell = window.getByRole("button", { name: /^notifications:/ });
    await expect(bell).toHaveAccessibleName("notifications: 0 unread");

    // An incident: an error - said in the strip, and the panel opens on it. Nothing floats over the window.
    await tellWindow(app, "engine:incident", { text: "the coding agent could not reach the model." });
    await expect(window.locator(".status-said")).toHaveText("the coding agent could not reach the model.");
    const list = window.getByRole("tabpanel", { name: "notifications" });
    await expect(list.locator(".notification.error")).toContainText("the coding agent could not reach the model.");
    await expect(window.locator(".toast")).toHaveCount(0);
    // Shown, it is read.
    await expect(bell).toHaveAccessibleName("notifications: 0 unread");

    // Hidden, another error opens it again.
    await window.getByRole("button", { name: "hide the panel" }).click();
    await expect(window.locator(".status-body")).toHaveCount(0);
    await tellWindow(app, "engine:incident", { text: "the second." });
    await expect(window.locator(".status-body")).toBeVisible();
    await window.getByRole("button", { name: "hide the panel" }).click();

    // Dismissed one at a time, the newest first - and all at once.
    await bell.click();
    await expect(list.locator(".notification")).toHaveCount(2);
    await expect(list.locator(".notification").first()).toContainText("the second.");
    await list.locator(".notification").first().getByRole("button", { name: "dismiss" }).click();
    await expect(list.locator(".notification")).toHaveCount(1);
    await window.getByRole("button", { name: "clear all" }).click();
    await expect(list).toContainText("no notifications");
    // The bell shuts it again.
    await bell.click();
    await expect(window.locator(".status-body")).toHaveCount(0);
  });

  test("takes turri's warnings and errors out of the chat - what a command prints stays there", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const chats = await page.evaluate(() => window.turri.call<Array<{ id: string; shown: boolean }>>("chats"));
    const chat = (chats.find((each) => each.shown) ?? chats[0])!.id;
    await tellWindow(app, "engine:chat:notify", { chat, data: { level: "warning", text: "The sentinel could not be opened: no model." } });
    await expect(page.locator(".status-said")).toHaveText("The sentinel could not be opened: no model.");
    await tellWindow(app, "engine:chat:notify", { chat, data: { level: "info", text: "printed by a command" } });
    await expect(page.locator(".chat-body .msg.note")).toHaveText("printed by a command");
    await page.getByRole("button", { name: /^notifications:/ }).click();
    await expect(page.getByRole("tabpanel", { name: "notifications" }).locator(".notification.warning")).toHaveText(/The sentinel could not be opened: no model\./);
    await expect(page.locator(".chat-body")).not.toContainText("The sentinel could not be opened");
  });

  test("is as high as its top edge is dragged - kept for next time, and its height again on a double-click", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await page.getByRole("button", { name: /^problems:/ }).click();
    const body = page.locator(".status-body");
    const height = async () => Math.round((await body.boundingBox())!.height);
    expect(await height()).toBe(240);
    const edge = (await page.getByRole("separator", { name: "resize the panel" }).boundingBox())!;
    await page.mouse.move(edge.x + 200, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + 200, edge.y + edge.height / 2 - 150, { steps: 5 });
    await page.mouse.up();
    expect(await height()).toBe(390);
    // Kept: the window drawn again, it opens as high as it was left.
    await page.reload();
    await expect(page.locator(".chat-model")).toBeVisible();
    await page.getByRole("button", { name: /^problems:/ }).click();
    expect(await height()).toBe(390);
    // Never so high the view above has no room.
    const top = (await page.getByRole("separator", { name: "resize the panel" }).boundingBox())!;
    await page.mouse.move(top.x + 200, top.y + top.height / 2);
    await page.mouse.down();
    await page.mouse.move(top.x + 200, 0, { steps: 5 });
    await page.mouse.up();
    expect(await height()).toBe((await page.evaluate(() => window.innerHeight)) - 200);
    await page.getByRole("separator", { name: "resize the panel" }).dblclick();
    expect(await height()).toBe(240);
  });
});
