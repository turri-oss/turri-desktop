import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions, type Rectangle } from "electron";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createPreview } from "./preview.ts";
import { readSettings, writeSettings, type Settings } from "./settings.ts";
import { loadShellEnvironment } from "./shell-env.ts";
import { createTerminal, shellsEnded } from "./terminal.ts";
import { turriVersion } from "./turri-version.ts";
import { createUpdates, type UpdateState } from "./updates.ts";

/**
 * The main process: a window for each open project, and behind each its own turri engine - a Node process that hosts
 * turri's work loop (engine/engine.mjs) - and its own preview. A window never shows turri in a terminal: it asks its
 * engine for data and is sent what the jobs do as they do it. The one terminal there is, the preview's, is for the app
 * turri builds.
 */

const ROOT = join(__dirname, "..");
/** Run from source, not as installed: only then are the development hooks heard - TURRI_DEV, Vite, TURRI_APP_*. */
const DEV = !app.isPackaged;
/**
 * For the tests (TURRI_APP_HIDDEN=1): every window is made and drawn as ever, but never shown nor brought forward, and
 * the app stays out of the Dock - so a run of them takes neither the screen nor the focus from the person at it.
 */
const HIDDEN = DEV && process.env.TURRI_APP_HIDDEN === "1";
/** macOS, or Linux: the window's chrome, the menu, the Dock and the file manager differ between them. */
const MAC = process.platform === "darwin";

// Opened from Finder, the Dock or a desktop launcher, the app has none of the person's shell: its PATH and keys are read
// from their login shell as it starts, and every engine waits for them.
const shellReady = loadShellEnvironment();
const RECENTS_FILE = join(app.getPath("userData"), "recent-projects.json");
const APPEARANCE_FILE = join(app.getPath("userData"), "appearance.json");

/** Dark - turri's own - unless the person chose light or to follow the system. */
type Theme = "dark" | "light" | "system";
let theme: Theme = readTheme();
/** How far the window is zoomed: 0 is actual size, each step about 20% bigger or smaller (Electron's zoom levels). */
let zoom = readAppearance().zoom ?? 0;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;
/**
 * How long the preview stays marked as testing after turri's last browser or terminal tool, in ms: long enough to hold
 * while its model reads what came back and thinks between them, or the mark - and the pane inside its edge - flickers.
 */
const TESTING_LINGERS = 12000;

/** A screenshot wider than this is scaled down before turri sees it, as the preview page's are (electron/preview.ts). */
const TERMINAL_SHOT_WIDTH = 1280;

/**
 * The preview's terminal as the window draws it, for terminal_screenshot: the window's pixels over xterm's screen, in
 * its CSS pixels - none while the window does not show it.
 */
async function captureTerminal(window: BrowserWindow): Promise<{ data: string; mimeType: string } | null> {
  if (window.isDestroyed()) return null;
  const box = (await window.webContents.executeJavaScript(
    `(() => { const screen = document.querySelector(".preview-terminal .xterm"); if (screen === null) return null; const box = screen.getBoundingClientRect(); return box.width > 0 && box.height > 0 ? { x: box.x, y: box.y, width: box.width, height: box.height } : null; })()`,
  )) as { x: number; y: number; width: number; height: number } | null;
  if (box === null) return null;
  // The window's zoom scales its CSS pixels; a capture is in its own.
  const zoom = window.webContents.getZoomFactor();
  const rect = { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom), width: Math.round(box.width * zoom), height: Math.round(box.height * zoom) };
  let image = await window.webContents.capturePage(rect);
  const width = Math.min(Math.round(box.width), TERMINAL_SHOT_WIDTH);
  if (image.getSize().width !== width) image = image.resize({ width });
  return { data: image.toJPEG(80).toString("base64"), mimeType: "image/jpeg" };
}

function readAppearance(): { theme?: Theme; zoom?: number } {
  try {
    return JSON.parse(readFileSync(APPEARANCE_FILE, "utf8")) as { theme?: Theme; zoom?: number };
  } catch {
    return {};
  }
}

function writeAppearance() {
  writeFileSync(APPEARANCE_FILE, JSON.stringify({ theme, zoom }));
}

function readTheme(): Theme {
  const chosen = readAppearance().theme;
  return chosen === "light" || chosen === "system" ? chosen : "dark";
}

/** Zoom in, out or back to actual size - the text and everything with it - and remember it. */
function setZoom(next: number) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  for (const { window } of workspaces.values()) window.webContents.setZoomLevel(zoom);
  writeAppearance();
  sendSettings();
}

/** The window's own colour behind the page, as the theme has it - what shows while it loads or resizes. */
function backgroundFor(): string {
  return (theme === "system" ? nativeTheme.shouldUseDarkColors : theme === "dark") ? "#0a0f1a" : "#f4f7f9";
}

function setTheme(next: Theme) {
  theme = next;
  writeAppearance();
  // Menus, dialogs and the title bar follow it too.
  nativeTheme.themeSource = theme;
  for (const workspace of workspaces.values()) {
    workspace.window.setBackgroundColor(backgroundFor());
    workspace.send("theme", theme);
  }
  buildMenu();
  sendSettings();
}

// ---------- settings ----------

/** The app's settings beyond its look: the models a new project starts on, and how it updates (settings.json). */
let settings: Settings = readSettings();

/** Everything the settings sheet shows: the look, and the rest. */
const allSettings = () => ({ theme, zoom, ...settings });

/** Each window's settings sheet, if open, shows what changed - from the menu, or another window. */
function sendSettings() {
  for (const workspace of workspaces.values()) workspace.send("settings", allSettings());
}

