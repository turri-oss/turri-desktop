// turri's eyes on the app it builds: browser tools for the chat's agent, on the window's preview pane - the one the
// person is looking at. A pi extension of the app's own, loaded beside turri's: each tool is a request to the main
// process, which drives the pane (electron/preview.ts). They exist only in the app: the terminal has no pane to drive.

/**
 * The browser tools - `browserTools`, given every chat and the sentinel's - with what the model is sent of their
 * screenshots kept down: only the newest is an image - those before it are a line saying they were there - and none at
 * all once the model has refused one, as some do that their catalogue says take images.
 */
export function browserExtension(tools) {
  return (pi) => {
    for (const tool of tools) pi.registerTool(tool);
    pi.on("context", ({ messages }, ctx) => ({ messages: withScreenshots(messages, seesOf(ctx).images) }));
    pi.on("message_end", ({ message }, ctx) => {
      if (message.role !== "assistant" || message.stopReason !== "error" || !IMAGE_REFUSED.test(message.errorMessage ?? "")) return;
      // Refused for the screenshot alone: the turn is tried again - pi retries an error that says it may be, and
      // leaves the refused attempt out - and is sent without it, so turri carries on where it was.
      const sees = seesOf(ctx);
      const first = sees.images;
      sees.images = false;
      message.errorMessage = `${message.errorMessage}${RETRIED}`;
      if (first) ctx.ui.notify("This model does not take images: turri carries on without the preview's screenshots, and reads the page instead.", "warning");
    });
  };
}

/** A provider's refusal of an image in the conversation - Bedrock's: "This model doesn't support the image field". */
const IMAGE_REFUSED = /image/i;
const RETRIED = " - try your request again";

/** A reply refused for a screenshot and tried again without it: not the person's to see - the turn goes on. */
export function retriedWithoutImages(message) {
  return message?.role === "assistant" && message.stopReason === "error" && (message.errorMessage ?? "").endsWith(RETRIED);
}

/** The tools whose results are screenshots - the preview page's, and its terminal's (engine/terminal.mjs). */
const SCREENSHOTS = new Set(["browser_screenshot", "terminal_screenshot"]);
const isScreenshot = (message) => message.role === "toolResult" && SCREENSHOTS.has(message.toolName);

/**
 * Whether a chat's model still takes the preview's screenshots, by the chat - its session's manager, which its tools and
 * handlers are given: the tools are one set for every chat, a model's refusal its chat's alone.
 */
const seen = new WeakMap();
export function seesOf(ctx) {
  const key = ctx?.sessionManager ?? seen;
  if (!seen.has(key)) seen.set(key, { images: true });
  return seen.get(key);
}

/** The conversation as the model is sent it: the newest screenshot as an image, if it takes them, the rest as words. */
function withScreenshots(messages, images) {
  const newest = images ? messages.findLastIndex(isScreenshot) : -1;
  return messages.map((message, index) => {
    if (!isScreenshot(message) || index === newest || !Array.isArray(message.content)) return message;
    const read = message.toolName === "terminal_screenshot" ? "terminal_read" : "browser_read";
    const said = images ? "[an earlier screenshot of the preview, left out: take another to see it now]" : `[the screenshot is left out: this model does not take images - use ${read}]`;
    return { ...message, content: message.content.map((part) => (part.type === "image" ? { type: "text", text: said } : part)) };
  });
}

const NOTHING = { type: "object", properties: {}, additionalProperties: false };
/** How browser_press names a key: electron/preview.ts has the key events for each. */
const KEY = "a key with its modifiers joined by +: left, up, space, enter, escape, a, w, shift+tab, ctrl+z, f5";
const ELEMENT = {
  ref: { type: "integer", description: "The element's number, as browser_read listed it: [3] is 3." },
  selector: { type: "string", description: "A CSS selector for the element, when it has no number." },
};

const GUIDELINES = [
  "The browser_* tools drive the preview pane in the person's window, on the app as it runs on this machine (localhost): the person watches what you do there.",
  "Use them to check what you built works as the ***plain says: open it, read the page, try a flow, read the console for errors.",
  "Prefer browser_read to browser_screenshot: it is text, and costs less. Take a screenshot when how the page looks matters.",
  "browser_click clicks what browser_read numbered, or the text a page shows when it has no number; a point of the screenshot (x and y) for a canvas, or what nothing else reaches.",
  "browser_press presses keys on the page as a keyboard does - a shortcut, Enter in a field, or a game's controls: hold a key for as long as it should act (hold), press keys together (together), and look with browser_screenshot between moves.",
  "They see only a running app: if nothing answers, start it first (release it, or run it with terminal_run), then open it.",
];

