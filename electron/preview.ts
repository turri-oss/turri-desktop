import { shell, WebContentsView, type BrowserWindow, type Rectangle } from "electron";

/**
 * The preview: the app turri builds, open in a browser pane of the window - a WebContentsView laid over the rectangle
 * the Preview view leaves for it. It is a page of its own: no preload, nothing of window.turri, a session of its own.
 * turri sees and tries it too, through the browser tools the engine gives its chat (engine/browser.mjs): each one a
 * request the engine sends here, done in the pane - where the person sees it, when they look at it; else in the window
 * at its size but invisible, where it still lays out, takes clicks and is pictured, out of their sight. The window is
 * never brought to it: the preview glows, and the person comes to watch if they like.
 */

export interface PreviewState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the page did not load - nothing answers there, say: the window shows it in the pane's place. */
  error: string | null;
}

/** Where turri's tools may go: the machine's own servers, not the web. */
export function isLocal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname) || hostname.endsWith(".localhost"));
  } catch {
    return false;
  }
}

/** The page's console, kept from its last load: what turri reads with browser_console. */
const CONSOLE_KEPT = 200;
/** The most of a page's text browser_read gives: a long page is cut, not sent whole. */
const TEXT_KEPT = 20000;
/** A screenshot wider than this, in the page's CSS pixels, is scaled down before turri sees it: it costs less, and reads the same. */
const SCREENSHOT_WIDTH = 1280;

/** How long the pane stays in the window, invisible, after turri's last action in it, while the person does not look at it, in ms. */
const STAGED_LINGERS = 30_000;

/** Each pane's own browser session, kept in memory: a project opened starts with no cookies, storage or cache of another's - in any window. */
let sessions = 0;

