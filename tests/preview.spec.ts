import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, showRegen, test } from "./app.ts";

// turri's browser and terminal tools bring the window to the one they use ("preview:reveal", "terminal:reveal"): sent
// here as they would be.
test.describe("the preview", () => {
  test("opens on neither, then on each as it is used, with a switch once both are", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await expect(window.locator(".preview .empty h3")).toHaveText("nothing to try yet");
    await expect(window.locator(".preview-bar")).toHaveCount(0);

    const reveal = (channel: string) => app.evaluate(({ BrowserWindow }, channel) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel, null), channel);
    await reveal("terminal:reveal");
    await expect(window.locator(".preview-terminal")).toHaveCount(1);
    await expect(window.locator(".preview-bar .segmented")).toHaveCount(0);

    await reveal("preview:reveal");
    await expect(window.locator(".preview-address")).toHaveCount(1);
    await window.getByRole("tab", { name: "terminal" }).click();
    await expect(window.locator(".preview-terminal")).toHaveCount(1);
    await window.getByRole("tab", { name: "browser" }).click();
    await expect(window.locator(".preview-address")).toHaveCount(1);
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
    await window.getByRole("button", { name: "open a browser" }).click();
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

  test("edges the terminal too", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("button", { name: "open a terminal" }).click();
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
    await window.getByRole("button", { name: "open a terminal" }).click();
    await expect(window.locator(".preview-terminal .xterm-screen")).toBeVisible();
    // The window away from the preview: the screenshot brings it back to the terminal first.
    await showRegen(window);
    const shot = await request<{ data: string; mimeType: string; rows: number; cols: number }>("terminal", "screenshot", {});
    expect(shot.mimeType).toBe("image/jpeg");
    await expect(window.locator(".preview-terminal")).toBeVisible();
    const width = await window.locator(".preview-terminal .xterm").evaluate((element) => Math.round(element.getBoundingClientRect().width));
    expect(jpegWidth(Buffer.from(shot.data, "base64"))).toBe(width);
    expect(shot.rows).toBeGreaterThan(2);
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
