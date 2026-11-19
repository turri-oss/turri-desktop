import { spawn } from "node:child_process";
import { userInfo } from "node:os";

/**
 * The person's environment as their shell sets it up - the PATH with Homebrew, nvm and the rest, API keys exported in
 * ~/.zshrc, AWS_PROFILE - for an app opened from Finder, the Dock or a desktop launcher, which is given launchd's or
 * the desktop session's few variables instead: /usr/bin:/bin:/usr/sbin:/sbin, and no keys. turri's engines, its agents
 * and the testing scripts all run in it, so without it turri finds neither the toolchains nor the credentials the
 * person's terminal has.
 *
 * Started from a terminal - TERM is set - the app has a shell's environment already, and keeps it as it is: what was
 * set for this one run (TURRI_DEV=...) or turned on in that terminal (a virtualenv) stays.
 */

/** Marks around what `env` prints: whatever the shell's startup files print themselves is left outside them. */
const MARK = "__turri_shell_env__";
/** A shell whose startup files take longer than this, or wait for input, is given up on. */
const TIMEOUT = 10_000;
/** The shell's own bookkeeping, not the person's environment. */
const SKIPPED = new Set(["_", "PWD", "OLDPWD", "SHLVL", "TERM"]);

/** Read once, as the app starts: the engines wait for it. */
let loaded: Promise<void> | undefined;

/** Whether this launch needs the shell's environment: not from a terminal, not on Windows. TURRI_APP_SHELL_ENV=1 forces it. */
function wanted() {
  if (process.env.TURRI_APP_SHELL_ENV === "1") return true;
  return process.platform !== "win32" && process.env.TERM === undefined;
}

/** The environment the person's login shell sets up, or undefined when it could not be read. */
function read(): Promise<Record<string, string> | undefined> {
  const shell = process.env.SHELL || userInfo().shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  // Interactive and login, so ~/.zshrc and ~/.bashrc are read as well as the profile: that is where most people export
  // their PATH and keys. `command env -0` is the system's env, whatever the startup files define, its variables split by NUL.
  const script = `printf '%s' '${MARK}'; command env -0; printf '%s' '${MARK}'`;
  return new Promise((resolve) => {
    // Nothing on its stdin - a startup file reading from it would wait for ever - and killed outright on a timeout, as
    // an interactive shell ignores SIGTERM. oh-my-zsh asks to update itself at start unless told not to.
    const child = spawn(shell, ["-ilc", script], { stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT);
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    const done = (why?: string) => {
      clearTimeout(timer);
      const [, between] = stdout.split(MARK);
      if (between === undefined) {
        console.warn(`turri desktop: could not read the environment of ${shell}${why ? ` - ${why}` : ""}`);
        return resolve(undefined);
      }
      const env: Record<string, string> = {};
      for (const entry of between.split("\0")) {
        const at = entry.indexOf("=");
        if (at > 0 && !SKIPPED.has(entry.slice(0, at))) env[entry.slice(0, at)] = entry.slice(at + 1);
      }
      resolve(env);
    };
    child.on("error", (error) => done(error.message));
    child.on("close", (code, signal) => done(signal === "SIGKILL" ? `it took longer than ${TIMEOUT / 1000}s` : code !== 0 ? `it exited with ${code}` : undefined));
  });
}

/**
 * The shell's environment, made the app's: its PATH in place of launchd's, and every variable it sets that the app was
 * not given. What the app was given keeps its value. Nothing changes when the app was started from a terminal.
 */
export function loadShellEnvironment(): Promise<void> {
  loaded ??= wanted()
    ? read().then((shell) => {
        if (shell === undefined) return;
        for (const [name, value] of Object.entries(shell)) if (process.env[name] === undefined) process.env[name] = value;
        if (shell.PATH) process.env.PATH = shell.PATH;
      })
    : Promise.resolve();
  return loaded;
}
