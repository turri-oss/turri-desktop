import headless from "@xterm/headless";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { userInfo } from "node:os";
import { basename } from "node:path";
import { BUTTONS, createModes, findText, keyBytes, modifierBits, MOVED, mouseEvent, screenCells, screenText, WHEEL, type Cell, type Key, type Modifier } from "./terminal-input.ts";

/**
 * The preview's terminal: a shell in the project's folder, on a pty of its own, for a CLI turri builds - run, typed
 * into and read as a person would. The window draws it (src/Terminal.tsx, xterm.js) from what it is sent; a headless
 * xterm here keeps the same screen, so what turri reads is what the person sees, cursor moves and all. turri's terminal
 * tools (engine/terminal.mjs) are requests the engine sends here, done in the shell the person is looking at.
 */

export interface TerminalState {
  /** Whether a shell runs - it ended when the person typed exit, say. */
  running: boolean;
  /** What runs in it now: the shell itself at its prompt, or the program in the foreground. */
  program: string;
}

/** What the window replays when it draws the terminal again - another view and back: the newest output, raw. */
const REPLAY_KEPT = 512 * 1024;
/** The lines the headless screen keeps above what shows: what turri can read back of a long output. */
const SCROLLBACK = 5000;
/** The most of a terminal's text a tool gives: the end of it, a long output cut at its start. */
const TEXT_KEPT = 20000;
/** Output quiet for this long, with the shell back at its prompt: the command is done. */
const SETTLED_MS = 300;
/** Output quiet for this long, with a program still running: it waits - for input, or as a server does. */
const WAITING_MS = 1500;

/**
 * Shells killed and not yet heard to exit. node-pty tells of a shell's exit through a callback into JavaScript: one that
 * comes while the app is quitting - Node's environment being torn down - throws in native code, and the app aborts, as
 * macOS then says. So quitting waits for them (shellsEnded).
 */
const ending = new Set<Promise<void>>();

/** Every shell killed, heard to exit: a hung one killed outright after a second, and given up on after another. */
export async function shellsEnded(): Promise<void> {
  const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  await Promise.race([Promise.all(ending), timeout(2000)]);
}

/** Between the two clicks of a double click, and between turns of the wheel. */
const DOUBLE_CLICK_MS = 50;
const WHEEL_MS = 20;
/** After escape, or alt and a key, before the next: sooner, the program reads the two as alt and that key. */
const AFTER_ESCAPE_MS = 100;

// @xterm/headless is CommonJS: Node, as the tests load this, takes only its default export.
const { Terminal: Screen } = headless;
type Screen = InstanceType<typeof Screen>;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value: number | undefined, fallback: number, low: number, high: number) => Math.min(Math.max(Math.round(value ?? fallback), low), high);

/** A screenshot of the terminal, as the window draws it: the image, or null while the window does not show it. */
export type Capture = () => Promise<{ data: string; mimeType: string } | null>;

/**
 * The terminal of a window. `capture` is the window's pixels over it, for terminal_screenshot. `spawn` and `shell` are
 * node-pty's and the person's login shell - a test gives a pty of its own, and the name of the shell it says is in the
 * foreground at its prompt.
 */