function changeSettings(next: Partial<ReturnType<typeof allSettings>>) {
  if (next.theme !== undefined && next.theme !== theme) setTheme(next.theme);
  if (next.zoom !== undefined && next.zoom !== zoom) setZoom(next.zoom);
  const { theme: _theme, zoom: _zoom, ...rest } = next;
  if (Object.keys(rest).length === 0) return allSettings();
  settings = { ...settings, ...rest };
  writeSettings(settings);
  updates.configure({ prerelease: settings.prerelease, automatic: settings.checkUpdates });
  if (rest.checkUpdates === true) updates.start();
  sendSettings();
  return allSettings();
}

// ---------- a window and what is behind it ----------

/** A window and what is behind it: the project open in it, its engine, its preview and the preview's terminal. */
interface Workspace {
  window: BrowserWindow;
  preview: ReturnType<typeof createPreview>;
  terminal: ReturnType<typeof createTerminal>;
  send(channel: string, data: unknown): void;
  /** Its pulses running now. */
  running: number;
  /** Whether the ***plain open in it has changed since its code was built: Regenerate What Changed has something to do. */
  changed: boolean;
  /**
   * Its chats open now - as many as ⌘W can close: the one shown while the person has another, or the sentinel's - the
   * window once it shows the person's last.
   */
  chats: number;
  /** Whether its turri opens more chats than one: ⌘T is offered only then. */
  manyChats: boolean;
  /** The project open in it, once one is. */
  readonly dir: string | undefined;
  /** The project being opened in it, while it is. */
  readonly opening: string | undefined;
  /** Whether a project is open in it and answering - not one whose engine has stopped. */
  readonly open: boolean;
  /** Its project's name, once one is open. */
  readonly name: string | undefined;
  call(method: string, params?: unknown): Promise<unknown>;
  openProject(dir: string): Promise<unknown>;
  startProject(dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }): Promise<unknown>;
  /** Its engine, started if no project has started it yet: for what it is asked before a project opens. */
  anEngine(): Promise<void>;
  /** The folder the new-project sheet made last in it, still to be started: the one it may take away again. */
  made?: string;
}

/** Every window, by its id: each with the project open in it, or none yet - the welcome screen. */
const workspaces = new Map<number, Workspace>();
/** The window the person was in last: the menu's and the Dock's, even while the app itself is not in front. */
let lastFocused: Workspace | undefined;
/** Windows by when they were last in front, the latest first: the project switcher lists them so. */
let byRecency: Workspace[] = [];

function workspaceOf(sender: Electron.WebContents): Workspace {
  const workspace = workspaces.get(BrowserWindow.fromWebContents(sender)?.id ?? -1);
  if (workspace === undefined) throw new Error("This window is closing.");
  return workspace;
}

function focused(): Workspace | undefined {
  const window = BrowserWindow.getFocusedWindow();
  // None focused yet - a window never shown, as the tests' are: the only one there is.
  return (window && workspaces.get(window.id)) ?? lastFocused ?? (workspaces.size === 1 ? [...workspaces.values()][0] : undefined);
}

/** Pulses running in every window: the Dock's badge counts them all. */
function showRunning() {
  app.dock?.setBadge(runningEverywhere() > 0 ? String(runningEverywhere()) : "");
}

function runningEverywhere(): number {
  return [...workspaces.values()].reduce((sum, workspace) => sum + workspace.running, 0);
}

// ---------- updates ----------

// The app's own, from its GitHub releases: the menu says where it is - checking, downloading, ready to restart. A
// download's progress changes no menu.
let updateStatus: UpdateState["status"] | undefined;
const updates = createUpdates({
  prerelease: settings.prerelease,
  automatic: settings.checkUpdates,
  onChange: (state) => {
    // The settings sheet says where it is, the download's progress too.
    for (const workspace of workspaces.values()) workspace.send("updates", state);
    if (state.status === updateStatus) return;
    updateStatus = state.status;
    buildMenu();
  },
});