/** Tools on the preview, each sent as `request(action, params)` and answered with what came of it. */
export function browserTools(request) {
  const text = (value) => ({ type: "text", text: value });
  const header = (result) => `${result.title || "(untitled)"} - ${result.url}`;
  return [
    {
      name: "browser_navigate",
      label: "Open in the preview",
      description: "Open a URL of the app being built in the preview pane - one this machine serves, such as http://localhost:8000/docs. Returns the page's title and URL, or why it did not load.",
      promptSnippet: "Open the running app (localhost) in the person's preview pane",
      promptGuidelines: GUIDELINES,
      parameters: { type: "object", properties: { url: { type: "string", description: "The address, on localhost." } }, required: ["url"], additionalProperties: false },
      execute: async (_id, { url }) => {
        const result = await request("navigate", { url: /^\w+:\/\//.test(url) ? url : `http://${url}` });
        if (result.error) throw new Error(`Nothing loaded at ${url}: ${result.error}. Is the app running?`);
        return { content: [text(`Opened ${header(result)}`)], details: undefined };
      },
    },
    {
      name: "browser_screenshot",
      label: "Look at the preview",
      description: "See the page open in the preview pane, as an image - how it looks. Costs more than browser_read: take one when the look matters.",
      promptSnippet: "See the preview pane as an image",
      parameters: NOTHING,
      execute: async (_id, _params, _signal, _update, ctx) => {
        const sees = seesOf(ctx);
        if (!sees.images || (ctx.model !== undefined && !ctx.model.input.includes("image"))) {
          sees.images = false;
          throw new Error("This model does not take images: read the page with browser_read instead.");
        }
        const result = await request("screenshot", {});
        return { content: [text(header(result)), { type: "image", data: result.data, mimeType: result.mimeType }], details: undefined };
      },
    },
    {
      name: "browser_read",
      label: "Read the preview",
      description: "Read the page open in the preview pane: its visible text, and its controls - links, buttons, inputs - each numbered for browser_click and browser_type.",
      promptSnippet: "Read the preview pane's text and numbered controls",
      parameters: NOTHING,
      execute: async () => {
        const result = await request("read", {});
        const controls = result.controls.length > 0 ? result.controls.join("\n") : "(none)";
        return { content: [text(`${header(result)}\n\n## Text\n\n${result.text}\n\n## Controls\n\n${controls}`)], details: undefined };
      },
    },
    {
      name: "browser_console",
      label: "Read the preview's console",
      description: "The preview page's console since it last loaded - its errors, warnings and logs - and any load that failed.",
      promptSnippet: "Read the preview page's console",
      parameters: NOTHING,
      execute: async () => {
        const result = await request("console", {});
        return { content: [text(`${header(result)}\n\n${result.lines.length > 0 ? result.lines.join("\n") : "(the console is empty)"}`)], details: undefined };
      },
    },
    {
      name: "browser_click",
      label: "Click in the preview",
      description: "Click an element of the preview page - by its number from browser_read, a CSS selector or the text it shows - or a point of the page, and wait for what it loads.",
      promptSnippet: "Click an element in the preview pane",
      parameters: {
        type: "object",
        properties: {
          ...ELEMENT,
          text: { type: "string", description: "Text the page shows, to click on - a link's or button's words, a label - when it has no number." },
          occurrence: { type: "integer", minimum: 1, description: "Which one, in reading order, when the text shows more than once. 1 unless said." },
          x: { type: "integer", description: "A point of the page in pixels from the top left of what browser_screenshot shows - for a canvas, or what nothing else reaches." },
          y: { type: "integer", description: "A point of the page in pixels from the top left of what browser_screenshot shows - for a canvas, or what nothing else reaches." },
          button: { type: "string", enum: ["left", "middle", "right"], description: "left unless said." },
          double: { type: "boolean", description: "A double click." },
          modifiers: { type: "array", items: { type: "string", enum: ["shift", "alt", "ctrl", "meta"] }, description: "Keys held while clicking." },
        },
        additionalProperties: false,
      },
      execute: async (_id, { ref, selector, text: shows, occurrence, x, y, button, double, modifiers }) => {
        const ways = [ref !== undefined, Boolean(selector), Boolean(shows), x !== undefined || y !== undefined].filter(Boolean).length;
        if (ways !== 1 || (x === undefined) !== (y === undefined)) throw new Error("Say what to click - one of: ref, selector, text, or x and y.");
        const result = await request("click", { ref, selector, text: shows, occurrence, x, y, button, double, modifiers });
        return { content: [text(`${result.did}\nNow: ${header(result)}`)], details: undefined };
      },
    },
    {
      name: "browser_press",
      label: "Press keys in the preview",
      description:
        "Press keys on the preview page as a keyboard does - each held down, then let go, one after another: arrows, space, enter, a letter, ctrl+z. For a game or what listens to the keyboard itself; to fill in a field, browser_type.",
      promptSnippet: "Press keys on the preview page - shortcuts, a game's controls",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: `The keys, in order, each ${KEY}.` },
          hold: { type: "integer", minimum: 0, maximum: 10000, description: "Milliseconds each key is held down - longer for a game's move that lasts while the key is down. 50 unless said." },
          together: { type: "boolean", description: "Press the keys at once - all down, held, then all up - as up and right together for a diagonal." },
          repeat: { type: "integer", minimum: 1, maximum: 100, description: "Press the whole sequence this many times. 1 unless said." },
          delay: { type: "integer", minimum: 0, maximum: 5000, description: "Milliseconds between one key's release and the next. 50 unless said." },
        },
        required: ["keys"],
        additionalProperties: false,
      },
      execute: async (_id, { keys, hold, together, repeat, delay }) => {
        const result = await request("press", { keys, hold, together, repeat, delay });
        return { content: [text(`${result.did}\nNow: ${header(result)}`)], details: undefined };
      },
    },
    {
      name: "browser_type",
      label: "Type in the preview",
      description: "Type text into an input of the preview page - by its number from browser_read, or a CSS selector - replacing what is in it; submit sends its form.",
      promptSnippet: "Type into an input in the preview pane",
      parameters: {
        type: "object",
        properties: { ...ELEMENT, text: { type: "string", description: "What to type." }, submit: { type: "boolean", description: "Send the form after typing, as Enter would." } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (_id, { ref, selector, text: typed, submit }) => {
        const result = await request("type", { ref, selector, text: typed, submit });
        return { content: [text(`${result.did}\nNow: ${header(result)}`)], details: undefined };
      },
    },
  ];
}