export function createPreview({ windowOf, send }: { windowOf: () => BrowserWindow | undefined; send: (channel: string, data: unknown) => void }) {
  let view: WebContentsView | undefined;
  let shown = false;
  /** In the window but invisible, for turri to work in out of the person's sight - until a while after it is done. */
  let staged: NodeJS.Timeout | undefined;
  /** Where the pane was last laid, in the window's pixels: out of sight it keeps that size. */
  let bounds: Rectangle | undefined;
  let error: string | null = null;
  let logs: string[] = [];

  const state = (): PreviewState => {
    const page = view?.webContents;
    return {
      url: page?.getURL() ?? "",
      title: page?.getTitle() ?? "",
      loading: page?.isLoading() ?? false,
      canGoBack: page?.navigationHistory.canGoBack() ?? false,
      canGoForward: page?.navigationHistory.canGoForward() ?? false,
      error,
    };
  };
  const tell = () => send("preview:state", state());

  function make(): WebContentsView {
    const made = new WebContentsView({ webPreferences: { partition: `turri-preview-${++sessions}`, sandbox: true, contextIsolation: true } });
    const page = made.webContents;
    made.setBackgroundColor("#ffffff");
    // ctrl+tab and ctrl+shift+tab in the page: the window's, to the view after the preview and the one before - the
    // window's own keys never reach it while the page has the focus.
    // ⌥⌘← and ⌥⌘→ (ctrl+alt on Linux) too: the focus to the chat, or kept in the views.
    page.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const tab = input.key === "Tab" && input.control && !input.meta && !input.alt;
      const arrow = (input.key === "ArrowLeft" || input.key === "ArrowRight") && input.alt && (process.platform === "darwin" ? input.meta : input.control);
      if (!tab && !arrow) return;
      event.preventDefault();
      if (arrow && input.key === "ArrowRight") return;
      windowOf()?.webContents.focus();
      send("menu", arrow ? "focus-chat" : input.shift ? "view-previous" : "view-next");
    });
    page.on("did-start-loading", tell);
    page.on("did-stop-loading", tell);
    page.on("page-title-updated", tell);
    page.on("did-navigate-in-page", tell);
    // A new page: its console starts again, and whatever kept the last one from loading is past.
    page.on("did-navigate", () => {
      logs = [];
      error = null;
      tell();
    });
    page.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is a load given up for another: not a failure.
      if (!isMainFrame || code === -3) return;
      error = `${description} - ${url}`;
      logs.push(`[load failed] ${description} - ${url}`);
      tell();
    });
    page.on("console-message", (event) => {
      // Electron's own, about the pane's settings: not the app's to answer for.
      if (event.message.includes("Electron Security Warning")) return;
      logs.push(`[${event.level}] ${event.message}${event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : ""}`);
      if (logs.length > CONSOLE_KEPT) logs = logs.slice(-CONSOLE_KEPT);
    });
    // A link that opens a window: the app's own stays in the pane, anything else goes to the browser.
    page.setWindowOpenHandler(({ url }) => {
      if (isLocal(url)) void page.loadURL(url);
      else void shell.openExternal(url);
      return { action: "deny" };
    });
    return made;
  }

  /** The pane laid over this rectangle of the window - the Preview view's, in its CSS pixels - or taken away. */
  function place(rect: Rectangle | null) {
    const window = windowOf();
    if (window === undefined) return;
    if (rect === null) {
      // Out of sight: invisible while turri works in it, else taken away.
      if (view !== undefined && shown) {
        if (staged !== undefined) view.setVisible(false);
        else window.contentView.removeChildView(view);
      }
      shown = false;
      return;
    }
    view ??= make();
    // The window's zoom scales its CSS pixels; the pane is placed in the window's own.
    const zoom = window.webContents.getZoomFactor();
    bounds = { x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) };
    view.setBounds(bounds);
    if (!shown) window.contentView.addChildView(view);
    view.setVisible(true);
    shown = true;
  }

  /**
   * The pane ready for turri, without the window coming to it: shown, it is where the person sees it; else it is in the
   * window at the size it had, invisible - laid out, taking clicks and pictured as if shown. The window is told turri
   * works in it, to say so: the preview glows.
   */
  async function stage() {
    send("preview:reveal", null);
    const window = windowOf();
    if (window === undefined || view === undefined) return;
    clearTimeout(staged);
    staged = setTimeout(() => {
      staged = undefined;
      if (!shown && view !== undefined && !window.isDestroyed()) window.contentView.removeChildView(view);
    }, STAGED_LINGERS);
    if (shown) return;
    const [width, height] = window.getContentSize();
    view.setBounds(bounds ?? { x: 0, y: 0, width: width!, height: height! });
    view.setVisible(false);
    window.contentView.addChildView(view);
    // A frame for the page to draw at its size.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async function open(url: string) {
    view ??= make();
    error = null;
    tell();
    try {
      await view.webContents.loadURL(url);
    } catch {
      /* did-fail-load has said why */
    }
    tell();
  }

  function go(action: "back" | "forward" | "reload" | "stop" | "devtools" | "focus") {
    const page = view?.webContents;
    if (page === undefined) return;
    if (action === "focus") page.focus();
    else if (action === "back") page.navigationHistory.goBack();
    else if (action === "forward") page.navigationHistory.goForward();
    else if (action === "stop") page.stop();
    else if (action === "devtools") page.openDevTools({ mode: "detach" });
    else if (error !== null) void open(page.getURL() || state().url);
    else page.reload();
  }

  /** Done with: a project closed for another, the window gone. Its next page starts a new pane. */
  function dispose() {
    const window = windowOf();
    // A window closing has been destroyed by now, and the pane's page may have gone with it.
    if (view !== undefined && (shown || staged !== undefined) && window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(view);
    clearTimeout(staged);
    staged = undefined;
    if (view !== undefined && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
    shown = false;
    error = null;
    logs = [];
    tell();
  }

  /** After a pulse lands: the page again, a moment later - its server may restart on the new code first. */
  function reloadSoon() {
    const url = view?.webContents.getURL();
    if (url) setTimeout(() => void open(url), 1500);
  }

  // ---------- what turri asks of it ----------

  function loaded(): WebContentsView {
    const url = view?.webContents.getURL();
    if (view === undefined || !url) throw new Error("Nothing is open in the preview: open the app first, with browser_navigate.");
    if (error !== null) throw new Error(`The preview did not load: ${error}. Is the app running?`);
    return view;
  }

  /** Until the page has loaded what an action started: a link followed, a form sent. */
  async function settle(page: Electron.WebContents) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!page.isLoading()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000);
      page.once("did-stop-loading", () => (clearTimeout(timer), resolve()));
    });
  }

  /** What runs in the page, run: what it says it did, or why it could not - an element no longer there, say. */
  async function inPage<Said extends { did?: string }>(page: Electron.WebContents, source: string): Promise<Said> {
    // As a gesture of the person's: the page treats it as theirs - a page it opens is one Back returns from.
    const said = (await page.executeJavaScript(source, true)) as Said & { error?: string };
    if (said.error !== undefined) throw new Error(said.error);
    return said;
  }

  /**
   * How many of the page's CSS pixels a pixel of browser_screenshot's image is: one, unless the page is wider than a
   * screenshot is kept and it was scaled down.
   */
  async function shotScale(page: Electron.WebContents): Promise<number> {
    const width = (await page.executeJavaScript("window.innerWidth")) as number;
    return width > SCREENSHOT_WIDTH ? width / SCREENSHOT_WIDTH : 1;
  }

  /** A click as the person's mouse makes it, at a point of the page in its CSS pixels: moved there, pressed and let go. */
  async function mouseClick(page: Electron.WebContents, point: { x: number; y: number }, { button, double, modifiers }: Clicking) {
    const zoom = page.getZoomFactor();
    const at = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
    const held = modifiers.map((modifier) => (modifier === "ctrl" ? "control" : modifier));
    page.focus();
    page.sendInputEvent({ type: "mouseMove", ...at, modifiers: held });
    for (let count = 1; count <= (double ? 2 : 1); count++) {
      page.sendInputEvent({ type: "mouseDown", ...at, button, clickCount: count, modifiers: held });
      page.sendInputEvent({ type: "mouseUp", ...at, button, clickCount: count, modifiers: held });
    }
    // The page hears them in its own time: a moment, before what it did is looked for.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const where = () => {
    const { url, title, error: failed } = state();
    return { url, title, ...(failed !== null ? { error: failed } : {}) };
  };

  const actions: Record<string, (params: any) => Promise<unknown>> = {
    navigate: async ({ url }: { url: string }) => {
      if (!isLocal(url)) throw new Error(`The preview opens only this machine's own servers - localhost and the like - not ${url}.`);
      await open(url);
      // An address that does not answer is shown as that, not as the pane: there is nothing to work in.
      if (error === null) await stage();
      return where();
    },
    screenshot: async () => {
      const page = loaded().webContents;
      await stage();
      let image = await page.capturePage();
      // In the page's own CSS pixels - not the display's, twice as many on a Retina one - so a point of it is a point
      // of the page for browser_click; a page wider than a screenshot is kept, scaled down, and its points with it.
      const width = Math.min((await page.executeJavaScript("window.innerWidth")) as number, SCREENSHOT_WIDTH);
      if (image.getSize().width !== width) image = image.resize({ width });
      return { ...where(), mimeType: "image/jpeg", data: image.toJPEG(80).toString("base64") };
    },
    read: async () => {
      const page = loaded().webContents;
      await stage();
      return { ...where(), ...(await page.executeJavaScript(script(readPage, TEXT_KEPT))) };
    },
    console: async () => ({ ...where(), lines: [...logs] }),
    click: async ({ ref, selector, text, occurrence, x, y, button = "left", double, modifiers = [] }: { ref?: number; selector?: string; text?: string; occurrence?: number; x?: number; y?: number } & Partial<Clicking>) => {
      const ways = [ref !== undefined, Boolean(selector), Boolean(text), x !== undefined || y !== undefined].filter(Boolean).length;
      if (ways !== 1) throw new Error("Say what to click - one of: ref, selector, text, or x and y.");
      if ((x === undefined) !== (y === undefined)) throw new Error("Say both x and y: a point of the page, from the top left of what browser_screenshot shows.");
      if (!["left", "middle", "right"].includes(button)) throw new Error(`No such button: ${button}. It is left, middle or right.`);
      const page = loaded().webContents;
      await stage();
      const clicking = { button, double: double === true, modifiers };
      let did: string;
      if (x !== undefined && y !== undefined) {
        const scale = await shotScale(page);
        const point = { x: x * scale, y: y * scale };
        const on = await inPage(page, script(elementAt, point.x, point.y, x, y));
        await mouseClick(page, point, clicking);
        did = `${double === true ? "Double-clicked" : "Clicked"} at ${x}, ${y} on ${on.did}.`;
      } else if (text) {
        const found = await inPage<{ did: string; x: number; y: number }>(page, script(textAt, text, Math.max(1, Math.round(occurrence ?? 1))));
        await mouseClick(page, found, clicking);
        did = `${double === true ? "Double-clicked" : "Clicked"} ${found.did}.`;
      } else if (button === "left" && double !== true && modifiers.length === 0) {
        did = (await inPage(page, script(clickOn, target(ref, selector)))).did ?? "";
      } else {
        // Another button, a double click, keys held: the mouse's own, at the element's middle.
        const found = await inPage<{ did: string; x: number; y: number }>(page, script(middleOf, target(ref, selector)));
        await mouseClick(page, found, clicking);
        did = `${double === true ? "Double-clicked" : "Clicked"} ${found.did}.`;
      }
      if (button !== "left") did = did.replace(/^(Double-clicked|Clicked)/, `$1 with the ${button} button`);
      if (modifiers.length > 0) did = did.replace(/\.$/, `, holding ${modifiers.join("+")}.`);
      await settle(page);
      return { ...where(), did };
    },
    // Keys as the keyboard presses them - each down, held, then up - on the page as it has the focus: a game's controls,
    // a shortcut. The page hears them as the person's own (sendInputEvent), as browser_click's mouse is.
    press: async ({ keys, hold = 50, together = false, repeat = 1, delay = 50 }: { keys: string[]; hold?: number; together?: boolean; repeat?: number; delay?: number }) => {
      if (!Array.isArray(keys) || keys.length === 0) throw new Error("Say which keys to press.");
      const pressed = keys.map(pageKey);
      const lasts = repeat * (together ? hold + delay : pressed.length * (hold + delay));
      if (lasts > 60_000) throw new Error(`That would take ${Math.round(lasts / 1000)} seconds of pressing - a minute at most: fewer keys, shorter holds, or fewer repeats.`);
      const page = loaded().webContents;
      await stage();
      page.focus();
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const down = (key: ReturnType<typeof pageKey>) => {
        page.sendInputEvent({ type: "keyDown", keyCode: key.keyCode, modifiers: key.modifiers });
        if (key.char !== undefined) page.sendInputEvent({ type: "char", keyCode: key.char, modifiers: key.modifiers });
      };
      const up = (key: ReturnType<typeof pageKey>) => page.sendInputEvent({ type: "keyUp", keyCode: key.keyCode, modifiers: key.modifiers });
      for (let round = 0; round < repeat; round++) {
        if (together) {
          pressed.forEach(down);
          await pause(hold);
          [...pressed].reverse().forEach(up);
          await pause(delay);
        } else {
          for (const key of pressed) {
            down(key);
            await pause(hold);
            up(key);
            await pause(delay);
          }
        }
      }
      await settle(page);
      const which = together ? `${keys.join(" and ")} together` : keys.join(", ");
      const how = [hold !== 50 ? `held ${hold} ms` : "", repeat > 1 ? `${repeat} times` : ""].filter(Boolean).join(", ");
      return { ...where(), did: `Pressed ${which}${how ? `, ${how}` : ""}.` };
    },
    type: async ({ ref, selector, text, submit }: { ref?: number; selector?: string; text: string; submit?: boolean }) => {
      const page = loaded().webContents;
      await stage();
      const said = await inPage(page, script(typeInto, target(ref, selector), text, submit === true));
      await settle(page);
      return { ...where(), did: said.did ?? "" };
    },
  };

  /** What the engine asks for one of turri's browser tools: done, and what came of it. */
  function request(action: string, params: unknown): Promise<unknown> {
    const run = actions[action];
    if (run === undefined) return Promise.reject(new Error(`No such preview action: ${action}`));
    return run(params ?? {});
  }

  return { place, open, go, state, dispose, reloadSoon, request };
}

