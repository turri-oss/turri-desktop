import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { PreviewState } from "./preview.ts";
import type { Settings } from "./settings.ts";
import type { TerminalState } from "./terminal.ts";
import type { TurriVersion } from "./turri-version.ts";
import type { UpdateState } from "./updates.ts";

/** The settings sheet's: the look - appearance.json's - and the rest, settings.json's. */
export type AppSettings = Settings & { theme: "dark" | "light" | "system"; zoom: number };

/** A file attached to a message in the chat: where it is, and - for an image - its bytes, to go to the model as one. */
export interface Attached {
  name: string;
  path: string;
  image?: { mimeType: string; data: string };
}

/** A package or font the app carries, and its licence. */
export interface Notice {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  /** Its licence files' text, if it has any. */
  text: string;
}

/** One of turri doctor's checks, as turri's host entry gives it. */
export interface Check {
  level: "ok" | "missing" | "limited" | "info";
  name: string;
  detail: string;
  /** More about it, a line each. */
  more?: string[];
  /** What to run or do about it. */
  fix?: string;
}

/** A model provider as the sign-in sheet lists it: how it can be signed in to, and whether and how it is connected now. */
export interface AuthProvider {
  id: string;
  name: string;
  /** Its sign-in in the browser is a subscription's: Claude Pro/Max, ChatGPT, GitHub Copilot. */
  subscription: boolean;
  oauth: { name: string; label: string | null } | null;
  /** Not interactive: configured outside turri only - an AWS profile, a credentials file. */
  apiKey: { name: string; interactive: boolean } | null;
  connected: boolean;
  how: "oauth" | "api_key" | null;
  /** Where its credential comes from: stored by a sign-in, the environment (`label` names the variable), models.json. */
  source: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command" | null;
  label: string | null;
  /** What a sign-in stored for it, which signing out removes. */
  stored: "oauth" | "api_key" | null;
  /** The project's models are its. */
  project: boolean;
}

/** What pi asks during a sign-in, and what it says - pi's AuthPrompt and AuthEvent. */
export type AuthPrompt =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: Array<{ id: string; label: string; description?: string }> };
export type AuthEvent =
  | { type: "info"; message: string; links?: Array<{ url: string; label?: string }> }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "progress"; message: string };

const authCall = <T>(method: string, params?: unknown) => ipcRenderer.invoke("auth:call", method, params) as Promise<T>;

/**
 * What the window may ask of the app: the engine's methods, a few native services, and the events it is sent. The window
 * is sandboxed, so this is all of it: each a message to the main process, which checks what it is given - a path in the
 * window's project, a sign-in method, a setting there is.
 */
