import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The app's own settings, beyond its look (appearance.json): the models a new project starts on, where it is made, and
 * how the app updates itself. Kept in settings.json in the app's userData; what a project runs on is its
 * config.turri.yaml's.
 */
export interface Settings {
  /** The vendor the new-project sheet starts on - one of turri's, as `turri init-config` offers them - or none. */
  vendor: string | null;
  /** Whether the app looks for its updates on its own, as it starts and every few hours. */
  checkUpdates: boolean;
  /** Whether a pre-release - a release marked so on GitHub - is an update too. */
  prerelease: boolean;
  /** The folder the last new project was made in: the next one's save sheet starts there. The app's to set, not the window's. */
  newProjectsIn: string | null;
}

const FILE = join(app.getPath("userData"), "settings.json");
const DEFAULTS: Settings = { vendor: null, checkUpdates: true, prerelease: false, newProjectsIn: null };

export function readSettings(): Settings {
  try {
    const saved = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Settings>;
    return {
      vendor: typeof saved.vendor === "string" ? saved.vendor : DEFAULTS.vendor,
      checkUpdates: typeof saved.checkUpdates === "boolean" ? saved.checkUpdates : DEFAULTS.checkUpdates,
      prerelease: typeof saved.prerelease === "boolean" ? saved.prerelease : DEFAULTS.prerelease,
      newProjectsIn: typeof saved.newProjectsIn === "string" ? saved.newProjectsIn : DEFAULTS.newProjectsIn,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(settings: Settings) {
  writeFileSync(FILE, JSON.stringify(settings));
}