/** browser_press's keys by name - as terminal_press names them - and the key each is to Electron's input events. */
const NAMED_KEYS: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  space: "Space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};
const MODIFIERS: Record<string, "shift" | "control" | "alt" | "meta"> = { shift: "shift", ctrl: "control", control: "control", alt: "alt", option: "alt", opt: "alt", meta: "meta", cmd: "meta", command: "meta" };
const KEY_GRAMMAR = "A key is its modifiers - ctrl, alt, shift, meta - joined by + to one key: a single character, or enter, tab, escape, backspace, delete, insert, space, up, down, left, right, home, end, pageup, pagedown, f1-f24 - such as left, space, w, shift+tab, ctrl+z.";

/** A key as browser_press names it - shift+tab, ctrl+z, left, w - as the page's keyboard sends it: its key, the keys held, and the character it types, if any. */
export function pageKey(spec: string): { keyCode: string; modifiers: Array<"shift" | "control" | "alt" | "meta">; char?: string } {
  const parsed = /^((?:[a-z]+\+)*)(.+)$/i.exec(spec.trim());
  if (parsed === null || spec.trim() === "") throw new Error(`No such key: ${JSON.stringify(spec)}. ${KEY_GRAMMAR}`);
  const named = parsed[1]!.toLowerCase().split("+").filter(Boolean);
  const modifiers = [...new Set(named.map((name) => MODIFIERS[name]))];
  if (modifiers.includes(undefined as never)) throw new Error(`No such key: ${JSON.stringify(spec)}. ${KEY_GRAMMAR}`);
  const raw = parsed[2]!;
  const lower = raw.toLowerCase();
  if (NAMED_KEYS[lower] !== undefined) return { keyCode: NAMED_KEYS[lower]!, modifiers, ...(lower === "space" && !modifiers.some((held) => held === "control" || held === "meta") ? { char: " " } : {}) };
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return { keyCode: lower.toUpperCase(), modifiers };
  if ([...raw].length !== 1) throw new Error(`No such key: ${JSON.stringify(spec)}. ${KEY_GRAMMAR}`);
  // A letter with shift is its capital, as the keyboard types it; with ctrl or meta, a shortcut that types nothing.
  const typed = modifiers.includes("shift") ? raw.toUpperCase() : raw;
  return { keyCode: raw, modifiers, ...(modifiers.some((held) => held === "control" || held === "meta") ? {} : { char: typed }) };
}

