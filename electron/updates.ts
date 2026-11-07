import { app } from "electron";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import electronUpdater from "electron-updater";

/**
 * The app's own updates, from its releases on GitHub (electron-builder.yml's publish): checked as it starts and every
 * few hours - unless the settings say only on asking - pre-releases too if they say so, downloaded on their own, and installed on a restart the person chooses - or when the app next quits. turri
 * comes with the app, pinned, so a new turri is a new app.
 *
 * Only as installed, and on macOS only when signed with a Developer ID: Squirrel.Mac takes an update only from the
 * same signer, and an app signed ad hoc has none. On Linux the AppImage and the .deb update themselves. An installed app
 * that cannot update itself still looks, as often, and says when a newer release is out (`available`), for the person
 * to download it.
 */
export type UpdateState =
  | { status: "off"; reason: string }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "available"; version: string; url: string; reason: string }
  | { status: "failed"; error: string };

const { autoUpdater } = electronUpdater;
const EVERY = 4 * 60 * 60 * 1000;
/** Its releases, as GitHub's API has them: where electron-builder.yml publishes them. */
const RELEASES = "https://api.github.com/repos/turri-oss/turri-desktop/releases";

/** Why this app cannot update itself, if it cannot. */
function cannotUpdate(): string | undefined {
  if (!app.isPackaged) return "run from source, the app is updated with git pull";
  if (process.platform !== "darwin") return undefined;
  // The bundle: turri.app, three folders up from Contents/MacOS/turri.
  const bundle = join(app.getPath("exe"), "..", "..", "..");
  const signed = spawnSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8" }).stderr ?? "";
  return /Authority=Developer ID Application/.test(signed) ? undefined : "this build is not signed with a Developer ID, which macOS needs to update it";
}

/** A version taken apart: its numbers, and its pre-release's identifiers - none for a release. */
function parts(version: string): { core: number[]; pre: string[] } {
  const plain = version.trim().replace(/^v/, "").split("+")[0]!;
  const dash = plain.indexOf("-");
  const core = (dash === -1 ? plain : plain.slice(0, dash)).split(".").map((each) => Number.parseInt(each, 10) || 0);
  return { core, pre: dash === -1 ? [] : plain.slice(dash + 1).split(".") };
}

/** Whether version `a` is newer than `b`, as semver orders them: a pre-release before its release. */
export function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(x.core.length, y.core.length); at++) {
    const [one, other] = [x.core[at] ?? 0, y.core[at] ?? 0];
    if (one !== other) return one > other;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === 0 && y.pre.length > 0;
  for (let at = 0; at < Math.max(x.pre.length, y.pre.length); at++) {
    const [one, other] = [x.pre[at], y.pre[at]];
    if (one === undefined || other === undefined) return one !== undefined;
    if (one === other) continue;
    const numeric = /^\d+$/.test(one) && /^\d+$/.test(other);
    return numeric ? Number(one) > Number(other) : /^\d+$/.test(other) || (!/^\d+$/.test(one) && one > other);
  }
  return false;
}

/** The newest release on GitHub - pre-releases too, if taken - when it is newer than this app: its version and page. */
async function newerRelease(prerelease: boolean): Promise<{ version: string; url: string } | undefined> {
  const response = await fetch(prerelease ? `${RELEASES}?per_page=20` : `${RELEASES}/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "turri-desktop" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const body = (await response.json()) as unknown;
  const releases = (Array.isArray(body) ? body : [body]) as Array<{ tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }>;
  const newest = releases
    .filter((release) => !release.draft && (prerelease || !release.prerelease) && typeof release.tag_name === "string")
    .sort((one, other) => (newer(one.tag_name!, other.tag_name!) ? -1 : newer(other.tag_name!, one.tag_name!) ? 1 : 0))[0];
  if (newest === undefined || !newer(newest.tag_name!, app.getVersion())) return undefined;
  return { version: newest.tag_name!.replace(/^v/, ""), url: newest.html_url ?? `https://github.com/turri-oss/turri-desktop/releases/tag/${newest.tag_name}` };
}

export function createUpdates({ onChange, prerelease, automatic }: { onChange: (state: UpdateState) => void; prerelease: boolean; automatic: boolean }) {
  const reason = cannotUpdate();
  // Installed, it cannot update itself - signed ad hoc, on macOS - but it looks all the same, to say when one is out.
  const looksOnly = reason !== undefined && app.isPackaged;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: UpdateState = reason === undefined ? { status: "idle" } : { status: "off", reason };
  const set = (next: UpdateState) => {
    state = next;
    onChange(state);
  };

  if (reason === undefined) {
    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = prerelease;
    autoUpdater.on("checking-for-update", () => state.status !== "ready" && set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => state.status !== "ready" && set({ status: "idle" }));
    autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (progress) => state.status === "downloading" && set({ ...state, percent: Math.round(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
    autoUpdater.on("error", (error) => state.status !== "ready" && set({ status: "failed", error: error.message }));
  }

  /**
   * Asks GitHub for a newer release; one found is downloaded on its own - or, here where it cannot be installed, said to
   * be out. A look that fails leaves it as it was: it is said only when asked (Check for Updates…).
   */
  async function check(): Promise<UpdateState> {
    if (looksOnly) {
      try {
        const found = await newerRelease(prerelease);
        if (found !== undefined) set({ status: "available", ...found, reason: reason! });
      } catch {
        /* not reached, or GitHub said no: looked at again later */
      }
      return state;
    }
    if (state.status === "off" || state.status === "ready" || state.status === "downloading") return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      set({ status: "failed", error: (error as Error).message });
    }
    return state;
  }

  return {
    state: () => state,
    check,
    /**
     * Checks now - a while after the app starts, so opening a project comes first - and every few hours after, unless the
     * person turned that off: then only on asking (Check for Updates…).
     */
    start() {
      if ((state.status === "off" && !looksOnly) || !automatic || timer !== undefined) return;
      setTimeout(() => automatic && void check(), 10_000);
      timer = setInterval(() => automatic && void check(), EVERY);
    },
    /** The settings changed: pre-releases taken or not, and the checks on their own started or stopped. */
    configure(next: { prerelease: boolean; automatic: boolean }) {
      if (state.status === "off" && !looksOnly) return;
      prerelease = next.prerelease;
      if (!looksOnly) autoUpdater.allowPrerelease = next.prerelease;
      automatic = next.automatic;
      if (!automatic && timer !== undefined) (clearInterval(timer), (timer = undefined));
      else if (automatic && timer === undefined) timer = setInterval(() => void check(), EVERY);
    },
    /** Quits, installs the update downloaded, and starts again. */
    install() {
      if (state.status === "ready") autoUpdater.quitAndInstall();
    },
  };
}
