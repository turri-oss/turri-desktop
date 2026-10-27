import { expect, test } from "@playwright/test";
import { createTerminal } from "../electron/terminal.ts";

// The preview's terminal as turri's tools use it, on a pty of the test's own: what it is sent, what it says back, and
// which program is in the foreground - "fakesh" at its prompt - all the test's to say.

const ESC = "\x1b";

function fakePty() {
  let onData: (data: string) => void = () => {};
  const written: string[] = [];
  const pty = {
    process: "fakesh",
    written,
    /** What the program prints. */
    say: (data: string) => onData(data),
    onData: (listener: (data: string) => void) => ((onData = listener), { dispose() {} }),
    onExit: () => ({ dispose() {} }),
    write: (data: string) => void written.push(data),
    resize() {},
    kill() {},
  };
  return pty;
}

function terminal() {
  const pty = fakePty();
  const sent: Array<{ channel: string; data: unknown }> = [];
  const made = createTerminal({ send: (channel, data) => sent.push({ channel, data }), spawn: (() => pty) as never, shell: "/bin/fakesh" });
  made.setDir("/tmp");
  made.open();
  made.resize(40, 6);
  /** A program in the foreground, which prints this. */
  const runs = (program: string, prints = "") => {
    pty.process = program;
    if (prints) pty.say(prints);
  };
  const request = (action: string, params: object) => made.request(action, { wait: 1, ...params }) as Promise<{ did?: string; text: string }>;
  return { pty, sent, runs, request };
}