/** How a click is made: browser_click's button, a double click, the keys held. */
interface Clicking {
  button: "left" | "middle" | "right";
  double: boolean;
  modifiers: Array<"shift" | "alt" | "ctrl" | "meta">;
}

/** The element an action is on: by the number browser_read gave it, or by a CSS selector. */
function target(ref: number | undefined, selector: string | undefined): string {
  if (ref !== undefined) return `[data-turri-ref="${Number(ref)}"]`;
  if (selector) return selector;
  throw new Error("Say which element: its ref from browser_read, or a CSS selector.");
}

// What runs in the page - written as functions, sent as their source: nothing here reaches the app's own code. They
// say what went wrong rather than throw it: a throw comes back from the page as no more than that it threw.

/** The page's text, and the controls on it, each numbered (data-turri-ref) for click and type to name. */
function readPage(kept: number) {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  for (const old of document.querySelectorAll("[data-turri-ref]")) old.removeAttribute("data-turri-ref");
  const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]')]
    .filter(visible)
    .slice(0, 200)
    .map((element, index) => {
      const ref = index + 1;
      element.setAttribute("data-turri-ref", String(ref));
      const tag = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;
      const kind = tag === "input" ? `input[${input.type || "text"}]` : (element.getAttribute("role") ?? tag);
      const name = (element.getAttribute("aria-label") || element.innerText || input.placeholder || input.name || element.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const value = tag === "input" || tag === "textarea" || tag === "select" ? ` value=${JSON.stringify(input.value)}` : "";
      const href = tag === "a" ? ` -> ${element.getAttribute("href")}` : "";
      return `[${ref}] ${kind}${name ? ` ${JSON.stringify(name)}` : ""}${value}${href}`;
    });
  const text = document.body?.innerText ?? "";
  return { text: text.length > kept ? `${text.slice(0, kept)}\n[... cut at ${kept} characters]` : text, controls };
}

