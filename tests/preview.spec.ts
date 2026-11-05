import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, showRegen, tellChat, test } from "./app.ts";

// turri's browser and terminal tools tell the window which they use ("preview:reveal", "terminal:reveal") - never bringing
// it there: sent here as they would be.
test.describe("the preview", () => {
  test("opens on its home: the built functional specs to choose, turri asked to try them, and the preview going with it", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await expect(window.getByRole("tab", { name: "home", selected: true })).toBeVisible();
    // The fixture is not built: nothing to choose.
    await expect(window.locator(".preview-home .empty h3")).toHaveText("nothing built yet");
    // How the module stands read, after the project opens: what the engine would say after a regeneration is sent over it.
    await expect(window.locator(".tree-row", { hasText: "hello.plain" }).locator(".spec-row-count")).toHaveText("0/1");

    // Built, as the engine would say it after a regeneration: its functional spec to choose.
    type Summary = { specs: Array<{ functionalSpecs: object[] }> };
    const summary = (await window.evaluate(() => (globalThis as unknown as { turri: { call: (method: string) => Promise<unknown> } }).turri.call("summary"))) as Summary;
    const built = { ...summary, specs: summary.specs.map((spec) => ({ ...spec, built: true, drifted: false, functionalSpecs: spec.functionalSpecs.map((entry) => ({ ...entry, built: true })) })) };
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    await send("project:opened", built);
    // A project opened is on its ***plain: back to the preview.
    await window.getByRole("tab", { name: "preview" }).click();
    const row = window.getByRole("checkbox", { name: "print-hello" });
    await expect(window.locator(".preview-home-module h3")).toHaveText("hello");
    const watch = window.getByRole("button", { name: "try it" });
    // What is tried: the newest built module's release, said once, as far as it is built.
    await expect(window.locator(".preview-home-release")).toHaveText("latest release: hello:print-hello - the codebase as built up to it");
    // A turri whose sentinel cannot be asked: no use sentinel.
    await expect(window.getByRole("button", { name: "use sentinel" })).toHaveCount(0);
    await expect(watch).toBeDisabled();

    // turri using a pane meanwhile does not take the person from the home.
    await send("preview:reveal", null);
    await expect(window.locator(".preview-home")).toHaveCount(1);

    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
    await watch.click();
    // Asked in the chat - the button's own message: try it, and what, the prompt turri heard behind it - and chosen no longer.
    const asked = window.locator(".chat-body .msg.action");
    await expect(asked.locator(".action-name")).toHaveText("try it");
    await expect(asked.locator(".action-title")).toHaveText("hello:print-hello in the release of hello");
    await asked.getByRole("button", { name: "what turri was asked" }).click();
    await expect(asked.locator(".action-prompt")).toHaveText("Open the release of hello for me to try hello:print-hello - its last commit, released first only if what runs is not - then tell me in a few steps how to try it and what I should see. Don't test it yourself: I'll try it.");
    await expect(row).toHaveAttribute("aria-checked", "false");
    // turri opens the terminal for it: the preview goes there.
    await send("terminal:reveal", null);
    await expect(window.locator(".preview-terminal")).toHaveCount(1);

    // A turri whose sentinel can be asked: use sentinel, asking the engine for a check of what is chosen - this one, the
    // pinned turri, saying it cannot.
    await send("project:opened", { ...built, offers: { ...(built as unknown as { offers: object }).offers, check: true } });
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "home" }).click();
    await window.getByRole("checkbox", { name: "print-hello" }).click();
    await window.getByRole("button", { name: "use sentinel" }).click();
    // An error opens the status panel on itself.
    await expect(window.locator(".notification.error")).toContainText("This turri's sentinel checks only the pulses that finish.");

    // The switch goes between the three.
    await window.getByRole("tab", { name: "browser" }).click();
    await expect(window.locator(".preview-address")).toHaveCount(1);
    await window.getByRole("tab", { name: "home" }).click();
    await expect(window.locator(".preview-home")).toHaveCount(1);
  });

  test("never takes the person there while turri tests: the preview glows, and they come to watch if they like", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    const tab = window.locator(".toolbar").getByRole("tab", { name: "preview" });
    await send("terminal:reveal", null);
    await send("preview:testing", true);
    // The ***plain stays in front; the preview's tab glows.
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(tab).toHaveClass(/testing/);
    await expect(tab).toHaveAttribute("title", "turri is testing - watch it");
    // In the dive too: it stays, and offers to watch.
    await showRegen(window);
    await send("terminal:reveal", null);
    await expect(window.locator(".dive")).toBeVisible();
    await window.locator(".dive-watch").click();
    // Come to watch: the preview, on what turri works in, edged - and the tab glows no more.
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(window.locator(".preview.testing .preview-terminal")).toHaveCount(1);
    await expect(tab).not.toHaveClass(/testing/);
    // turri in the browser meanwhile: the browser's switch glows, the terminal staying in front.
    await send("preview:reveal", null);
    await expect(window.getByRole("tab", { name: "browser" })).toHaveClass(/testing/);
    await expect(window.locator(".preview-terminal")).toHaveCount(1);
    await send("preview:testing", false);
    await expect(window.getByRole("tab", { name: "browser" })).not.toHaveClass(/testing/);
  });
});