/** A Textual app's screen: mouse reporting on, any motion, SGR. */
const TUI = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1015h${ESC}[?1006h  ✎ 🗑 Add New Task\r\n  item one\r\n  item two\r\n  item one`;

test.describe("the shell at its prompt", () => {
  test("is the shell in the foreground however the system names it - its name, its path, or a login shell's", async () => {
    for (const named of ["fakesh", "/bin/fakesh", "-fakesh"]) {
      const { runs, request } = terminal();
      runs(named);
      await expect(request("click", { text: "x" })).rejects.toThrow("the shell is at its prompt");
    }
  });
});

test.describe("a click in the preview's terminal", () => {
  test("is refused at the prompt, and by a program that has not turned on mouse reporting", async () => {
    const { runs, request } = terminal();
    await expect(request("click", { text: "x" })).rejects.toThrow("Nothing in the terminal takes the mouse: the shell is at its prompt. Run the program with terminal_run first.");
    runs("less", "a page of text");
    await expect(request("click", { text: "page" })).rejects.toThrow("less has not turned on mouse reporting, so it takes no clicks or wheel: use terminal_press and terminal_type instead.");
  });

  test("goes to the middle of the text, the pointer moved there first, in SGR", async () => {
    const { pty, sent, runs, request } = terminal();
    runs("python", TUI);
    const result = await request("click", { text: "Add New Task" });
    expect(result.did).toBe("Clicked `Add New Task` at row 1, column 12.");
    expect(pty.written).toEqual([`${ESC}[<35;12;1M`, `${ESC}[<0;12;1M${ESC}[<0;12;1m`]);
    expect(result.text).toContain("item two");
    expect(sent).toContainEqual({ channel: "terminal:pointer", data: { row: 1, column: 12, kind: "click" } });
    expect(sent).toContainEqual({ channel: "terminal:reveal", data: null });
  });

  test("takes the nth of a text that shows more than once, and says where each is when there are fewer", async () => {
    const { pty, runs, request } = terminal();
    runs("python", TUI);
    const result = await request("click", { text: "item one", occurrence: 2 });
    expect(result.did).toBe("Clicked `item one` (2 of 2) at row 4, column 6.");
    expect(pty.written.at(-1)).toBe(`${ESC}[<0;6;4M${ESC}[<0;6;4m`);
    await expect(request("click", { text: "item one", occurrence: 3 })).rejects.toThrow("`item one` shows 2 times on the screen, not 3: row 2, column 6; row 4, column 6.");
    await expect(request("click", { text: "missing" })).rejects.toThrow(/`missing` is not on the screen\. It shows:\n\n {2}✎ 🗑 Add New Task\n {2}item one/);
  });

  test("goes to a cell, with another button, a double click and keys held", async () => {
    const { pty, runs, request } = terminal();
    runs("python", TUI);
    const result = await request("click", { row: 3, column: 5, button: "right", double: true, modifiers: ["ctrl", "shift"] });
    expect(result.did).toBe("Double-clicked with the right button, holding ctrl+shift, at row 3, column 5.");
    // ctrl 16 + shift 4: the move 35 + 20, the right button 2 + 20.
    expect(pty.written).toEqual([`${ESC}[<55;5;3M`, `${ESC}[<22;5;3M${ESC}[<22;5;3m`, `${ESC}[<22;5;3M${ESC}[<22;5;3m`]);
    await expect(request("click", { row: 7, column: 1 })).rejects.toThrow("Row 7, column 1 is off the screen: it is 6 rows by 40 columns, 1 at the top left.");
    await expect(request("click", { row: 2 })).rejects.toThrow(/Say both the row and the column/);
    await expect(request("click", { text: "item", row: 2, column: 1 })).rejects.toThrow(/not both/);
  });

  test("is written in X10 when the program asked for no encoding, the pointer not moved first with clicks only", async () => {
    const { pty, runs, request } = terminal();
    runs("vim", `${ESC}[?1000hhello`);
    await request("click", { text: "hello" });
    expect(pty.written).toEqual([`${ESC}[M #!${ESC}[M##!`]);
  });

  test("forgets the modes of a program that has ended", async () => {
    const { runs, request } = terminal();
    runs("python", TUI);
    runs("fakesh");
    runs("less", "plain text");
    await expect(request("click", { text: "plain" })).rejects.toThrow(/less has not turned on mouse reporting/);
  });
});

test.describe("the wheel in the preview's terminal", () => {
  test("turns over the middle of the screen, or where it is told, each step its own event", async () => {
    const { pty, sent, runs, request } = terminal();
    runs("python", TUI);
    const result = await request("scroll", { direction: "down" });
    expect(result.did).toBe("Scrolled down 3 at row 3, column 20.");
    expect(pty.written).toEqual([`${ESC}[<35;20;3M`, ...Array(3).fill(`${ESC}[<65;20;3M`)]);
    expect(sent).toContainEqual({ channel: "terminal:pointer", data: { row: 3, column: 20, kind: "scroll" } });
    pty.written.length = 0;
    const over = await request("scroll", { direction: "up", amount: 2, text: "item two" });
    expect(over.did).toBe("Scrolled up 2 over `item two` at row 3, column 6.");
    expect(pty.written.slice(1)).toEqual([`${ESC}[<64;6;3M`, `${ESC}[<64;6;3M`]);
    pty.written.length = 0;
    await request("scroll", { direction: "left", amount: 1, row: 1, column: 1 });
    await request("scroll", { direction: "right", amount: 1, row: 1, column: 1 });
    expect(pty.written.filter((data) => !data.startsWith(`${ESC}[<35`))).toEqual([`${ESC}[<66;1;1M`, `${ESC}[<67;1;1M`]);
  });

  test("is written in URXVT and UTF-8 when the program asks", async () => {
    const { pty, runs, request } = terminal();
    runs("python", `${ESC}[?1000;1015hx`);
    await request("scroll", { direction: "down", amount: 1, row: 2, column: 4 });
    expect(pty.written).toEqual([`${ESC}[97;4;2M`]);
    pty.written.length = 0;
    pty.say(`${ESC}[?1015l${ESC}[?1005h`);
    await request("scroll", { direction: "up", amount: 1, row: 2, column: 4 });
    expect(pty.written).toEqual([`${ESC}[M\`$"`]);
  });
});

test.describe("keys pressed in the preview's terminal", () => {
  test("are sent one after another, said back, and the whole repeated", async () => {
    const { pty, request } = terminal();
    const result = await request("press", { keys: ["shift+tab", "shift+tab", "enter"] });
    expect(result.did).toBe("Pressed shift+tab, shift+tab, enter.");
    expect(pty.written).toEqual([`${ESC}[Z`, `${ESC}[Z`, "\r"]);
    pty.written.length = 0;
    const again = await request("press", { keys: ["down", "ctrl+q"], repeat: 2, delay: 0 });
    expect(again.did).toBe("Pressed down, ctrl+q - 2 times.");
    expect(pty.written).toEqual([`${ESC}[B`, "\x11", `${ESC}[B`, "\x11"]);
  });

  test("say what a key sends the same as, and refuse one outside the grammar before pressing any", async () => {
    const { pty, request } = terminal();
    const result = await request("press", { keys: ["ctrl+shift+a"] });
    expect(result.did).toBe("Pressed ctrl+shift+a. ctrl+shift+a sends the same as ctrl+a in this terminal.");
    pty.written.length = 0;
    await expect(request("press", { keys: ["a", "hyper+b"] })).rejects.toThrow(/No such key: "hyper\+b"/);
    expect(pty.written).toEqual([]);
  });

  test("wait after an escape, whatever the delay, so the next is not read as alt and it", async () => {
    const { pty, request } = terminal();
    const times: number[] = [];
    const write = pty.write;
    pty.write = (data: string) => (times.push(Date.now()), write(data));
    await request("press", { keys: ["escape", "a", "alt+x", "b", "c"], delay: 0 });
    expect(pty.written).toEqual([ESC, "a", `${ESC}x`, "b", "c"]);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(95);
    expect(times[3]! - times[2]!).toBeGreaterThanOrEqual(95);
    expect(times[4]! - times[3]!).toBeLessThan(60);
  });

  test("send arrows as application cursor keys while the program has them on", async () => {
    const { pty, runs, request } = terminal();
    runs("vim", `${ESC}[?1h`);
    await request("press", { keys: ["up", "ctrl+up"] });
    expect(pty.written).toEqual([`${ESC}OA`, `${ESC}[1;5A`]);
    runs("fakesh");
    pty.written.length = 0;
    await request("press", { keys: ["up"] });
    expect(pty.written).toEqual([`${ESC}[A`]);
  });
});

test.describe("typing in the preview's terminal", () => {
  test("writes it whole, or with a delay a whole character at a time, then the key", async () => {
    const { pty, request } = terminal();
    await request("type", { text: "milk", key: "enter" });
    expect(pty.written).toEqual(["milk\r"]);
    pty.written.length = 0;
    await request("type", { text: "é👍🏽a", key: "ctrl+d", delay: 5 });
    expect(pty.written).toEqual(["é", "👍🏽", "a", "\x04"]);
    pty.written.length = 0;
    // The keys it had are kept, and any terminal_press takes.
    await request("type", { key: "ctrl-c" });
    await request("type", { key: "shift+tab" });
    expect(pty.written).toEqual(["\x03", `${ESC}[Z`]);
    await expect(request("type", { key: "nope" })).rejects.toThrow(/No such key/);
  });
});

test.describe("reading the preview's terminal", () => {
  test("by cells numbers the visible screen's rows and columns", async () => {
    const { runs, request } = terminal();
    runs("python", TUI);
    const result = await request("read", { cells: true });
    const lines = result.text.split("\n");
    expect(lines[0]).toBe(" |         1         2         3         4");
    expect(lines[1]).toBe(` |${"1234567890".repeat(4)}`);
    expect(lines[2]).toBe("1|  ✎ 🗑 Add New Task");
    expect(lines).toHaveLength(8);
    const plain = await request("read", {});
    expect(plain.text.split("\n")[0]).toBe("  ✎ 🗑 Add New Task");
  });
});