function clickOn(selector: string) {
  const element = findElement(selector);
  if (typeof element === "string") return { error: element };
  element.scrollIntoView({ block: "center" });
  element.focus();
  element.click();
  return { did: `Clicked ${element.tagName.toLowerCase()} ${JSON.stringify((element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 60))}` };
}

/** The middle of an element, brought into view - for the mouse to click on. */
function middleOf(selector: string) {
  const element = findElement(selector);
  if (typeof element === "string") return { error: element };
  element.scrollIntoView({ block: "center", inline: "center" });
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, did: describe(element) };
}

/**
 * The middle of the element showing a piece of text, brought into view: of the visible elements whose own text is it -
 * exactly, or else containing it, ignoring case and spacing - the innermost, and of those the clickable ones if any are.
 */
function textAt(wanted: string, occurrence: number) {
  const CLICKABLE = 'a, button, [role="button"], input, label, summary, [onclick], [tabindex]';
  const loose = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const shows = (element: HTMLElement) => {
    const input = element as HTMLInputElement;
    const own = element.tagName === "INPUT" ? (["button", "submit", "reset"].includes(input.type) ? input.value : input.placeholder) : element.innerText;
    return [own ?? "", element.getAttribute("aria-label") ?? ""];
  };
  const elements = [...document.body.querySelectorAll<HTMLElement>("*")].filter(visible);
  const matching = (match: (text: string) => boolean) => {
    const all = elements.filter((element) => shows(element).some((text) => text !== "" && match(text)));
    // The innermost: an element is left out when one inside it matches too.
    return all.filter((element) => !all.some((other) => other !== element && element.contains(other)));
  };
  let found = matching((text) => text.trim() === wanted);
  if (found.length === 0) found = matching((text) => loose(text).includes(loose(wanted)));
  // The clickable thing each is, or is in: a button's label clicks the button.
  let targets = [...new Set(found.map((element) => element.closest<HTMLElement>(CLICKABLE) ?? element))];
  if (targets.some((element) => element.matches(CLICKABLE))) targets = targets.filter((element) => element.matches(CLICKABLE));
  const saw = targets.map((element) => describe(element));
  if (targets.length === 0) {
    const candidates = [...document.querySelectorAll<HTMLElement>(CLICKABLE)].filter(visible).slice(0, 40).map((element) => describe(element));
    return { error: `Nothing visible on the page shows \`${wanted}\`.${candidates.length > 0 ? ` What can be clicked: ${candidates.join(", ")}.` : ""}` };
  }
  if (occurrence > targets.length) return { error: `\`${wanted}\` shows ${targets.length === 1 ? "once" : `${targets.length} times`} on the page, not ${occurrence}: ${saw.join(", ")}.` };
  const element = targets[occurrence - 1]!;
  element.scrollIntoView({ block: "center", inline: "center" });
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, did: saw[occurrence - 1] };
}

