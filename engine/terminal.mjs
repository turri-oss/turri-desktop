// turri's hands on a CLI it builds: terminal tools for the chat's agent, on the preview's terminal - a shell in the
// project's folder the person is looking at. A pi extension of the app's own, loaded beside turri's and the browser
// tools: each tool is a request to the main process, which runs the shell (electron/terminal.ts). They exist only in the
// app. turri's own bash tool is for its work; these are for trying what it built where the person watches.

import { seesOf } from "./browser.mjs";

/** The terminal tools - `terminalTools`, given every chat and the sentinel's. */
export function terminalExtension(tools) {
  return (pi) => {
    for (const tool of tools) pi.registerTool(tool);
  };
}

/** How terminal_press and terminal_type name a key: electron/terminal-input.ts has the bytes for each. */
const KEY = "a key with its modifiers joined by +: ctrl+q, shift+tab, ctrl+shift+up, f1, enter, a";

const GUIDELINES = [
  "The terminal_* tools drive the terminal in the person's preview view - a shell in the project's folder - and the person watches what you do there.",
  "Use them to try what you built as the person would: run a CLI with the arguments the ***plain gives it, answer its prompts, read what it prints. For your own work - building, installing, tests - use bash as usual.",
  "terminal_run returns once the command is back at the prompt, or once it has gone quiet while still running - waiting for input, or serving: say so, and answer it with terminal_type, or stop it with terminal_press ctrl+c.",
  "terminal_press is for keys and key combinations - ctrl+q to quit a Textual app, shift+tab back, f-keys, pageup; terminal_type for text.",
  "A terminal UI that takes the mouse - a Textual or curses app - is tried as a person would, with the mouse too: click its buttons and icons with terminal_click, scroll its lists and panes with terminal_scroll. A plain CLI takes no mouse: type and press keys.",
  "Prefer terminal_read to terminal_screenshot: it is text, and costs less. Take a screenshot when how it looks matters - a terminal UI's colours, borders and layout, what is highlighted.",
  "terminal_click and terminal_scroll find a piece of text on the screen; to aim at a cell instead, terminal_read with cells numbers the screen's rows and columns.",
  "A server started there runs on in the person's terminal: to try it in the browser too, run it with terminal_run, then open it with browser_navigate.",
];

/**
 * Tools on the preview's terminal, each sent as `request(action, params)` and answered with what came of it. A command
 * line typed at the shell's prompt - with terminal_type, or entered with terminal_press - is checked as turri checks a
 * command it runs (`machineChange`, from turri's host entry, where it has it): one that would install something or change
 * the machine's settings is refused, nothing typed - turri installs nothing. What is typed into a program that runs -
 * answering its prompt, a terminal UI - is not a command line, and is not checked.
 */
