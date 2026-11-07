import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "./app.ts";

/** A menu item chosen: the window in front is sent its action, as the native menu sends it. */
async function choose(app: ElectronApplication, page: Page, action: string) {
  await expect(page.locator(".app").first()).toBeVisible();
  await app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", action), action);
}

test.describe("a chat whose harness-model is a Claude subscription's", () => {
  test.use({ models: { harness: "claude-code/claude-opus-5-5" } });

  test("sends nothing to a model - never another in its place - says why, and still runs a command", async ({ launched: { window } }) => {
    const card = window.locator(".out-of-reach-card");
    await expect(card).toContainText("claude-code/claude-opus-5-5");
    await expect(card).toContainText("Claude subscription");
    // Nothing to sign in to: another model is chosen instead.
    await expect(card.getByRole("button", { name: /^sign in/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "choose another model" })).toBeVisible();
    // The model it is to talk on, struck through - not the one pi would have taken in its place.
    await expect(window.locator(".chat-model.out-of-reach")).toHaveText("claude-opus-5-5");
    await expect(window.getByRole("button", { name: "what does this project do?" })).toBeDisabled();
    // What would reach a model stays in the box, unsent.
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("what does this project do?");
    await box.press("Enter");
    await expect(box).toHaveValue("what does this project do?");
    await expect(window.locator(".composer-actions .button.primary")).toBeDisabled();
    await expect(window.locator(".chat-body .msg.user")).toHaveCount(0);
    // A command goes: /turri-config puts it on a model it can reach, and it talks again.
    await box.fill("/turri-config harness-model anthropic/claude-sonnet-5-5");
    await box.press("Enter");
    await expect(card).toHaveCount(0);
    await expect(window.locator(".chat-model")).toHaveText("claude-sonnet-5-5");
    await expect(window.locator(".chat-model.out-of-reach")).toHaveCount(0);
  });
});

test.describe("a chat whose harness-model's provider is not signed in to", () => {
  test.use({ models: { harness: "openai/gpt-6-astra" }, env: { OPENAI_API_KEY: "" } });

  test("says so, and offers to sign in to it in the sheet", async ({ launched: { window } }) => {
    const card = window.locator(".out-of-reach-card");
    await expect(card).toContainText("you are not signed in to");
    await card.getByRole("button", { name: /^sign in to/ }).click();
    await expect(window.locator(".sheet.auth h2")).toBeVisible();
  });
});

test.describe("a Claude subscription", () => {
  test("is not offered - not as a new project's models, nor a sign-in - and Anthropic's models take an API key", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const vendors = await page.evaluate(() => window.turri.vendors() as Promise<{ vendors: Array<{ id: string }> }>);
    expect(vendors.vendors.map((vendor) => vendor.id)).toContain("anthropic");
    expect(vendors.vendors.map((vendor) => vendor.id)).not.toContain("claude-code");
    const { providers } = await page.evaluate(() => window.turri.auth.providers());
    expect(providers.map((provider) => provider.id)).not.toContain("claude-code");
    const anthropic = providers.find((provider) => provider.id === "anthropic")!;
    expect(anthropic.oauth).toBeNull();
    expect(anthropic.apiKey).not.toBeNull();
    // The other subscriptions stay.
    expect(providers.some((provider) => provider.oauth !== null)).toBe(true);
    await expect(page.evaluate(() => window.turri.auth.login("anthropic", "oauth"))).rejects.toThrow(/Claude subscription/);
  });
});

test.describe("a Bedrock model setting", () => {
  // Bedrock's ids end in their version - `:0` - which is no thinking level. Dummy AWS credentials: nothing is called.
  test.use({ models: { coding: "amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0" }, env: { AWS_ACCESS_KEY_ID: "AKIATEST", AWS_SECRET_ACCESS_KEY: "test" } });

  test("is the whole model id, its version kept, with no thinking level of its own", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await choose(app, window, "project-settings");
    const sheet = window.getByRole("dialog", { name: "project settings" });
    await expect(sheet.getByRole("combobox", { name: "coding-model", exact: true })).toHaveValue("amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0");
    await expect(sheet.getByRole("combobox", { name: "how hard coding-model thinks" })).toHaveValue("");
  });
});