/** Restarts into the update downloaded - asking first while pulses run, as quitting stops them. */
async function restartToUpdate() {
  const running = runningEverywhere();
  if (running > 0) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: `restart to update while ${running === 1 ? "a pulse runs" : `${running} pulses run`}?`,
      detail: "restarting stops them. later, it is installed when turri next quits.",
      buttons: ["restart", "later"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  updates.install();
}

/** Check for Updates…, chosen: says what it found, as the check runs on its own otherwise. */
async function checkForUpdates() {
  const state = await updates.check();
  const said =
    state.status === "off"
      ? { message: "turri cannot update itself here", detail: `${state.reason}.` }
      : state.status === "failed"
        ? { message: "turri could not check for updates", detail: state.error }
        : state.status === "downloading"
          ? { message: `turri ${state.version} is downloading`, detail: "you are told when it is ready to restart into." }
          : state.status === "ready"
            ? undefined
            : { message: "turri is up to date", detail: `this is turri ${app.getVersion()}.` };
  if (said === undefined) return void restartToUpdate();
  void dialog.showMessageBox({ type: "info", ...said, buttons: ["ok"] });
}

/** The menu's word on updates: in the app menu on macOS, in Help on Linux. */
function updateItem(): MenuItemConstructorOptions {
  const state = updates.state();
  if (state.status === "ready") return { label: `Restart to Update to ${state.version}`, click: () => void restartToUpdate() };
  if (state.status === "downloading") return { label: `Downloading turri ${state.version}…`, enabled: false };
  if (state.status === "checking") return { label: "Checking for Updates…", enabled: false };
  return { label: "Check for Updates…", click: () => void checkForUpdates() };
}

/** A window shown - and, unless only shown, brought forward and focused: never while the tests run hidden. */
function bringForward(window: BrowserWindow, focus = true) {
  if (HIDDEN) return;
  window.show();
  if (focus) window.focus();
}

/**
 * One window - the welcome screen until a project opens in it - with the project's engine, its preview and the
 * preview's terminal. Closing the window stops them all.
 */
function createWorkspace(): Workspace {
  // A new window a step down and right of the one in front, so both are seen.
  const [x, y] = focused()?.window.getPosition() ?? [];
  const window = new BrowserWindow({
    width: 1560,
    height: 860,
    ...(x !== undefined && y !== undefined ? { x: x + 28, y: y + 28 } : {}),
    minWidth: 1100,
    minHeight: 620,
    title: "turri",
    icon: join(ROOT, "build", "icon.png"),
    // On macOS the window draws to its top edge, under the traffic lights; Linux keeps its window manager's title bar.
    ...(MAC ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    backgroundColor: backgroundFor(),
    show: false,
    // Sandboxed, as any page: the preload reaches the app only by asking the main process (window.turri), nothing of Node.
    // Hidden, for the tests, it would be throttled as a window in the background is: it draws and its timers run as ever.
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: !HIDDEN },
  });

  const send = (channel: string, data: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, data);
  };
  const preview = createPreview({ windowOf: () => (window.isDestroyed() ? undefined : window), send });
  const terminal = createTerminal({ send, capture: () => captureTerminal(window) });
  // turri's browser and terminal tools at work in the preview: the window marks it as testing ("preview:testing") from
  // the first until a moment after the last - turri thinks between them, and the mark would flicker otherwise.
  let testing = 0;
  let testingOver: NodeJS.Timeout | undefined;
  const testingStarts = () => {
    clearTimeout(testingOver);
    if (testing++ === 0) send("preview:testing", true);
  };
  const testingEnds = () => {
    if (--testing > 0) return;
    testingOver = setTimeout(() => send("preview:testing", false), TESTING_LINGERS);
  };
  let engine: ChildProcess | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  /** Whether the engine has a project open: one that has not - started for a new project's config - opens one as it is. */
  let engineHasProject = false;
  /** The project open in this window, and its name, once it is. */
  let dir: string | undefined;
  let name: string | undefined;
  /** The project being opened, while it is: the window waits under a spinner, and the menu's project items wait too. */
  let opening: string | undefined;
  let closed = false;
  /** Settled once the page has loaded: a project opened in a new window waits for it. */
  const loaded = new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
  // The window drawn again - reloaded, ⌘R: it is given back the project open in it, whose engine never stopped, and
  // takes up its conversation and pulses from the engine as when it was opened. Else it would show its welcome screen,
  // and opening the project again would only bring this window forward.
  let drawn = false;
  // Full screen, macOS draws no traffic lights over the window: the toolbar has no room to leave for them.
  window.on("enter-full-screen", () => send("fullscreen", true));
  window.on("leave-full-screen", () => send("fullscreen", false));
  window.webContents.on("did-finish-load", () => {
    send("fullscreen", window.isFullScreen());
    if (!drawn) return void (drawn = true);
    if (dir !== undefined && workspace.open) void call("summary").then((summary) => send("project:opened", summary), () => {});
  });

  const workspace: Workspace = {
    window,
    preview,
    terminal,
    send,
    running: 0,
    changed: false,
    chats: 0,
    manyChats: false,
    get dir() {
      return dir;
    },
    get opening() {
      return opening;
    },
    get name() {
      return name;
    },
    get open() {
      return engine !== undefined && engineHasProject && opening === undefined;
    },
    call,
    openProject,
    startProject,
    anEngine,
  };

  async function startEngine(): Promise<void> {
    await shellReady;
    engine?.kill();
    for (const { reject } of pending.values()) reject(new Error("The engine restarted."));
    pending.clear();
    // Electron's own Node runs it: turri comes compiled, from the @turri-dev/cli package, so no other Node is needed.
    // As installed it is always the package's turri: a TURRI_DEV in the person's shell is left out.
    // The person's NODE_OPTIONS are for their own Node, not Electron's, which exits (9) on a flag it does not take - as
    // --openssl-legacy-provider: the engine starts without them, and gives them back to what turri runs.
    const { TURRI_DEV, NODE_OPTIONS, ...env } = process.env;
    const child = fork(join(ROOT, "engine", "engine.mjs"), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...env, ...(DEV && TURRI_DEV !== undefined ? { TURRI_DEV } : {}), ...(NODE_OPTIONS !== undefined ? { TURRI_NODE_OPTIONS: NODE_OPTIONS } : {}), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    engine = child;
    // The last line it said on stderr - not a stack frame, nor Node's version after a crash: why, when it exits.
    let said = "";
    child.stdout?.on("data", (chunk) => send("engine:log", { level: "stdout", text: String(chunk) }));
    child.stderr?.on("data", (chunk) => {
      said = String(chunk).split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("at ") && !/^Node\.js v/.test(line)).at(-1) ?? said;
      send("engine:log", { level: "stderr", text: String(chunk) });
    });
    return new Promise((resolve, reject) => {
      child.on("message", (message: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown; browser?: string; terminal?: string; params?: unknown }) => {
        if (message.event === "ready") {
          // Which turri the engine runs - the package, or a clone's sources (TURRI_DEV) - said where the app was started.
          console.log(`turri engine: Node ${(message.data as { node: string }).node}, turri from ${(message.data as { turri: string }).turri}`);
          return resolve();
        }
        // One of turri's browser or terminal tools, asked of the preview: done there, and answered - the window saying
        // turri is testing while it is.
        if (message.browser !== undefined || message.terminal !== undefined) {
          testingStarts();
          const done = message.browser !== undefined ? preview.request(message.browser, message.params) : terminal.request(message.terminal!, message.params);
          done.finally(testingEnds).then(
            (result) => child.connected && child.send({ reply: message.id, result }),
            (error) => child.connected && child.send({ reply: message.id, error: error instanceof Error ? error.message : String(error) }),
          );
          return;
        }
        if (message.event !== undefined) return onEngineEvent(message.event, message.data);
        const call = pending.get(message.id!);
        if (call === undefined) return;
        pending.delete(message.id!);
        if (message.error !== undefined) call.reject(new Error(message.error));
        else call.resolve(message.result);
      });
      child.on("exit", (code) => {
        reject(new Error(`The turri engine exited (${code})${said !== "" ? `: ${said}` : ""}.${!DEV ? "" : TURRI_DEV ? ` Is TURRI_DEV=${TURRI_DEV} a turri clone, with its packages installed (npm install there)?` : " Is @turri-dev/cli installed (npm install)?"}`));
        // One replaced by another, or stopped with its window, was stopped on purpose: only the current one's end is news.
        if (engine !== child || closed) return;
        engine = undefined;
        engineHasProject = false;
        workspace.running = 0;
        workspace.chats = 0;
        showRunning();
        send("engine:exit", { code });
        buildMenu();
      });
    });
  }

  function call(method: string, params?: unknown): Promise<unknown> {
    if (engine === undefined) return Promise.reject(new Error("No project is open."));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      engine!.send({ id, method, params });
    });
  }

  function onEngineEvent(event: string, data: any) {
    send(`engine:${event}`, data);
    // A sign-in's page, opened in the person's browser - the window shows the address too, for when it does not open.
    if (event === "auth:event" && data.event.type === "auth_url" && /^https?:\/\//.test(data.event.url)) void shell.openExternal(data.event.url);
    // New code under the preview: it is loaded again.
    if (event === "finished" && data.status === "succeeded") preview.reloadSoon();
    // turri's session ended - ctrl+c in a chat doing nothing, as it leaves turri in a terminal: its window closes.
    if (event === "ended" && !window.isDestroyed()) window.close();
    // How many chats there are, for ⌘W to close one or the window: the sentinel's shown closes, as one of two would.
    if (event === "chats") {
      const chats = data as Array<{ shown: boolean; role?: string }>;
      const count = chats.some((chat) => chat.shown && chat.role !== undefined) ? Math.max(2, chats.length) : chats.filter((chat) => chat.role === undefined).length;
      if (count !== workspace.chats) {
        workspace.chats = count;
        buildMenu();
      }
    }
    if (event === "status") {
      workspace.running = (data.jobs as Array<{ status: string }>).filter((job) => job.status === "running").length;
      showRunning();
    }
  }

  async function openProject(named: string) {
    const next = canonical(named);
    readable(next);
    await loaded;
    // The project open now stops answering as soon as its engine is stopped: the window says it is opening another.
    opening = next;
    send("project:opening", { dir: next, name: basename(next) });
    buildMenu();
    try {
      if (engine === undefined || engineHasProject) await startEngine();
      engineHasProject = true;
      // Another project's app is not this one's: the preview starts empty, and its terminal in this project's folder.
      preview.dispose();
      terminal.setDir(next);
      const summary = await call("open", { dir: next });
      workspace.manyChats = (summary as { offers: { chats?: boolean } }).offers.chats === true;
      dir = next;
      name = (summary as { name: string }).name;
      writeFileSync(RECENTS_FILE, JSON.stringify([next, ...recents().filter((other) => other !== next)].slice(0, RECENTS_KEPT)));
      app.addRecentDocument(next);
      if (!window.isDestroyed()) {
        if (MAC) window.setRepresentedFilename(next);
        // The Window menu, ⌘` and the Dock name each window by it.
        window.setTitle(name);
      }
      return summary;
    } catch (error) {
      // Not opened: the window stops waiting. Opened, it stops once it has the project - sooner, the last one shows again.
      send("project:opening", null);
      throw error;
    } finally {
      opening = undefined;
      buildMenu();
    }
  }

  /** The engine, started if no project has started it yet: for what it is asked before a project opens. */
  async function anEngine() {
    if (engine === undefined) await startEngine();
  }

  /** A new project's config.turri.yaml, written by turri with the models chosen - then the project, opened on them. */
  async function startProject(dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }) {
    readable(canonical(dir));
    await anEngine();
    const { message } = (await call("initConfig", { dir, vendor, bedrock, models })) as { message: string };
    // Its config written, the project is made, whether it opens or not: one that does not - no credentials for the models
    // chosen, say - is said so, not thrown, for the window to say why and try again.
    try {
      return { ...((await openProject(dir)) as object), setup: message };
    } catch (error) {
      return { setup: message, failed: error instanceof Error ? error.message : String(error) };
    }
  }

  workspaces.set(window.id, workspace);
  // For the tests: a browser or terminal tool's request, made of the newest window's preview as the engine makes it -
  // as no test has a model call them.
  if (HIDDEN) (globalThis as unknown as { turriTool: unknown }).turriTool = (kind: "browser" | "terminal", action: string, params: unknown) => (kind === "browser" ? preview : terminal).request(action, params);
  window.once("ready-to-show", () => bringForward(window, false));
  window.on("focus", () => {
    lastFocused = workspace;
    byRecency = [workspace, ...byRecency.filter((other) => other !== workspace)];
    buildMenu();
  });
  // The zoom chosen last time, kept across reloads and launches.
  window.webContents.on("did-finish-load", () => window.webContents.setZoomLevel(zoom));
  // Links leave the app for the browser - web links only, never a file or another app's scheme; the window only ever
  // shows the app, and never goes to another page.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  if (DEV && process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(ROOT, "dist", "index.html"));
  window.on("closed", () => {
    // Gone first: the preview's clean-up must not reach for a window already destroyed, nor send to it.
    closed = true;
    workspaces.delete(window.id);
    if (lastFocused === workspace) lastFocused = undefined;
    byRecency = byRecency.filter((other) => other !== workspace);
    engine?.kill();
    preview.dispose();
    terminal.dispose();
    showRunning();
    buildMenu();
  });
  return workspace;
}