export function terminalTools(request, { machineChange, machineChangeReason } = {}) {
  const checks = typeof machineChange === "function" && typeof machineChangeReason === "function";
  /** What turri typed at the prompt and has not entered yet: the start of a command line. */
  let line = "";
  const atPrompt = async () => {
    try {
      return (await request("state", {})).atPrompt === true;
    } catch {
      return false;
    }
  };
  /** The refusal of the first of these command lines that would change the machine, if one would. */
  const refusalOf = (lines) => {
    for (const each of lines) {
      const why = each.trim() === "" ? undefined : machineChange(each);
      if (why !== undefined) return machineChangeReason(why);
    }
    return undefined;
  };
  const ENTER = new Set(["enter", "return"]);
  /** Keys that put away what was typed at the prompt. */
  const CLEARS = new Set(["ctrl+c", "ctrl+u", "ctrl+g"]);
  const text = (value) => ({ type: "text", text: value });
  /** What the terminal shows since the command, and whether something still runs in it. */
  const said = (result) => {
    const now = !result.running ? "The shell has ended: the next command starts a new one." : result.atPrompt ? "Back at the prompt." : `Still running: ${result.program} - waiting for input, or serving. Answer it with terminal_type, or stop it with terminal_press ctrl+c.`;
    return `${result.did ? `${result.did}\n\n` : ""}${result.text || "(nothing printed)"}\n\n[${now}]`;
  };
  const answer = async (action, params) => ({ content: [text(said(await request(action, params)))], details: undefined });
  const WAIT = { type: "integer", description: "The most seconds to wait for it to finish or go quiet." };
  const SETTLE = { type: "integer", description: "The most seconds to wait for it to settle. 5 unless said." };
  /** Where on the screen: a piece of text it shows, or a cell. */
  const WHERE = {
    text: { type: "string", description: "Text the screen shows, to click on its middle - a button's label, an icon." },
    occurrence: { type: "integer", minimum: 1, description: "Which one, counted from the top left, when the text shows more than once. 1 unless said." },
    row: { type: "integer", minimum: 1, description: "A cell of the screen, 1 at the top left - instead of text." },
    column: { type: "integer", minimum: 1, description: "A cell of the screen, 1 at the top left - instead of text." },
  };
  /** Exactly one way of saying where: text, or a row and a column. */
  const where = ({ text: shows, occurrence, row, column }, needed) => {
    const byCell = row !== undefined || column !== undefined;
    if (shows !== undefined && byCell) throw new Error("Say where by text, or by row and column - not both.");
    if (byCell && (row === undefined || column === undefined)) throw new Error("Say both the row and the column, 1 at the top left.");
    if (needed && shows === undefined && !byCell) throw new Error("Say where: text the screen shows, or a row and a column.");
    return shows !== undefined ? { text: shows, occurrence } : byCell ? { row, column } : {};
  };
  return [
    {
      name: "terminal_run",
      label: "Run in the terminal",
      description: "Run a command in the preview's terminal, where the person watches - a shell in the project's folder, such as ./dist/cli/todo add \"milk\". Returns what it printed, and whether it is back at the prompt or still running.",
      promptSnippet: "Run a command in the person's preview terminal, to try a CLI",
      promptGuidelines: GUIDELINES,
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The command line, as typed at the prompt." }, wait: { ...WAIT, description: `${WAIT.description} 15 unless said.` } },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (_id, { command, wait }) => ((line = ""), answer("run", { command, wait })),
    },
    {
      name: "terminal_type",
      label: "Type in the terminal",
      description: "Type into what runs in the preview's terminal - answer a prompt, use an interactive program - and press a key after it, or a key alone: enter, ctrl+c to stop it. Returns what it printed since.",
      promptSnippet: "Type text or press a key in the preview terminal",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to type." },
          key: { type: "string", description: `A key to press after the text, or alone - enter, tab, escape, backspace, up, down, left, right, ctrl+c, ctrl+d, ctrl+z, or any terminal_press takes: ${KEY}.` },
          delay: { type: "integer", minimum: 0, maximum: 200, description: "Milliseconds between characters, for a program that misses fast typing. 0 unless said." },
          wait: { ...WAIT, description: `${WAIT.description} 5 unless said.` },
        },
        additionalProperties: false,
      },
      execute: async (_id, { text: typed, key, delay, wait }) => {
        if (checks && (await atPrompt())) {
          // Each line it enters - by a newline in the text, or enter after it - is a command the shell runs.
          const lines = `${line}${typed ?? ""}`.split(/\r\n|\r|\n/);
          const entered = key !== undefined && ENTER.has(key.toLowerCase());
          const refused = refusalOf(entered ? lines : lines.slice(0, -1));
          if (refused !== undefined) {
            line = "";
            throw new Error(refused);
          }
          line = entered || (key !== undefined && CLEARS.has(key.toLowerCase())) ? "" : lines.at(-1);
        } else line = "";
        return answer("type", { text: typed, key, delay, wait });
      },
    },
    {
      name: "terminal_press",
      label: "Press keys in the terminal",
      description: "Press keys and key combinations in the preview's terminal, one after another - ctrl+q, shift+tab, f5, alt+x, ctrl+right, pageup. Returns what it printed since.",
      promptSnippet: "Press keys and key combinations in the preview terminal",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: `The keys, in order, each ${KEY}.` },
          repeat: { type: "integer", minimum: 1, maximum: 100, description: "Press the whole sequence this many times. 1 unless said." },
          delay: { type: "integer", minimum: 0, maximum: 1000, description: "Milliseconds between keys. 30 unless said." },
          wait: SETTLE,
        },
        required: ["keys"],
        additionalProperties: false,
      },
      execute: async (_id, { keys, repeat, delay, wait }) => {
        if (checks && Array.isArray(keys) && (await atPrompt())) {
          // Enter after what was typed at the prompt runs it: checked first. A character pressed adds to it.
          let now = line;
          for (const pressed of keys) {
            const name = String(pressed).toLowerCase();
            if (ENTER.has(name)) {
              const refused = refusalOf([now]);
              if (refused !== undefined) {
                line = "";
                throw new Error(refused);
              }
              now = "";
            } else if (CLEARS.has(name)) now = "";
            else if (name === "backspace") now = now.slice(0, -1);
            else if ([...String(pressed)].length === 1) now += pressed;
          }
          line = now;
        } else line = "";
        return answer("press", { keys, repeat, delay, wait });
      },
    },
    {
      name: "terminal_click",
      label: "Click in the terminal",
      description: "Click in what runs in the preview's terminal - a terminal UI that takes the mouse, such as a Textual or curses app - on a piece of text it shows, or on a cell by its row and column. Returns what the screen shows after.",
      promptSnippet: "Click on text or a cell in the preview terminal's program",
      parameters: {
        type: "object",
        properties: {
          ...WHERE,
          button: { type: "string", enum: ["left", "middle", "right"], description: "left unless said." },
          double: { type: "boolean", description: "A double click." },
          modifiers: { type: "array", items: { type: "string", enum: ["shift", "alt", "ctrl"] }, description: "Keys held while clicking." },
          wait: SETTLE,
        },
        additionalProperties: false,
      },
      execute: async (_id, { button, double, modifiers, wait, ...at }) => answer("click", { ...where(at, true), button, double, modifiers, wait }),
    },
    {
      name: "terminal_scroll",
      label: "Scroll in the terminal",
      description: "Turn the mouse wheel over what runs in the preview's terminal - a terminal UI that takes the mouse - at a piece of text it shows or a cell, or in the middle of the screen. Returns what the screen shows after.",
      promptSnippet: "Scroll a list or pane of the preview terminal's program with the wheel",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 50, description: "Wheel steps. 3 unless said." },
          ...Object.fromEntries(Object.entries(WHERE).map(([name, property]) => [name, name === "occurrence" ? property : { ...property, description: "Where the pointer is - what scrolls is what is under it: text the screen shows, or a cell's row and column, 1 at the top left. The middle of the screen unless said." }])),
          wait: SETTLE,
        },
        required: ["direction"],
        additionalProperties: false,
      },
      execute: async (_id, { direction, amount, wait, ...at }) => answer("scroll", { ...where(at, false), direction, amount, wait }),
    },
    {
      name: "terminal_screenshot",
      label: "Look at the terminal",
      description: "See the preview's terminal as the person does, as an image - its colours, a terminal UI's borders and layout, what is highlighted. Costs more than terminal_read: take one when the look matters.",
      promptSnippet: "See the preview terminal as an image",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_id, _params, _signal, _update, ctx) => {
        const sees = seesOf(ctx);
        if (!sees.images || (ctx?.model !== undefined && !ctx.model.input.includes("image"))) {
          sees.images = false;
          throw new Error("This model does not take images: read the terminal with terminal_read instead.");
        }
        const result = await request("screenshot", {});
        const now = !result.running ? "The shell has ended." : result.atPrompt ? "At the prompt." : `Running: ${result.program}.`;
        return { content: [text(`The preview's terminal, ${result.rows} rows by ${result.cols} columns. [${now}]`), { type: "image", data: result.data, mimeType: result.mimeType }], details: undefined };
      },
    },
    {
      name: "terminal_read",
      label: "Read the terminal",
      description: "Read the preview's terminal as it is now - the screen and what scrolled above it - and whether something still runs in it: a server's log, a program's output since.",
      promptSnippet: "Read the preview terminal's screen and scrollback",
      parameters: {
        type: "object",
        properties: { cells: { type: "boolean", description: "The visible screen alone, each line numbered by its row, with a column ruler at the top - to click or scroll by row and column." } },
        additionalProperties: false,
      },
      execute: async (_id, { cells } = {}) => answer("read", cells === true ? { cells: true } : {}),
    },
  ];
}