// The main process says turri is testing while its browser or terminal tools run ("preview:testing"): sent here as it
// would be, as no test has a model call them.
test.describe("the preview, while turri tests in it", () => {
  let server: Server;
  let address: string;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end("<!doctype html><title>hello</title><p>hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  test("edges the browser in blue, draws the page inside the edge, and says so in its bar", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "browser" }).click();
    await window.locator(".preview-address input").fill(address);
    await window.locator(".preview-address input").press("Enter");
    const page = window.locator(".preview-page");
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]?.getBounds());
    const box = (await page.boundingBox())!;
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width));

    const testing = (now: boolean) => app.evaluate(({ BrowserWindow }, now) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", now), now);
    await testing(true);
    await expect(window.locator(".preview-bar .preview-testing")).toHaveText("turri is testing");
    await expect(window.locator(".preview.testing")).toHaveCount(1);
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width) - 6);
    expect(await page.evaluate((element) => getComputedStyle(element, "::after").borderTopWidth)).toBe("3px");

    await testing(false);
    await expect(window.locator(".preview-testing")).toHaveCount(0);
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width));
  });

  test("says who is testing which pulse, and opens its ***plain diff under the bar - the page made smaller, never drawn over", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "browser" }).click();
    await window.locator(".preview-address input").fill(address);
    await window.locator(".preview-address input").press("Enter");
    const page = window.locator(".preview-page");
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]?.getBounds());
    await expect.poll(async () => (await bounds())?.width).toBeGreaterThan(0);
    // A pulse landed, its ***plain diff with it - and a chat's turri at work in the browser.
    const diff = "--- a/hello.plain\n+++ b/hello.plain\n@@ -1,2 +1,2 @@\n ***functional specs***\n-- :Greeter: greets.\n+- :Greeter: greets the person by name.\n";
    const job = { id: "j1", kind: "regenerate", summary: "hello: by name", module: "hello", pulse: 3, title: "by name", status: "succeeded", sequence: 1, queuedAt: Date.now() - 60_000, startedAt: Date.now() - 60_000, finishedAt: Date.now(), waitingOn: [], activity: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, agents: [], specGaps: [], failures: [], diff };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    await tellChat(app, window, "chat:tool", { id: "call_1", name: "browser_click", running: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", true));
    const badge = window.locator(".preview-bar .preview-testing");
    await expect(badge).toContainText("turri is testing hello · pulse 3");
    const before = (await bounds())!;
    await badge.getByRole("button", { name: "diff" }).click();
    const shown = window.locator(".preview-diff");
    await expect(shown.locator(".preview-diff-head")).toHaveText("hello · pulse 3");
    await expect(shown.locator("pre.diff .line.add")).toHaveText("+- :Greeter: greets the person by name.");
    await expect(shown.locator("pre.diff .line.del")).toHaveText("-- :Greeter: greets.");
    // The page below it, smaller by the diff's height - never under it.
    const box = (await shown.boundingBox())!;
    await expect.poll(async () => (await bounds())!.y).toBeGreaterThanOrEqual(Math.floor(box.y + box.height));
    await expect.poll(async () => (await bounds())!.height).toBeLessThan(before.height);
    // turri between its tries: the diff stays, until put away.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", false));
    await expect(badge).toHaveCount(0);
    await expect(shown).toBeVisible();
    await shown.getByRole("button", { name: "put the diff away" }).click();
    await expect(shown).toHaveCount(0);
    await expect.poll(async () => (await bounds())!.height).toBe(before.height + 6);
  });

  test("edges the terminal too", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "terminal" }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", true));
    await expect(window.locator(".preview-bar .preview-testing")).toHaveText("turri is testing");
    await expect(window.locator(".preview.testing .preview-terminal")).toHaveCount(1);
  });
});