/** Every window's engine and terminal stopped: the app is quitting. */
function closeAll() {
  for (const { window } of workspaces.values()) if (!window.isDestroyed()) window.destroy();
}

// ---------- projects ----------

/** How many recent projects are kept: the welcome screen searches them. */
const RECENTS_KEPT = 30;

/** A project's folder as one path - absolute, its links followed - however it was named: the same folder is one recent. */
/**
 * A project's folder, read before turri is started in it - or why it cannot be, in words, for the window to say. macOS's
 * privacy protection keeps an app out of Desktop, Documents, Downloads and the like until the person allows it, and a
 * process started in such a folder cannot even ask where it is: Node's "EPERM: process.cwd failed, uv_cwd".
 */
function readable(dir: string) {
  try {
    readdirSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const shown = dir === homedir() || dir.startsWith(homedir() + "/") ? `~${dir.slice(homedir().length)}` : dir;
    if (code === "ENOENT") throw new Error(`${shown} is not there any more: it was moved, renamed or deleted.`);
    if (code === "EPERM" && MAC) throw new Error(`macOS is not letting turri read ${shown}. please allow permissions or move a project somewhere else`);
    if (code === "EPERM" || code === "EACCES") throw new Error(`${shown} cannot be read: its permissions do not let you. see who may with ls -ld ${shown}.`);
    throw error;
  }
}

