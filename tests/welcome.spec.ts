import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./app.ts";

test.describe("the welcome screen", () => {
  test.use({ open: false, recent: true });

  test("keeps its jellyfish still - only the chat's move - and the empty chat's grows from the polyp", async ({ launched: { window } }) => {
    const card = window.locator(".welcome-card");
    await expect(card.locator(".jellyfish.pixels.still")).toBeVisible();
    // Still: the kit's hero with none of its sway or bob.
    await expect(card.locator(".tp-bob, .tp-fa, .tp-fb")).toHaveCount(0);
    await window.locator(".recents button", { hasText: "hello" }).click();
    await expect(window.locator(".chat-empty .jellyfish.pixels")).toBeVisible();
    // The chat's header has no jellyfish, nor turri's name: its tabs alone.
    await expect(window.locator(".chat-top .jellyfish")).toHaveCount(0);
    await expect(window.locator(".project-name .jellyfish")).toHaveCount(0);
  });

  test("lists a recent project and opens it", async ({ launched: { window, project } }) => {
    await expect(window.getByRole("button", { name: "start a new project…" })).toBeVisible();
    await expect(window.getByRole("button", { name: "open a project…" })).toBeVisible();
    const recent = window.locator(".recents button", { hasText: "hello" });
    await expect(recent.locator(".recent-name")).toHaveText("hello");

    await recent.click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(window.locator(".editor textarea")).toHaveValue(/:Greeter: prints "hello, world"/);
    // What the project opened is listed as the most recent.
    await expect(window.locator(".welcome")).toHaveCount(0);
    expect(project).toMatch(/hello$/);
  });

  test("says why a project cannot be opened, in words - gone, or not readable", async ({ launched: { window: page }, scratch }) => {
    const welcome = page.locator(".welcome");
    await expect(welcome).toBeVisible();
    // A folder that is not there any more.
    const gone = join(scratch, "gone");
    await expect.poll(() => page.evaluate((dir) => window.turri.openProject(dir).then(() => "", (error: Error) => error.message), gone)).toContain("is not there any more: it was moved, renamed or deleted.");
    // One whose permissions keep its owner out - as macOS's privacy protection does, said its own way there.
    const shut = join(scratch, "shut");
    mkdirSync(shut);
    chmodSync(shut, 0o000);
    try {
      const said = await page.evaluate((dir) => window.turri.openProject(dir).then(() => "", (error: Error) => error.message), shut);
      expect(said).toContain("cannot be read: its permissions do not let you.");
      expect(said).not.toContain("uv_cwd");
    } finally {
      chmodSync(shut, 0o755);
    }
  });

  test("has its logo below the traffic lights - and at the top full screen, where there are none", async ({ launched: { app, window: page } }) => {
    const bar = page.locator(".welcome-bar");
    await expect(bar).toBeVisible();
    const height = () => bar.evaluate((element) => Math.round(element.getBoundingClientRect().height));
    await expect.poll(height).toBe(process.platform === "darwin" ? 92 : 64);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("fullscreen", true));
    await expect.poll(height).toBe(64);
  });

  test("says which turri it runs", async ({ launched: { window } }) => {
    await expect(window.locator(".welcome-card")).toContainText(/turri \d+\.\d+\.\d+|turri local/);
  });

  test("has the Window menu at the right, before Help, as every Mac app does", async ({ launched: { app } }) => {
    const menus = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label));
    expect(menus.slice(-3)).toEqual(["***plain", "Window", "Help"]);
  });

  test("reloads on ⌘R, as a browser does - never regenerates", async ({ launched: { app } }) => {
    const bound = await app.evaluate(({ Menu }) => {
      const all = (items: Electron.MenuItem[]): Electron.MenuItem[] => items.flatMap((item) => [item, ...(item.submenu ? all(item.submenu.items) : [])]);
      const items = all(Menu.getApplicationMenu()!.items);
      return {
        onR: items.filter((item) => item.accelerator === "CmdOrCtrl+R").map((item) => item.label),
        regenerate: items.find((item) => item.label === "Regenerate…")?.accelerator ?? null,
      };
    });
    expect(bound).toEqual({ onR: ["Reload"], regenerate: null });
  });
});