/** A browser or terminal tool's request, made of the window's preview as the engine makes it (main.ts's turriTool). */
function tool(app: import("@playwright/test").ElectronApplication) {
  return <Result>(kind: "browser" | "terminal", action: string, params: object) =>
    app.evaluate(({}, [kind, action, params]) => (globalThis as unknown as { turriTool: (...args: unknown[]) => Promise<unknown> }).turriTool(kind, action, params), [kind, action, params] as const) as Promise<Result>;
}

// browser_click by the text a page shows and by a point of it, as the person's own mouse: what the page heard is
// written into it, and read back with browser_read.
test.describe("browser_click", () => {
  let server: Server;
  let address: string;
  const PAGE = `<!doctype html><title>clicks</title>
    <style>body { margin: 0; font: 14px sans-serif } #board { position: absolute; left: 100px; top: 200px; width: 200px; height: 100px; background: #ddd }</style>
    <p>Save</p>
    <button id="one"><span>Save</span></button> <button id="two">Save</button> <a href="#list" id="open">Open the  list</a>
    <canvas id="board"></canvas>
    <pre id="heard"></pre>
    <script>
      const hear = (what) => (document.getElementById("heard").textContent += what + "\\n");
      for (const id of ["one", "two", "open"]) document.getElementById(id).addEventListener("click", (event) => hear("click " + id + " " + event.detail));
      const board = document.getElementById("board");
      board.addEventListener("mousedown", (event) => hear("down " + event.offsetX + "," + event.offsetY + " button " + event.button + (event.ctrlKey ? " ctrl" : "") + (event.shiftKey ? " shift" : "")));
      board.addEventListener("dblclick", () => hear("dblclick"));
      board.addEventListener("mouseover", () => hear("over"));
      board.addEventListener("contextmenu", (event) => event.preventDefault());
    </script>`;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end(PAGE));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  test("clicks by text - exact, then loosely - the clickable one, and the nth", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const request = tool(app);
    await request("browser", "navigate", { url: address });
    const heard = async () => ((await request<{ text: string }>("browser", "read", {})).text.split("\n").filter((line) => /^(click|down|dblclick|over)/.test(line)));

    expect((await request<{ did: string }>("browser", "click", { text: "Save" })).did).toBe("Clicked <button#one> `Save`.");
    expect((await request<{ did: string }>("browser", "click", { text: "Save", occurrence: 2 })).did).toBe("Clicked <button#two> `Save`.");
    expect((await request<{ did: string }>("browser", "click", { text: "open the LIST" })).did).toBe("Clicked <a#open> `Open the list`.");
    expect(await heard()).toEqual(["click one 1", "click two 1", "click open 1"]);
    await expect(request("browser", "click", { text: "Save", occurrence: 3 })).rejects.toThrow("`Save` shows 2 times on the page, not 3: <button#one> `Save`, <button#two> `Save`.");
    await expect(request("browser", "click", { text: "Delete" })).rejects.toThrow("Nothing visible on the page shows `Delete`. What can be clicked: <button#one> `Save`, <button#two> `Save`, <a#open> `Open the list`.");
    await expect(request("browser", "click", { ref: 1, text: "Save" })).rejects.toThrow("Say what to click - one of: ref, selector, text, or x and y.");
    // A ref or a selector is clicked as it was.
    expect((await request<{ did: string }>("browser", "click", { selector: "#two" })).did).toBe('Clicked button "Save"');
  });

  test("clicks a point of the screenshot as the mouse would - hovered, another button, twice, keys held", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const request = tool(app);
    await request("browser", "navigate", { url: address });
    const heard = async () => ((await request<{ text: string }>("browser", "read", {})).text.split("\n").filter((line) => /^(click|down|dblclick|over)/.test(line)));
    // Watched: the pane where the person sees it, at the size the preview gives it.
    await window.locator(".toolbar").getByRole("tab", { name: "preview" }).click();
    await expect(window.locator(".preview-page")).toBeVisible();

    // The screenshot's pixels are the page's: a point in it is the same point of the page.
    const shot = await request<{ data: string }>("browser", "screenshot", {});
    const pane = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getBounds().width);
    expect(jpegWidth(Buffer.from(shot.data, "base64"))).toBe(pane);

    expect((await request<{ did: string }>("browser", "click", { x: 150, y: 250 })).did).toBe("Clicked at 150, 250 on <canvas#board>.");
    expect(await heard()).toEqual(["over", "down 50,50 button 0"]);
    expect((await request<{ did: string }>("browser", "click", { x: 110, y: 210, button: "right", modifiers: ["ctrl", "shift"] })).did).toBe("Clicked with the right button at 110, 210 on <canvas#board>, holding ctrl+shift.");
    expect((await request<{ did: string }>("browser", "click", { x: 120, y: 220, double: true })).did).toBe("Double-clicked at 120, 220 on <canvas#board>.");
    expect((await heard()).slice(2)).toEqual(["down 10,10 button 2 ctrl shift", "down 20,20 button 0", "down 20,20 button 0", "dblclick"]);
    // A ref or selector with another button, or twice, is the mouse's too, at its middle.
    expect((await request<{ did: string }>("browser", "click", { selector: "#two", double: true })).did).toBe("Double-clicked <button#two> `Save`.");
    expect((await heard()).slice(-2)).toEqual(["click two 1", "click two 2"]);
    await expect(request("browser", "click", { x: 5000, y: 10 })).rejects.toThrow("5000, 10 is off the page as browser_screenshot shows it.");
  });
});