function canonical(dir: string): string {
  const full = resolve(dir);
  try {
    return realpathSync(full);
  } catch {
    return full;
  }
}

function recents(): string[] {
  try {
    const dirs = (JSON.parse(readFileSync(RECENTS_FILE, "utf8")) as string[]).filter((dir) => existsSync(dir)).map(canonical);
    return [...new Set(dirs)];
  } catch {
    return [];
  }
}

/**
 * Where a project opens: the window it is open in already, brought forward - one engine to a project, never two
 * work loops on the same files - or else the window asking, if it has no project yet, or else a window of its own.
 * What is opened is the window's to show; nothing is when the project was open already.
 */
function openWhere(from: Workspace | undefined, named: string): { into: Workspace; opened: Promise<unknown> } {
  const dir = canonical(named);
  const there = [...workspaces.values()].find((workspace) => workspace.dir === dir || workspace.opening === dir);
  if (there !== undefined) {
    bringForward(there.window);
    // Its engine stopped: it is opened again there.
    if (there.open || there.opening !== undefined) return { into: there, opened: Promise.resolve(null) };
    return { into: there, opened: there.openProject(dir) };
  }
  const into = from !== undefined && from.dir === undefined && from.opening === undefined ? from : createWorkspace();
  return { into, opened: into.openProject(dir) };
}

/** A project opened from the menu, the Dock or a welcome screen into another window: that window is sent it, or why not. */
function deliver({ into, opened }: { into: Workspace; opened: Promise<unknown> }) {
  opened.then(
    (summary) => summary && into.send("project:opened", summary),
    (error) => {
      const text = error instanceof Error ? error.message : String(error);
      // A window made for it, still on its welcome screen, says it there; one with a project, in its notice.
      into.send("project:failed", { text });
      if (into.dir === undefined) void dialog.showMessageBox(into.window, { type: "warning", message: "The project did not open.", detail: text });
    },
  );
}

/** A project opened from a welcome screen: its summary when it opened there, null when it opened - or was open - in another window. */
async function openFrom(from: Workspace, named: string) {
  const where = openWhere(from, named);
  if (where.into === from) return where.opened;
  deliver(where);
  return null;
}

async function chooseProject(from: Workspace | undefined) {
  const options = { title: "Open a turri project", properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">, buttonLabel: "Open Project" };
  const result = from ? await dialog.showOpenDialog(from.window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0]!;
}

/**
 * A new project's folder: named and placed in the save sheet, and made. A folder of that name with anything in it
 * already is not taken over. Nothing is opened yet - the window asks which models it runs on first (startProject).
 */
async function newProjectFolder(from: Workspace) {
  const result = await dialog.showSaveDialog(from.window, {
    title: "Start a new turri project",
    buttonLabel: "Create",
    nameFieldLabel: "Project name:",
    defaultPath: join(app.getPath("documents"), "my-project"),
    properties: ["createDirectory"],
  });
  if (result.canceled || result.filePath === undefined) return null;
  const dir = result.filePath;
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).some((name) => !name.startsWith(".")))) {
    throw new Error(`${basename(dir)} is there already, with files in it: choose another name, or open it as a project.`);
  }
  mkdirSync(dir, { recursive: true });
  from.made = dir;
  return dir;
}

/** The projects open in every window, the one last in front first - each with its window's id, and whether it is the asking one. */
function openProjects(from: Workspace) {
  const all = [...byRecency, ...[...workspaces.values()].filter((workspace) => !byRecency.includes(workspace))];
  return all
    .filter((workspace) => workspace.dir !== undefined)
    .map((workspace) => ({ id: workspace.window.id, name: workspace.name ?? basename(workspace.dir!), dir: workspace.dir!, running: workspace.running, here: workspace === from }));
}

/** A new project is started in a window with none yet: the one in front if it has none, a new one otherwise. */
async function newProject() {
  const front = focused();
  const into = front !== undefined && front.dir === undefined && front.opening === undefined ? front : createWorkspace();
  await new Promise<void>((resolve) => (into.window.webContents.isLoading() ? into.window.webContents.once("did-finish-load", () => resolve()) : resolve()));
  into.send("menu", "new-project");
}

// ---------- the menu ----------