const api = {
  call: <T>(method: string, params?: unknown) => ipcRenderer.invoke("engine:call", method, params) as Promise<T>,
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  newProject: () => ipcRenderer.invoke("project:new") as Promise<string | null>,
  vendors: () => ipcRenderer.invoke("project:vendors"),
  /** turri doctor's checks - this machine's, and the open project's or the one named - from the engine; null from a turri without them. */
  doctor: (models = false, dir?: string) => ipcRenderer.invoke("doctor:run", models, dir) as Promise<Check[] | null>,
  /**
   * Signing in to the model providers, through the window's engine - started for it before a project is open. A sign-in
   * goes on in events: engine:auth:prompt, engine:auth:event, engine:auth:withdrawn and engine:auth:done.
   */
  auth: {
    providers: (dir?: string) => authCall<{ kept: string; providers: AuthProvider[] }>("authProviders", dir !== undefined ? { dir } : {}),
    login: (provider: string, method: "oauth" | "api_key") => authCall<{ login: number }>("authLogin", { provider, method }),
    /** A prompt answered - null cancels the sign-in. */
    answer: (id: number, value: string | null) => authCall<boolean>("authAnswer", { id, value }),
    cancel: (login: number) => authCall<boolean>("authCancel", { login }),
    logout: (provider: string) => authCall<boolean>("authLogout", { provider }),
  },
  /** A new project started on a vendor's models - on Bedrock, the maker and geography chosen, and the two models picked there. */
  startProject: (dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }) =>
    ipcRenderer.invoke("project:start", dir, vendor, bedrock, models),
  abandonProject: (dir: string) => ipcRenderer.invoke("project:abandon", dir),
  openProject: (dir: string) => ipcRenderer.invoke("project:open", dir),
  recents: () => ipcRenderer.invoke("project:recents") as Promise<string[]>,
  /** The projects open in every window, the one last in front first; and one of their windows brought forward. */
  openProjects: () => ipcRenderer.invoke("projects:list") as Promise<Array<{ id: number; name: string; dir: string; running: number; here: boolean }>>,
  switchProject: (id: number) => ipcRenderer.invoke("projects:switch", id),
  /** Files to attach to a message, chosen in the open sheet: an image's bytes with it. */
  attach: () => ipcRenderer.invoke("chat:attach") as Promise<Attached[]>,
  /**
   * A folder chosen in the system's sheet, by its path from `root` - the project's folder, or a new one's: a base folder,
   * the test folder. Refused, why; cancelled, null.
   */
  pickFolder: (root: string) => ipcRenderer.invoke("folder:pick", root) as Promise<{ path: string } | { refused: string } | null>,
  /** Where a file dropped or pasted into the window is on disk - "" for one that is not a file there, as a pasted image. */
  pathOf: (file: File) => webUtils.getPathForFile(file),
  reveal: (path: string) => ipcRenderer.invoke("shell:reveal", path),
  openPath: (path: string) => ipcRenderer.invoke("shell:open", path),
  /** Whether the ***plain open has changed since it was built: Regenerate What Changed is offered only then. */
  changed: (changed: boolean) => ipcRenderer.invoke("menu:changed", changed),
  popup: (items: Array<{ id: string; label: string; enabled?: boolean } | { type: "separator" }>) => ipcRenderer.invoke("menu:popup", items) as Promise<string | null>,
  on: (channel: string, listener: (data: any) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.off(channel, handler);
  },
  /** The preview pane: laid over a rectangle of the window, sent to an address, and moved about in. */
  preview: {
    place: (rect: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.invoke("preview:place", rect),
    open: (url: string) => ipcRenderer.invoke("preview:open", url),
    go: (action: "back" | "forward" | "reload" | "stop" | "devtools" | "focus") => ipcRenderer.invoke("preview:go", action),
    state: () => ipcRenderer.invoke("preview:state") as Promise<PreviewState>,
  },
  /** The preview's terminal: a shell in the project's folder - opened with what it has said so far, typed into, sized. */
  terminal: {
    open: () => ipcRenderer.invoke("terminal:open") as Promise<TerminalState & { replay: string }>,
    write: (data: string) => ipcRenderer.invoke("terminal:write", data),
    resize: (cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", cols, rows),
    restart: () => ipcRenderer.invoke("terminal:restart"),
  },
  /** The app's settings: read, and changed - only what is named. Every window is sent them as they change ("settings"). */
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    set: (next: Partial<AppSettings>) => ipcRenderer.invoke("settings:set", next) as Promise<AppSettings>,
  },
  /** The app's own updates: where they are, checked now, and restarted into once one is ready ("updates" as it changes). */
  updates: {
    state: () => ipcRenderer.invoke("updates:state") as Promise<UpdateState>,
    check: () => ipcRenderer.invoke("updates:check") as Promise<UpdateState>,
    install: () => ipcRenderer.invoke("updates:install"),
  },
  /** The About sheet's: the versions the app is made of, its third-party notices, and Chromium's, opened. */
  about: {
    info: () => ipcRenderer.invoke("about:info") as Promise<{ app: string; turri: TurriVersion; electron: string; chromium: string; node: string; os: string }>,
    notices: () => ipcRenderer.invoke("about:notices") as Promise<{ packages: Notice[] }>,
    chromium: () => ipcRenderer.invoke("about:chromium"),
  },
  /** macOS's command line developer tools - git with them - installed by Apple's installer, which this opens. */
  installDeveloperTools: () => ipcRenderer.invoke("machine:developer-tools"),
  /** Which turri the app runs: from npm, or a clone's sources - and anything to do about it. */
  turriVersion: () => ipcRenderer.invoke("turri:version") as Promise<TurriVersion>,
  theme: () => ipcRenderer.invoke("theme:get") as Promise<"dark" | "light" | "system">,
  platform: process.platform,
};

contextBridge.exposeInMainWorld("turri", api);

export type TurriApi = typeof api;