test.describe("terminal_screenshot", () => {
  test("is the terminal as the window draws it, in its CSS pixels", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const request = tool(app);
    await expect(request("terminal", "screenshot", {})).rejects.toThrow("Nothing has run in the terminal yet");
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "terminal" }).click();
    await expect(window.locator(".preview-terminal .xterm-screen")).toBeVisible();
    const shot = await request<{ data: string; mimeType: string; rows: number; cols: number }>("terminal", "screenshot", {});
    expect(shot.mimeType).toBe("image/jpeg");
    const width = await window.locator(".preview-terminal .xterm").evaluate((element) => Math.round(element.getBoundingClientRect().width));
    expect(jpegWidth(Buffer.from(shot.data, "base64"))).toBe(width);
    expect(shot.rows).toBeGreaterThan(2);
    // The person looking elsewhere: it is not pictured, and the window stays where they are.
    await window.locator(".toolbar").getByRole("tab", { name: "***plain" }).click();
    await expect(request("terminal", "screenshot", {})).rejects.toThrow("The person is not looking at the terminal");
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
  });
});

test.describe("the browser tools, while the person looks elsewhere", () => {
  let server: Server;
  let address: string;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end(`<!doctype html><title>away</title><button onclick="this.textContent='pressed'">press</button>`));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  test("open, read, click and picture the page out of sight - the window staying where it is", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const request = tool(app);
    await request("browser", "navigate", { url: address });
    expect((await request<{ did: string }>("browser", "click", { text: "press" })).did).toContain("press");
    expect((await request<{ text: string }>("browser", "read", {})).text).toContain("pressed");
    const shot = await request<{ data: string; mimeType: string }>("browser", "screenshot", {});
    expect(shot.mimeType).toBe("image/jpeg");
    expect(jpegWidth(Buffer.from(shot.data, "base64"))).toBeGreaterThan(100);
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    // Come to it: the page as turri left it.
    await window.locator(".toolbar").getByRole("tab", { name: "preview" }).click();
    await expect(window.locator(".preview-address input")).toHaveValue(/127\.0\.0\.1/);
  });
});