function buildMenu() {
  const front = focused();
  const menuAction = (action: string) => () => focused()?.send("menu", action);
  const ready = front?.open === true;
  // ⌘W, as in a browser: the chat shown, while there is another - else the window.
  const closesChat = ready && (front?.chats ?? 0) > 1;
  const closeItem: MenuItemConstructorOptions = {
    label: closesChat ? "Close Chat" : "Close Window",
    accelerator: "CmdOrCtrl+W",
    click: () => {
      const now = focused();
      if (now?.open === true && now.chats > 1) now.send("menu", "close-chat");
      else BrowserWindow.getFocusedWindow()?.close();
    },
  };
  const template: MenuItemConstructorOptions[] = [
    // macOS's app menu - About, updates, Hide, Quit; elsewhere Quit is in File.
    ...(MAC
      ? [
          {
            label: app.name,
            submenu: [
              { label: "About turri", click: menuAction("about") },
              updateItem(),
              { type: "separator" },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: menuAction("settings") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ] as MenuItemConstructorOptions[],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: () => void newProject() },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: async () => {
          const from = focused();
          const dir = await chooseProject(from);
          if (dir !== null) deliver(openWhere(from, dir));
        } },
        ...(MAC ? [{ role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] } as MenuItemConstructorOptions] : []),
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => void createWorkspace() },
        // ⌘T, as in a browser: a new chat with turri beside the others - a tab of the chat.
        { label: "New Chat", accelerator: "CmdOrCtrl+T", click: menuAction("new-chat"), enabled: ready && front?.manyChats === true },
        { label: "Switch Project…", accelerator: "CmdOrCtrl+Shift+P", click: menuAction("switch-project") },
        { type: "separator" },
        { label: "Project Settings…", click: menuAction("project-settings"), enabled: ready },
        { label: "Sign In to Model Providers…", click: menuAction("sign-in") },
        { type: "separator" },
        { label: "Save ***plain", accelerator: "CmdOrCtrl+S", click: menuAction("save"), enabled: ready },
        { type: "separator" },
        { label: MAC ? "Reveal Project in Finder" : "Show Project in File Manager", click: menuAction("reveal"), enabled: ready },
        { type: "separator" },
        ...(MAC ? [] : [{ label: "Settings…", accelerator: "CmdOrCtrl+,", click: menuAction("settings") }, { type: "separator" as const }]),
        closeItem,
        ...(MAC ? [] : [{ role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "***plain", accelerator: "CmdOrCtrl+1", click: menuAction("view:spec") },
        { label: "preview", accelerator: "CmdOrCtrl+3", click: menuAction("view:preview") },
        { type: "separator" },
        { label: "Dive", accelerator: "CmdOrCtrl+2", click: menuAction("dive") },
        { type: "separator" },
        { label: "Show or Hide the Files", accelerator: "CmdOrCtrl+B", click: menuAction("sidebar") },
        { label: "Show or Hide the Chat", accelerator: "CmdOrCtrl+J", click: menuAction("chat") },
        {
          label: "Appearance",
          submenu: (["dark", "light", "system"] as Theme[]).map((name) => ({
            label: name === "system" ? "Same as the System" : name === "dark" ? "Dark" : "Light",
            type: "radio" as const,
            checked: theme === name,
            click: () => setTheme(name),
          })),
        },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => setZoom(0) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => setZoom(zoom + 0.5) },
        // ⌘= as well: on most keyboards + is shift+=, and ⌘+ is pressed without the shift.
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => setZoom(zoom + 0.5), visible: false, acceleratorWorksWhenHidden: true },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => setZoom(zoom - 0.5) },
        { type: "separator" },
        // ⌘R reloads, as in a browser - the window says what: the page being tried, in the preview, else the window.
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: menuAction("reload"),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // What turri does with the spec in front.
    {
      label: "***plain",
      submenu: [
        { label: "Regenerate…", click: menuAction("regenerate-how"), enabled: ready },
        { label: "Regenerate What Changed", accelerator: "CmdOrCtrl+Shift+R", click: menuAction("regenerate"), enabled: ready && front?.changed === true },
        { label: "Preview the Plan", click: menuAction("glimpse"), enabled: ready },
        { label: "Write Conformance Tests", click: menuAction("conform"), enabled: ready },
        { type: "separator" },
        // The stdlib view, here rather than among the views' tabs: turri's standard library to look through.
        { label: "Standard Library", accelerator: "CmdOrCtrl+4", click: menuAction("view:stdlib"), enabled: ready },
      ],
    },
    // At the right, before Help, as in every Mac app: macOS lists the open windows here, each by its project's name,
    // and ⌘` goes from one to the next; Linux has Minimize and Close - File's, as ⌘W closes a chat first.
    MAC ? { role: "windowMenu" } : { label: "Window", submenu: [{ role: "minimize" }, { label: "Close Window", click: () => BrowserWindow.getFocusedWindow()?.close() }] },
    {
      role: "help",
      submenu: [
        { label: "Getting Started", click: menuAction("getting-started") },
        { label: "Check This Machine…", click: menuAction("doctor") },
        { type: "separator" },
        { label: "What turri Sends, and Where…", click: menuAction("privacy") },
        { label: "Third-Party Notices…", click: menuAction("notices") },
        ...(MAC ? [] : [{ type: "separator" as const }, { label: "About turri", click: menuAction("about") }, updateItem()]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- the bridge ----------

/** A path the window names, if it is in the window's project: the folder itself or anything under it. */
function inProject(workspace: Workspace, path: string): string {
  const full = resolve(path);
  const within = workspace.dir === undefined ? undefined : relative(workspace.dir, full);
  if (within === undefined || within.startsWith("..") || isAbsolute(within)) throw new Error("That is not a file of this project.");
  return full;
}

/** Only the settings there are, each of its own kind: the window says what it changes, never what the app keeps. */
function pickSettings(next: Record<string, unknown>): Partial<ReturnType<typeof allSettings>> {
  return {
    ...(next.theme === "dark" || next.theme === "light" || next.theme === "system" ? { theme: next.theme } : {}),
    ...(typeof next.zoom === "number" && Number.isFinite(next.zoom) ? { zoom: next.zoom } : {}),
    ...(typeof next.vendor === "string" || next.vendor === null ? { vendor: next.vendor as string | null } : {}),
    ...(typeof next.checkUpdates === "boolean" ? { checkUpdates: next.checkUpdates } : {}),
    ...(typeof next.prerelease === "boolean" ? { prerelease: next.prerelease } : {}),
  };
}

/** A notice's answer, as the window may give it: one of its actions by index, the person's words, dismissed, or ignored. */
function noticeAnswer(answer: unknown): { action: number } | { steer: string } | { dismiss: true } | { ignore: true } {
  const given = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.length === 1 && Number.isInteger(given.action) && (given.action as number) >= 0) return { action: given.action as number };
  if (keys.length === 1 && typeof given.steer === "string" && given.steer.trim() !== "") return { steer: given.steer };
  if (keys.length === 1 && given.dismiss === true) return { dismiss: true };
  if (keys.length === 1 && given.ignore === true) return { ignore: true };
  throw new Error("A notice is answered with one of its actions, the person's words, dismissed, or ignored.");
}

/** What the window asks of its engine, checked where a method takes more than the engine can check itself. */
function engineParams(method: string, params: unknown): unknown {
  if (method !== "answerNotice") return params;
  const { id, answer } = (params ?? {}) as { id?: unknown; answer?: unknown };
  if (typeof id !== "string" || id === "") throw new Error("Which notice is answered?");
  return { id, answer: noticeAnswer(answer) };
}

// Each window asks of its own workspace: its engine, its preview, its terminal.
ipcMain.handle("engine:call", (event, method: string, params: unknown) => workspaceOf(event.sender).call(method, engineParams(method, params)));
// Files attached to a message in the chat, chosen in the open sheet - from the project's folder at first. An image goes
// with its bytes, for the model to see; any other file, and an image too large to send, by its path, for turri to read.
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const ATTACHED_IMAGE_SIZE = 20 * 1024 * 1024;
ipcMain.handle("chat:attach", async (event) => {
  const workspace = workspaceOf(event.sender);
  const result = await dialog.showOpenDialog(workspace.window, { title: "Attach to the message", properties: ["openFile", "multiSelections"], buttonLabel: "Attach", defaultPath: workspace.dir });
  if (result.canceled) return [];
  return result.filePaths.map((path) => {
    const mimeType = IMAGE_TYPES[extname(path).toLowerCase()];
    const image = mimeType !== undefined && statSync(path).size <= ATTACHED_IMAGE_SIZE ? { mimeType, data: readFileSync(path).toString("base64") } : undefined;
    return { name: basename(path), path, ...(image ? { image } : {}) };
  });
});
ipcMain.handle("project:choose", async (event) => {
  const from = workspaceOf(event.sender);
  const dir = await chooseProject(from);
  return dir === null ? null : openFrom(from, dir);
});
ipcMain.handle("project:new", (event) => newProjectFolder(workspaceOf(event.sender)));
ipcMain.handle("project:vendors", async (event) => {
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call("vendors");
});
// Whether this machine - and the window's project, once one is open - is ready for turri: asked of its engine, started for it if
// need be, so the checks look on the PATH turri runs with.
ipcMain.handle("doctor:run", async (event, models: boolean, dir?: string) => {
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call("doctor", { models, ...(dir !== undefined ? { dir } : {}) });
});
// Signing in to the model providers, asked of the window's engine - started for it if need be, as on the welcome screen.
const AUTH_METHODS = new Set(["authProviders", "authLogin", "authAnswer", "authCancel", "authLogout"]);
ipcMain.handle("auth:call", async (event, method: string, params: unknown) => {
  if (!AUTH_METHODS.has(method)) throw new Error(`Not a sign-in method: ${method}`);
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call(method, params);
});
ipcMain.handle("project:start", (event, dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }) =>
  workspaceOf(event.sender).startProject(dir, vendor, bedrock, models),
);
// A new project given up before it started: its folder, made for it and still empty, taken away again - that one alone.
ipcMain.handle("project:abandon", (event, dir: string) => {
  const workspace = workspaceOf(event.sender);
  if (workspace.made !== dir) return;
  workspace.made = undefined;
  try {
    rmdirSync(dir);
  } catch {
    /* something is in it now: it stays */
  }
});
ipcMain.handle("project:open", (event, dir: string) => openFrom(workspaceOf(event.sender), dir));
ipcMain.handle("project:recents", () => recents());
ipcMain.handle("projects:list", (event) => openProjects(workspaceOf(event.sender)));
// Another open project's window, brought forward.
ipcMain.handle("projects:switch", (_event, id: number) => {
  const workspace = workspaces.get(id);
  if (workspace === undefined) return;
  bringForward(workspace.window);
});
// A file of the window's project, shown in Finder or opened in its own app - nothing outside the project, whatever asks.
ipcMain.handle("shell:reveal", (event, path: string) => shell.showItemInFolder(inProject(workspaceOf(event.sender), path)));
ipcMain.handle("shell:open", (event, path: string) => shell.openPath(inProject(workspaceOf(event.sender), path)));
ipcMain.handle("preview:place", (event, rect: Rectangle | null) => workspaceOf(event.sender).preview.place(rect));
ipcMain.handle("preview:open", (event, url: string) => workspaceOf(event.sender).preview.open(url));
ipcMain.handle("preview:go", (event, action: "back" | "forward" | "reload" | "stop" | "devtools" | "focus") => workspaceOf(event.sender).preview.go(action));
ipcMain.handle("preview:state", (event) => workspaceOf(event.sender).preview.state());
ipcMain.handle("terminal:open", (event) => workspaceOf(event.sender).terminal.open());
ipcMain.handle("terminal:write", (event, data: string) => workspaceOf(event.sender).terminal.write(data));
ipcMain.handle("terminal:resize", (event, cols: number, rows: number) => workspaceOf(event.sender).terminal.resize(cols, rows));
ipcMain.handle("terminal:restart", (event) => workspaceOf(event.sender).terminal.restart());
// Which turri the app runs - worked out once: it does not change while the app runs.
const turri = turriVersion(ROOT, DEV ? process.env.TURRI_DEV : undefined);
ipcMain.handle("turri:version", () => turri);
ipcMain.handle("theme:get", () => theme);
ipcMain.handle("settings:get", () => allSettings());
ipcMain.handle("settings:set", (_event, next: Partial<ReturnType<typeof allSettings>>) => changeSettings(pickSettings(next)));
ipcMain.handle("updates:state", () => updates.state());
ipcMain.handle("updates:check", () => updates.check());
ipcMain.handle("updates:install", () => restartToUpdate());
// What the About sheet says: the versions the app is made of, and its third-party notices.
ipcMain.handle("about:info", () => ({
  app: app.getVersion(),
  turri,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  os: `${process.platform} ${process.arch}`,
}));
ipcMain.handle("about:notices", () => JSON.parse(readFileSync(join(__dirname, "notices.json"), "utf8")));
ipcMain.handle("about:chromium", () => shell.openPath(join(__dirname, "LICENSES.chromium.html")));
// macOS's command line developer tools - git among them - installed by Apple's own installer, which this opens.
ipcMain.handle("machine:developer-tools", () => {
  if (!MAC) return;
  spawn("xcode-select", ["--install"], { detached: true, stdio: "ignore" }).unref();
});
nativeTheme.on("updated", () => {
  for (const { window } of workspaces.values()) window.setBackgroundColor(backgroundFor());
});
// A native context menu: the window lists what it offers, and is told which was chosen.
// The window says whether its ***plain has changed since it was built, for Regenerate What Changed.
ipcMain.handle("menu:changed", (event, changed: boolean) => {
  const workspace = workspaceOf(event.sender);
  if (workspace.changed === (changed === true)) return;
  workspace.changed = changed === true;
  buildMenu();
});
ipcMain.handle("menu:popup", (event, items: Array<{ id: string; label: string; enabled?: boolean } | { type: "separator" }>) => {
  return new Promise<string | null>((resolve) => {
    let chosen: string | null = null;
    const menu = Menu.buildFromTemplate(
      items.map((item) => ("type" in item ? { type: "separator" as const } : { label: item.label, enabled: item.enabled !== false, click: () => (chosen = item.id) })),
    );
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)!, callback: () => resolve(chosen) });
  });
});