export function createTerminal({ send, capture, spawn = ptySpawn, shell: given }: { send: (channel: string, data: unknown) => void; capture?: Capture; spawn?: typeof ptySpawn; shell?: string }) {
  let dir: string | undefined;
  let pty: IPty | undefined;
  let screen: Screen | undefined;
  let replay = "";
  let lastOutput = 0;
  let size = { cols: 100, rows: 30 };
  /** The modes what runs has turned on - mouse reporting, application cursor keys - and the program that did. */
  const modes = createModes();
  let modesOf = "";
  const shell = given ?? (process.env.SHELL || userInfo().shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"));

  const state = (): TerminalState => ({ running: pty !== undefined, program: pty === undefined ? "" : foreground() });
  const tell = () => send("terminal:state", state());
  /** The program in the foreground - the shell's own name while it waits at its prompt. */
  const foreground = () => {
    try {
      return pty?.process ?? "";
    } catch {
      return "";
    }
  };
  // The shell itself in the foreground: at its prompt. node-pty names it as the system does - `zsh`, its path
  // (`/bin/zsh`), or, a login shell, `-zsh` - so it is the name that is compared.
  const atPrompt = () => basename(foreground()).replace(/^-/, "") === basename(shell);

  /** The shell, started in the project's folder: a login shell, so a packaged app has the person's PATH too. */
  function start(): IPty {
    if (pty !== undefined) return pty;
    if (dir === undefined) throw new Error("No project is open.");
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "turri" } as Record<string, string>;
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    const started = spawn(shell, ["-l"], { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: dir, env });
    pty = started;
    modes.reset();
    screen = new Screen({ cols: size.cols, rows: size.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    started.onData((data) => {
      if (pty !== started) return;
      lastOutput = Date.now();
      if (modes.hear(data)) modesOf = foreground();
      screen?.write(data);
      replay = (replay + data).slice(-REPLAY_KEPT);
      send("terminal:data", data);
    });
    // What runs in it, for the window's bar: a program started or ended says nothing of it, so it is looked at.
    let said = "";
    const watch = setInterval(() => {
      const now = foreground();
      if (now !== said) (said = now), tell();
    }, 1000);
    started.onExit(() => {
      clearInterval(watch);
      if (pty !== started) return;
      pty = undefined;
      const ended = "\r\n[the shell ended - type to start another]\r\n";
      replay += ended;
      send("terminal:data", ended);
      tell();
    });
    tell();
    return started;
  }

  /** A project opened: the shell of the last one is ended, and the next starts in this one's folder. */
  function setDir(next: string | undefined) {
    dispose();
    dir = next;
  }

  function dispose() {
    const ended = pty;
    pty = undefined;
    if (ended !== undefined) {
      const exited = new Promise<void>((resolve) => {
        // One that does not end on the hangup is killed outright.
        const hard = setTimeout(() => {
          try {
            ended.kill("SIGKILL");
          } catch {
            resolve();
          }
        }, 1000);
        hard.unref();
        ended.onExit(() => {
          clearTimeout(hard);
          resolve();
        });
      });
      ending.add(exited);
      void exited.then(() => ending.delete(exited));
      ended.kill();
    }
    screen?.dispose();
    screen = undefined;
    replay = "";
    send("terminal:reset", null);
    tell();
  }

  /** A new shell, the old one ended: what the window's restart does. */
  function restart() {
    dispose();
    start();
  }

  // ---------- what the window does with it ----------

  /** What the person types, as xterm.js sends it. */
  function write(data: string) {
    start().write(data);
  }

  function resize(cols: number, rows: number) {
    if (cols < 2 || rows < 2) return;
    size = { cols, rows };
    pty?.resize(cols, rows);
    screen?.resize(cols, rows);
  }

  /** What the window draws when it opens the terminal: the shell started, and what it has said so far. */
  function open() {
    start();
    return { replay, ...state() };
  }

  // ---------- what turri asks of it ----------

  /** The text of the screen and what scrolled above it, from a line on - all of it, by default - its end kept. */
  async function text(from = 0): Promise<string> {
    if (screen === undefined) return "";
    // What was written is parsed in its own time: until it has been, the screen is behind.
    await new Promise<void>((resolve) => screen!.write("", resolve));
    const buffer = screen.buffer.active;
    const lines: string[] = [];
    for (let row = Math.max(0, from); row < buffer.length; row++) {
      const line = buffer.getLine(row);
      if (line === undefined) continue;
      // A wrapped line goes on the one before it, as one.
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += line.translateToString(true);
      else lines.push(line.translateToString(true));
    }
    const said = lines.join("\n").replace(/\n+$/, "");
    return said.length > TEXT_KEPT ? `[... the start cut, ${said.length - TEXT_KEPT} characters]\n${said.slice(-TEXT_KEPT)}` : said;
  }

  /** Until what the shell was sent has had its answer: back at its prompt, or quiet while a program waits, or out of time. */
  async function settle(seconds: number) {
    const began = Date.now();
    const until = began + seconds * 1000;
    // A moment for the shell to start on it, and for a program to take the foreground.
    await new Promise((resolve) => setTimeout(resolve, 150));
    while (Date.now() < until && pty !== undefined) {
      const quiet = Date.now() - lastOutput;
      if (quiet >= SETTLED_MS && atPrompt()) break;
      if (quiet >= WAITING_MS && !atPrompt()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** What came of it: the terminal's text since the line it began on, and what runs now. */
  async function outcome(marker: { line: number; isDisposed: boolean } | undefined) {
    const from = marker === undefined || marker.isDisposed ? 0 : marker.line;
    const program = pty === undefined ? "" : foreground();
    return { text: await text(from), running: pty !== undefined, program, atPrompt: pty !== undefined && atPrompt() };
  }

  /**
   * The window told turri works in the terminal, to say so - the preview glows - never brought to it: what turri does
   * there runs whether the person looks or not, and they come to watch if they like.
   */
  const reveal = () => send("terminal:reveal", null);

  /** The screen as parsed so far: what was written is parsed in its own time, and until it has been the screen is behind. */
  async function parsed(): Promise<Screen> {
    if (screen === undefined) throw new Error("Nothing has run in the terminal yet: run something with terminal_run.");
    await new Promise<void>((resolve) => screen!.write("", resolve));
    return screen;
  }

  /** What came of a click or a turn of the wheel: the screen as it shows now, and what runs. */
  async function shown() {
    const now = await parsed();
    return { text: screenText(now.buffer.active, now.rows), running: pty !== undefined, program: foreground(), atPrompt: pty !== undefined && atPrompt() };
  }

  /** The modes of what runs now: those another program turned on - one that has ended, the shell's own - are put back. */
  function modesNow() {
    if (pty === undefined || atPrompt() || foreground() !== modesOf) modes.reset();
    return modes;
  }

  /** The bytes of keys as terminal_press names them, all of them known before any is pressed. */
  const keysOf = (names: string[]): Key[] => names.map((name) => keyBytes(name, { applicationCursor: modesNow().applicationCursor }));

  /** What it sends the same as, for each key the terminal cannot tell from another. */
  const sameAs = (keys: Key[]) =>
    [...new Map(keys.filter((key) => key.same !== undefined).map((key) => [key.name, key.same])).entries()].map(([name, same]) => ` ${name} sends the same as ${same} in this terminal.`).join("");

  /** The program in the foreground, if it takes the mouse: how it wants its events written. */
  function mouseTaker() {
    if (pty === undefined || atPrompt()) throw new Error("Nothing in the terminal takes the mouse: the shell is at its prompt. Run the program with terminal_run first.");
    const now = modesNow();
    if (now.tracking === "none") throw new Error(`${foreground()} has not turned on mouse reporting, so it takes no clicks or wheel: use terminal_press and terminal_type instead.`);
    return { tracking: now.tracking, encoding: now.encoding };
  }

  interface Where {
    text?: string;
    occurrence?: number;
    row?: number;
    column?: number;
  }

  /** The cell a click or the wheel is at - by text the screen shows, or by row and column - and how to say it. */
  async function locate({ text: shows, occurrence, row, column }: Where, middle: boolean): Promise<Cell & { said: string }> {
    const now = await parsed();
    const { rows, cols } = now;
    const byText = shows !== undefined && shows !== "";
    const byCell = row !== undefined || column !== undefined;
    if (byText && byCell) throw new Error("Say where by text, or by row and column - not both.");
    if (byCell) {
      if (row === undefined || column === undefined) throw new Error("Say both the row and the column, 1 at the top left.");
      if (row < 1 || column < 1 || row > rows || column > cols) throw new Error(`Row ${row}, column ${column} is off the screen: it is ${rows} rows by ${cols} columns, 1 at the top left.`);
      return { row, column, said: `at row ${row}, column ${column}` };
    }
    if (!byText) {
      if (!middle) throw new Error("Say where: text the screen shows, or a row and a column.");
      const centre = { row: Math.ceil(rows / 2), column: Math.ceil(cols / 2) };
      return { ...centre, said: `at row ${centre.row}, column ${centre.column}` };
    }
    const found = findText(now.buffer.active, rows, shows);
    if (found.length === 0) throw new Error(`\`${shows}\` is not on the screen. It shows:\n\n${screenText(now.buffer.active, rows)}`);
    const nth = Math.max(1, Math.round(occurrence ?? 1));
    if (nth > found.length) {
      const each = found.map((cell) => `row ${cell.row}, column ${cell.column}`).join("; ");
      throw new Error(`\`${shows}\` shows ${found.length === 1 ? "once" : `${found.length} times`} on the screen, not ${nth}: ${each}.`);
    }
    const cell = found[nth - 1]!;
    return { ...cell, said: `\`${shows}\`${found.length > 1 ? ` (${nth} of ${found.length})` : ""} at row ${cell.row}, column ${cell.column}` };
  }

  /** The window marks the cell a click or the wheel is at, a moment: the person sees where. */
  const point = (cell: Cell, kind: "click" | "scroll") => send("terminal:pointer", { row: cell.row, column: cell.column, kind });

  const actions: Record<string, (params: any) => Promise<unknown>> = {
    run: async ({ command, wait }: { command: string; wait?: number }) => {
      const shellNow = start();
      reveal();
      if (!atPrompt()) throw new Error(`${foreground()} is running in the terminal: stop it first (terminal_press with ctrl+c), or answer it with terminal_type.`);
      const marker = screen?.registerMarker(0);
      shellNow.write(`${command}\r`);
      await settle(Math.min(Math.max(wait ?? 15, 1), 300));
      const result = await outcome(marker);
      marker?.dispose();
      return result;
    },
    type: async ({ text: typed, key, delay, wait }: { text?: string; key?: string; delay?: number; wait?: number }) => {
      if (!typed && !key) throw new Error("Say what to type: text, a key, or both.");
      const shellNow = start();
      const pressed = key !== undefined ? keysOf([key])[0]! : undefined;
      reveal();
      const marker = screen?.registerMarker(0);
      const between = clamp(delay, 0, 0, 200);
      if (typed && between > 0) {
        // A character at a time - a whole one, never half of an emoji or a letter without its accent.
        for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(typed)) {
          if (pty !== shellNow) break;
          shellNow.write(segment);
          await pause(between);
        }
        if (pressed !== undefined && pty === shellNow) shellNow.write(pressed.bytes);
      } else shellNow.write(`${typed ?? ""}${pressed?.bytes ?? ""}`);
      await settle(Math.min(Math.max(wait ?? 5, 1), 300));
      const result = await outcome(marker);
      marker?.dispose();
      return pressed?.same !== undefined ? { ...result, did: sameAs([pressed]).trim() } : result;
    },
    press: async ({ keys, repeat, delay, wait }: { keys: string[]; repeat?: number; delay?: number; wait?: number }) => {
      if (!Array.isArray(keys) || keys.length === 0) throw new Error("Say which keys to press: ctrl+q, shift+tab, f5.");
      const shellNow = start();
      const pressed = keysOf(keys);
      const times = clamp(repeat, 1, 1, 100);
      const between = clamp(delay, 30, 0, 1000);
      reveal();
      const marker = screen?.registerMarker(0);
      const all = Array.from({ length: times }, () => pressed).flat();
      for (const [index, key] of all.entries()) {
        if (pty !== shellNow) break;
        shellNow.write(key.bytes);
        if (index < all.length - 1) await pause(key.escapes ? Math.max(between, AFTER_ESCAPE_MS) : between);
      }
      await settle(Math.min(Math.max(wait ?? 5, 1), 300));
      const result = await outcome(marker);
      marker?.dispose();
      const did = `Pressed ${pressed.map((key) => key.name).join(", ")}${times > 1 ? ` - ${times} times` : ""}.${sameAs(pressed)}`;
      return { ...result, did };
    },
    click: async ({ button = "left", double, modifiers = [], wait, ...where }: Where & { button?: keyof typeof BUTTONS; double?: boolean; modifiers?: Modifier[]; wait?: number }) => {
      const { tracking, encoding } = mouseTaker();
      if (BUTTONS[button] === undefined) throw new Error(`No such button: ${button}. It is left, middle or right.`);
      const cell = await locate(where, false);
      const shellNow = pty!;
      reveal();
      point(cell, "click");
      const held = modifierBits(modifiers);
      const at = (code: number, release = false) => mouseEvent(encoding, code, cell.column, cell.row, release);
      // Many programs - Textual among them - act on a click only where the pointer is: it is moved there first.
      if (tracking === "drag" || tracking === "any") {
        shellNow.write(at(MOVED | held));
        await pause(WHEEL_MS);
      }
      const code = BUTTONS[button] | held;
      for (let click = 0; click < (double === true ? 2 : 1); click++) {
        if (click > 0) await pause(DOUBLE_CLICK_MS);
        shellNow.write(at(code) + at(code, true));
      }
      await settle(Math.min(Math.max(wait ?? 5, 1), 300));
      const how = `${double === true ? "Double-clicked" : "Clicked"}${button !== "left" ? ` with the ${button} button` : ""}${modifiers.length > 0 ? `, holding ${modifiers.join("+")},` : ""}`;
      return { ...(await shown()), did: `${how} ${cell.said}.` };
    },
    scroll: async ({ direction, amount, wait, ...where }: Where & { direction: keyof typeof WHEEL; amount?: number; wait?: number }) => {
      const { tracking, encoding } = mouseTaker();
      if (WHEEL[direction] === undefined) throw new Error(`No such direction: ${direction}. It is up, down, left or right.`);
      const cell = await locate(where, true);
      const shellNow = pty!;
      const steps = clamp(amount, 3, 1, 50);
      reveal();
      point(cell, "scroll");
      if (tracking === "drag" || tracking === "any") {
        shellNow.write(mouseEvent(encoding, MOVED, cell.column, cell.row));
        await pause(WHEEL_MS);
      }
      for (let step = 0; step < steps && pty === shellNow; step++) {
        if (step > 0) await pause(WHEEL_MS);
        shellNow.write(mouseEvent(encoding, WHEEL[direction], cell.column, cell.row));
      }
      await settle(Math.min(Math.max(wait ?? 5, 1), 300));
      return { ...(await shown()), did: `Scrolled ${direction} ${steps} ${cell.said.startsWith("at ") ? cell.said : `over ${cell.said}`}.` };
    },
    screenshot: async () => {
      if (pty === undefined && replay === "") throw new Error("Nothing has run in the terminal yet: run something with terminal_run.");
      if (capture === undefined) throw new Error("The terminal cannot be seen here.");
      reveal();
      // What the shell said, parsed, and a moment for the window to draw it - where the person has it in view: it is
      // the window's own pixels, and the window is not brought to it.
      const now = await parsed();
      await pause(250);
      const shot = await capture();
      if (shot === null)
        throw new Error("The person is not looking at the terminal, so it cannot be pictured now - the window is not brought to it for you. Read what it shows with terminal_read (cells: true) instead.");
      return { ...shot, rows: now.rows, cols: now.cols, running: pty !== undefined, program: foreground(), atPrompt: pty !== undefined && atPrompt() };
    },
    read: async ({ cells }: { cells?: boolean }) => {
      if (pty === undefined && replay === "") throw new Error("Nothing has run in the terminal yet: run something with terminal_run.");
      reveal();
      if (cells !== true) return outcome(undefined);
      const now = await parsed();
      return { ...(await outcome(undefined)), text: screenCells(now.buffer.active, now.rows, now.cols) };
    },
  };

  function request(action: string, params: unknown): Promise<unknown> {
    const run = actions[action];
    if (run === undefined) return Promise.reject(new Error(`No such terminal action: ${action}`));
    return run(params ?? {});
  }

  return { setDir, dispose, restart, write, resize, open, state, request };
}