/** What is at a point of the page, in its CSS pixels - or why nothing is: the point is off it. `x` and `y` are as turri said them. */
function elementAt(left: number, top: number, x: number, y: number) {
  if (left < 0 || top < 0 || left >= innerWidth || top >= innerHeight) return { error: `${x}, ${y} is off the page as browser_screenshot shows it.` };
  const element = document.elementFromPoint(left, top) as HTMLElement | null;
  return { did: element === null ? "the page" : describe(element) };
}

/** Typed as a person would leave it: the value set the way the page's framework hears it, then input and change. */
function typeInto(selector: string, text: string, submit: boolean) {
  const element = findElement(selector);
  if (typeof element === "string") return { error: element };
  element.scrollIntoView({ block: "center" });
  element.focus();
  if (element.isContentEditable) element.textContent = text;
  else {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (!submit) return { did: `Typed into ${element.tagName.toLowerCase()}` };
  const form = (element as HTMLInputElement).form;
  if (form) form.requestSubmit();
  else for (const type of ["keydown", "keypress", "keyup"]) element.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
  return { did: `Typed into ${element.tagName.toLowerCase()} and submitted` };
}

/** The element a selector names - or, when there is none, why: sent to the page with clickOn and typeInto. */
function findElement(selector: string): HTMLElement | string {
  try {
    return document.querySelector<HTMLElement>(selector) ?? `Nothing on the page matches ${selector}: read the page again for its controls.`;
  } catch {
    return `${selector} is not a CSS selector.`;
  }
}

/** An element as turri is told it was clicked: <button> `Save`, <canvas#board>. */
function describe(element: HTMLElement): string {
  const tag = `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}>`;
  const input = element as HTMLInputElement;
  const name = (element.getAttribute("aria-label") || element.innerText || (element.tagName === "INPUT" ? input.value || input.placeholder : "") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return name ? `${tag} \`${name}\`` : tag;
}

/** A function of the page's, as source to run there with these arguments - and findElement and describe beside it, which it may use. */
function script(run: (...args: any[]) => unknown, ...args: unknown[]): string {
  return `(() => { ${findElement.toString()}; ${describe.toString()}; return (${run.toString()})(${args.map((arg) => JSON.stringify(arg)).join(", ")}); })()`;
}