// browser_press as a keyboard presses keys - each down, held, up - on a page that listens to the keyboard itself, as a
// game does: what it heard is written into it, and read back with browser_read.
test.describe("browser_press", () => {
  let server: Server;
  let address: string;
  const PAGE = `<!doctype html><title>keys</title>
    <canvas id="game" width="200" height="100"></canvas>
    <pre id="heard"></pre>
    <script>
      const hear = (what) => (document.getElementById("heard").textContent += what + "\\n");
      const downAt = {};
      addEventListener("keydown", (event) => {
        if (event.repeat) return;
        downAt[event.code] = performance.now();
        hear("down " + event.key + " " + event.code + (event.ctrlKey ? " ctrl" : "") + (event.shiftKey ? " shift" : ""));
      });
      addEventListener("keyup", (event) => hear("up " + event.code + " " + (performance.now() - downAt[event.code] >= 300 ? "long" : "short")));
      addEventListener("keypress", (event) => hear("typed " + event.key));
    </script>`;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end(PAGE));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  test("presses keys as a keyboard does - arrows, letters, held, together, with modifiers - for a game to play", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const request = tool(app);
    await request("browser", "navigate", { url: address });
    const heard = async () => (await request<{ text: string }>("browser", "read", {})).text.split("\n").filter((line) => /^(down|up|typed) /.test(line));

    expect((await request<{ did: string }>("browser", "press", { keys: ["left", "w", "space"] })).did).toBe("Pressed left, w, space.");
    expect(await heard()).toEqual(["down ArrowLeft ArrowLeft", "up ArrowLeft short", "down w KeyW", "typed w", "up KeyW short", "down   Space", "typed  ", "up Space short"]);

    // Held as long as a move lasts; two at once, for a diagonal.
    expect((await request<{ did: string }>("browser", "press", { keys: ["right"], hold: 400 })).did).toBe("Pressed right, held 400 ms.");
    expect((await request<{ did: string }>("browser", "press", { keys: ["up", "right"], together: true })).did).toBe("Pressed up and right together.");
    expect((await heard()).slice(8)).toEqual(["down ArrowRight ArrowRight", "up ArrowRight long", "down ArrowUp ArrowUp", "down ArrowRight ArrowRight", "up ArrowRight short", "up ArrowUp short"]);

    // Modifiers held, typing nothing with ctrl; repeated.
    expect((await request<{ did: string }>("browser", "press", { keys: ["ctrl+z", "shift+a"], repeat: 2, delay: 10 })).did).toBe("Pressed ctrl+z, shift+a, 2 times.");
    expect((await heard()).slice(14, 19)).toEqual(["down z KeyZ ctrl", "up KeyZ short", "down A KeyA shift", "typed A", "up KeyA short"]);

    await expect(request("browser", "press", { keys: ["hyper+q"] })).rejects.toThrow('No such key: "hyper+q".');
    await expect(request("browser", "press", { keys: ["jump"] })).rejects.toThrow('No such key: "jump".');
    await expect(request("browser", "press", { keys: ["left"], hold: 10000, repeat: 10 })).rejects.toThrow("a minute at most");
  });
});