// A project from the Dock, Finder or the recent documents: in the window in front if it has none, a new one otherwise.
app.on("open-file", (event, path) => {
  event.preventDefault();
  void app.whenReady().then(() => deliver(openWhere(focused(), path)));
});

app.whenReady().then(() => {
  console.log(`turri ${turri.from === "npm" ? "from npm" : "from a clone"}: ${turri.label}${turri.warning ? ` - ${turri.warning}` : ""}`);
  app.setName("turri");
  if (HIDDEN) app.dock?.hide();
  // The bundle carries the icon once scripts/brand.mjs has run; the Dock is given it as well, for when it has not.
  app.dock?.setIcon(join(ROOT, "build", "icon.png"));
  // The Dock's menu lists the windows on its own; a new one is opened from it too.
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: "New Window", click: () => void createWorkspace() }]));
  nativeTheme.themeSource = theme;
  // The window's own page asks for nothing but the clipboard - its copy buttons, the terminal's paste: anything else a
  // page asks for - the camera, the microphone, where the machine is - is refused. The preview's pages have sessions of
  // their own.
  const CLIPBOARD = new Set(["clipboard-read", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, grant) => grant(CLIPBOARD.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => CLIPBOARD.has(permission));
  buildMenu();
  updates.start();
  const first = createWorkspace();
  // For development: TURRI_APP_OPEN opens a project at start, TURRI_APP_SCREENSHOT=<file.png> captures the window and quits.
  if (DEV) first.window.webContents.once("did-finish-load", async () => {
    if (process.env.TURRI_APP_OPEN) first.send("project:opened", await first.openProject(process.env.TURRI_APP_OPEN));
    if (process.env.TURRI_APP_SCREENSHOT) {
      // work: regen, in the dive.
      if (process.env.TURRI_APP_VIEW) setTimeout(() => first.send("menu", process.env.TURRI_APP_VIEW === "work" ? "dive" : `view:${process.env.TURRI_APP_VIEW}`), 300);
      setTimeout(async () => {
        writeFileSync(process.env.TURRI_APP_SCREENSHOT!, (await first.window.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500);
    }
  });
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWorkspace());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Quitting - ⌘Q, the menu, app.quit() - closes no window first, so each window's engine and terminal are stopped here -
// and the app ends once their shells are heard to exit: one heard while it quits aborts it (terminal.ts, shellsEnded).
// It ends with exit, not quit again: Electron does not start a quit over once will-quit was held back, and the app
// would stay running with nothing left in it.
app.on("will-quit", (event) => {
  for (const { terminal } of workspaces.values()) terminal.dispose();
  closeAll();
  event.preventDefault();
  void shellsEnded().then(() => app.exit(0));
});
