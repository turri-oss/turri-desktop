import { expect, test } from "@playwright/test";

// turri's preview tools as the engine defines them (engine/terminal.mjs, engine/browser.mjs): what each takes, what it
// asks of the main process, and what it answers - the requests answered here, as the main process would.

interface Tool {
  name: string;
  label: string;
  description: string;
  promptGuidelines?: string[];
  parameters: { properties: Record<string, { type: string; enum?: string[]; items?: { enum?: string[] } }>; required?: string[]; additionalProperties: boolean };
  execute: (id: string, params: object, signal?: unknown, update?: unknown, ctx?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

// The engine's own JavaScript, untyped.
const [terminalModule, browserModule]: string[] = ["../engine/terminal.mjs", "../engine/browser.mjs"];

async function tools(kind: "terminal" | "browser", answer: (action: string, params: Record<string, unknown>) => object = () => ({})) {
  const asked: Array<{ action: string; params: Record<string, unknown> }> = [];
  const request = async (action: string, params: Record<string, unknown>) => (asked.push({ action, params }), answer(action, params));
  const made = kind === "terminal" ? ((await import(terminalModule)) as { terminalTools: (request: unknown) => Tool[] }).terminalTools(request) : ((await import(browserModule)) as { browserTools: (request: unknown) => Tool[] }).browserTools(request);
  const named = (name: string) => made.find((tool) => tool.name === name)!;
  return { made, named, asked };
}

const SHOWN = { text: "the screen", running: true, program: "python", atPrompt: false };

test.describe("the terminal tools", () => {
  test("are run, type, press, click, scroll and read, each taking only what it says", async () => {
    const { made, named } = await tools("terminal");
    expect(made.map((tool) => tool.name)).toEqual(["terminal_run", "terminal_type", "terminal_press", "terminal_click", "terminal_scroll", "terminal_screenshot", "terminal_read"]);
    for (const tool of made) expect(tool.parameters.additionalProperties, tool.name).toBe(false);
    expect(named("terminal_press").label).toBe("Press keys in the terminal");
    expect(named("terminal_click").label).toBe("Click in the terminal");
    expect(named("terminal_scroll").label).toBe("Scroll in the terminal");
    expect(Object.keys(named("terminal_press").parameters.properties)).toEqual(["keys", "repeat", "delay", "wait"]);
    expect(named("terminal_press").parameters.required).toEqual(["keys"]);
    expect(Object.keys(named("terminal_click").parameters.properties)).toEqual(["text", "occurrence", "row", "column", "button", "double", "modifiers", "wait"]);
    expect(named("terminal_click").parameters.properties.button!.enum).toEqual(["left", "middle", "right"]);
    expect(named("terminal_click").parameters.properties.modifiers!.items!.enum).toEqual(["shift", "alt", "ctrl"]);
    expect(Object.keys(named("terminal_scroll").parameters.properties)).toEqual(["direction", "amount", "text", "occurrence", "row", "column", "wait"]);
    expect(named("terminal_scroll").parameters.required).toEqual(["direction"]);
    expect(Object.keys(named("terminal_type").parameters.properties)).toEqual(["text", "key", "delay", "wait"]);
    // A key is the grammar now, not a list: the old ones are its examples.
    expect(named("terminal_type").parameters.properties.key!.enum).toBeUndefined();
    expect(Object.keys(named("terminal_read").parameters.properties)).toEqual(["cells"]);
    expect(named("terminal_run").promptGuidelines!.join("\n")).toContain("terminal_press is for keys and key combinations - ctrl+q to quit a Textual app, shift+tab back, f-keys, pageup; terminal_type for text.");
  });

  test("say where by text or by row and column, exactly one - the wheel in the middle when neither", async () => {
    const { named, asked } = await tools("terminal", () => ({ ...SHOWN, did: "Clicked." }));
    const click = named("terminal_click");
    await expect(click.execute("1", {})).rejects.toThrow("Say where: text the screen shows, or a row and a column.");
    await expect(click.execute("1", { text: "Add", row: 1, column: 1 })).rejects.toThrow("not both");
    await expect(click.execute("1", { column: 4 })).rejects.toThrow("Say both the row and the column");
    await click.execute("1", { text: "Add", occurrence: 2 });
    await click.execute("1", { row: 3, column: 9, button: "right", double: true, modifiers: ["ctrl"] });
    await named("terminal_scroll").execute("1", { direction: "down" });
    expect(asked).toEqual([
      { action: "click", params: { text: "Add", occurrence: 2, button: undefined, double: undefined, modifiers: undefined, wait: undefined } },
      { action: "click", params: { row: 3, column: 9, button: "right", double: true, modifiers: ["ctrl"], wait: undefined } },
      { action: "scroll", params: { direction: "down", amount: undefined, wait: undefined } },
    ]);
  });

  test("take a screenshot of the terminal as an image, unless the model takes none", async () => {
    const { named, asked } = await tools("terminal", () => ({ data: "aGk=", mimeType: "image/jpeg", rows: 30, cols: 100, running: true, program: "python", atPrompt: false }));
    const shot = named("terminal_screenshot");
    const seeing = { sessionManager: {}, model: { input: ["text", "image"] } };
    const result = (await shot.execute("1", {}, undefined, undefined, seeing)) as unknown as { content: Array<{ type: string; text?: string; data?: string }> };
    expect(result.content[0]!.text).toBe("The preview's terminal, 30 rows by 100 columns. [Running: python.]");
    expect(result.content[1]).toEqual({ type: "image", data: "aGk=", mimeType: "image/jpeg" });
    await expect(shot.execute("1", {}, undefined, undefined, { sessionManager: {}, model: { input: ["text"] } })).rejects.toThrow("This model does not take images: read the terminal with terminal_read instead.");
    expect(asked).toEqual([{ action: "screenshot", params: {} }]);
  });

  test("answer with what was done, then what the terminal shows, and what runs", async () => {
    const { named, asked } = await tools("terminal", (action) => ({ ...SHOWN, ...(action === "press" ? { did: "Pressed ctrl+q." } : {}) }));
    const pressed = await named("terminal_press").execute("1", { keys: ["ctrl+q"] });
    expect(pressed.content[0]!.text).toBe("Pressed ctrl+q.\n\nthe screen\n\n[Still running: python - waiting for input, or serving. Answer it with terminal_type, or stop it with terminal_press ctrl+c.]");
    const read = await named("terminal_read").execute("1", { cells: true });
    expect(read.content[0]!.text).toBe("the screen\n\n[Still running: python - waiting for input, or serving. Answer it with terminal_type, or stop it with terminal_press ctrl+c.]");
    await named("terminal_read").execute("1", {});
    await named("terminal_type").execute("1", { text: "milk", delay: 20 });
    expect(asked.slice(-3)).toEqual([
      { action: "read", params: { cells: true } },
      { action: "read", params: {} },
      { action: "type", params: { text: "milk", key: undefined, delay: 20, wait: undefined } },
    ]);
  });
});

test.describe("browser_click", () => {
  test("takes a ref, a selector, text or a point - exactly one", async () => {
    const { named, asked } = await tools("browser", () => ({ did: "Clicked <button> `Save`.", title: "todo", url: "http://localhost:8000/" }));
    const click = named("browser_click");
    expect(Object.keys(click.parameters.properties)).toEqual(["ref", "selector", "text", "occurrence", "x", "y", "button", "double", "modifiers"]);
    expect(click.parameters.properties.modifiers!.items!.enum).toEqual(["shift", "alt", "ctrl", "meta"]);
    expect(click.description).toBe("Click an element of the preview page - by its number from browser_read, a CSS selector or the text it shows - or a point of the page, and wait for what it loads.");
    for (const wrong of [{}, { ref: 1, text: "Save" }, { selector: "button", x: 1, y: 2 }, { x: 4 }])
      await expect(click.execute("1", wrong), JSON.stringify(wrong)).rejects.toThrow("Say what to click - one of: ref, selector, text, or x and y.");
    expect(asked).toEqual([]);
    const done = await click.execute("1", { text: "Save", occurrence: 2, double: true });
    expect(done.content[0]!.text).toBe("Clicked <button> `Save`.\nNow: todo - http://localhost:8000/");
    await click.execute("1", { x: 10, y: 20 });
    await click.execute("1", { ref: 3 });
    expect(asked.map((each) => Object.fromEntries(Object.entries(each.params).filter(([, value]) => value !== undefined)))).toEqual([{ text: "Save", occurrence: 2, double: true }, { x: 10, y: 20 }, { ref: 3 }]);
  });
});

test.describe("browser_press", () => {
  test("takes keys, how long each is held, whether together, and repeats - and says what it pressed", async () => {
    const { named, asked } = await tools("browser", () => ({ did: "Pressed left, space.", title: "game", url: "http://localhost:8000/" }));
    const press = named("browser_press");
    expect(press.label).toBe("Press keys in the preview");
    expect(Object.keys(press.parameters.properties)).toEqual(["keys", "hold", "together", "repeat", "delay"]);
    expect(press.parameters.required).toEqual(["keys"]);
    const done = await press.execute("1", { keys: ["left", "space"], hold: 300 });
    expect(done.content[0]!.text).toBe("Pressed left, space.\nNow: game - http://localhost:8000/");
    expect(asked).toEqual([{ action: "press", params: { keys: ["left", "space"], hold: 300, together: undefined, repeat: undefined, delay: undefined } }]);
  });
});