/** A JPEG's width, from its frame header. */
function jpegWidth(jpeg: Buffer): number {
  for (let at = 2; at < jpeg.length; ) {
    const marker = jpeg[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return jpeg.readUInt16BE(at + 7);
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return 0;
}

// The page has the keyboard once the person is there, as a browser's tab does: a game's start button, focused by the
// game, hears enter and space with no click to take the focus from it - but not over what they type elsewhere. A
// hidden window's page has the focus whatever is asked, so what is heard here is the window asking for it.
test.describe("the preview's page and the keyboard", () => {
  let server: Server;
  let address: string;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end(`<!doctype html><title>dive</title><button id="dive">dive</button><script>dive.focus()</script>`));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  /** How many times the window has asked for the page to have the keyboard since this was called (preview:go "focus"). */
  const focusAsked = async (app: import("@playwright/test").ElectronApplication) => {
    await app.evaluate(({ ipcMain }) => {
      const heard = ((globalThis as unknown as { focusAsked: number }).focusAsked = 0);
      void heard;
      ipcMain.removeHandler("preview:go");
      ipcMain.handle("preview:go", (_event, action: string) => {
        if (action === "focus") (globalThis as unknown as { focusAsked: number }).focusAsked++;
      });
    });
    return () => app.evaluate(() => (globalThis as unknown as { focusAsked: number }).focusAsked);
  };

  test("is the page's once it opens from the address bar, and again once the person comes back to it", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const asked = await focusAsked(app);
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "browser" }).click();
    await window.locator(".preview-address input").fill(address);
    await window.locator(".preview-address input").press("Enter");
    await expect.poll(asked).toBeGreaterThan(0);
    const once = await asked();
    // Away to the ***plain, and back: the page's again.
    await window.locator(".toolbar").getByRole("tab", { name: "***plain" }).click();
    await window.locator(".toolbar").getByRole("tab", { name: "preview" }).click();
    await expect.poll(asked).toBeGreaterThan(once);
  });

  test("stays where the person types when turri opens a page meanwhile", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "browser" }).click();
    await window.locator(".preview-address input").fill(`${address}?first`);
    await window.locator(".preview-address input").press("Enter");
    await expect(window.locator(".preview-address input")).toHaveValue(/\?first/);
    // Typing in the chat: turri going to another page leaves the keyboard there.
    await window.locator(".composer textarea").pressSequentially("half a mess");
    const asked = await focusAsked(app);
    await tool(app)("browser", "navigate", { url: `${address}?second` });
    await expect(window.locator(".preview-address input")).toHaveValue(/\?second/);
    await window.waitForTimeout(300);
    expect(await asked()).toBe(0);
    await expect(window.locator(".composer textarea")).toBeFocused();
  });

  test("is the page's when turri opens one with only the chat's empty message box focused - nobody typing there", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("tab", { name: "browser" }).click();
    await window.locator(".preview-address input").fill(`${address}?first`);
    await window.locator(".preview-address input").press("Enter");
    await expect(window.locator(".preview-address input")).toHaveValue(/\?first/);
    // The chat focusing its own message box, as it does when a chat is shown: then turri opens a page.
    await window.waitForTimeout(2100);
    await window.locator(".composer textarea").focus();
    const asked = await focusAsked(app);
    await tool(app)("browser", "navigate", { url: `${address}?second` });
    await expect(window.locator(".preview-address input")).toHaveValue(/\?second/);
    await expect.poll(asked).toBeGreaterThan(0);
  });
});
