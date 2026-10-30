import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The app as a test sees it: launched from source on the build in dist/, with everything it keeps elsewhere - its
 * userData, pi's credentials and sessions - in a folder of the test's own, and the fixture project copied there, so a
 * test changes neither the person's recents nor their ~/.pi/agent/auth.json nor the fixture itself.
 */

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = join(ROOT, "tests", "fixture", "hello");

interface Launched {
  app: ElectronApplication;
  window: Page;
  /** The fixture project's copy: its folder, and its spec. */
  project: string;
  spec: string;
  /** What the chat's model was sent, each request's body as it came - with a stub model (`stubModel`). */
  requests: string[];
}

interface Options {
  /** Open the fixture project at start (TURRI_APP_OPEN), or leave the window on its welcome screen. */
  open: boolean;
  /** Recent projects the welcome screen lists: the fixture's copy, when true. */
  recent: boolean;
  /**
   * The chat on a model of the test's own, on this machine - no model called: `silent` takes each request and never
   * answers, a turn that runs until it is stopped; `asks` answers each with an ask_user call, a question numbered by the
   * request, so each answer to one - or a decline - brings the next; `replies` answers each in words, after two seconds,
   * "reply n" - each costing $1.00, 1000 tokens read at the stub's price.
   */
  stubModel: false | "silent" | "asks" | "replies";
  /** More of the app's environment, as the person's shell would give it. */
  env: Record<string, string>;
  /** turri's debug mode on for the project: `debug: true` in its config.turri.yaml. */
  debug: boolean;
  /** Its conformance tests on - `conformance-tests: true`, as the fixture has it - or off: unset, as a new project's are. */
  conformance: boolean;
}

export const test = base.extend<Options & { launched: Launched; scratch: string }>({
  open: [true, { option: true }],
  recent: [false, { option: true }],
  stubModel: [false, { option: true }],
  env: [{}, { option: true }],
  debug: [false, { option: true }],
  conformance: [true, { option: true }],

  scratch: async ({}, use) => {
    // Real paths: macOS's tmpdir is a link, and the app names a project by where it really is.
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "turri-app-test-")));
    await use(scratch);
    rmSync(scratch, { recursive: true, force: true });
  },

  launched: async ({ scratch, open, recent, stubModel, env: more, debug, conformance }, use) => {
    const project = join(scratch, "hello");
    cpSync(FIXTURE, project, { recursive: true });
    if (debug) appendFileSync(join(project, "config.turri.yaml"), "debug: true\n");
    if (!conformance) writeFileSync(join(project, "config.turri.yaml"), readFileSync(join(project, "config.turri.yaml"), "utf8").replace(/^conformance-tests: true\n/m, ""));
    const userData = join(scratch, "user-data");
    mkdirSync(userData);
    if (recent) writeFileSync(join(userData, "recent-projects.json"), JSON.stringify([project]));
    const stub = stubModel ? await modelStub(scratch, project, stubModel) : undefined;

    // Not the person's shell's environment (TERM set: shell-env.ts keeps the one given), nor a Vite server's window - nor
    // their TURRI_DEBUG, which would decide debug over the project's config.
    const { VITE_DEV_SERVER_URL, TURRI_APP_SCREENSHOT, TURRI_APP_VIEW, TURRI_APP_OPEN, TURRI_APP_HIDDEN, TURRI_DEBUG, ...env } = process.env;
    const app = await electron.launch({
      args: [ROOT, `--user-data-dir=${userData}`],
      cwd: ROOT,
      env: {
        ...(env as Record<string, string>),
        TERM: env.TERM ?? "dumb",
        PI_CODING_AGENT_DIR: join(scratch, "pi"),
        // The fixture's models are Anthropic's: a project opens with any key, and no test sends one a word.
        ANTHROPIC_API_KEY: "sk-ant-test",
        // Its windows drawn but never shown, and out of the Dock: a run takes neither the screen nor the focus.
        TURRI_APP_HIDDEN: "1",
        ...(open ? { TURRI_APP_OPEN: project } : {}),
        ...more,
      },
    });
    const window = await app.firstWindow();
    await use({ app, window, project, spec: join(project, "hello.plain"), requests: stub?.requests ?? [] });
    await app.close();
    stub?.close();
  },
});

/** A model provider of the test's own, in pi's models.json - the project's harness-model (see `stubModel`). */
async function modelStub(scratch: string, project: string, mode: "silent" | "asks" | "replies") {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "silent") return void response.write(": thinking\n\n");
      const n = requests.length;
      const chunk = (choice: object, more: object = {}) => `data: ${JSON.stringify({ id: `stub-${n}`, object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, ...choice }], ...more })}\n\n`;
      if (mode === "replies") {
        response.write(": thinking\n\n");
        const usage = { usage: { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000 } };
        return void setTimeout(() => response.end(chunk({ delta: { role: "assistant", content: `reply ${n}` }, finish_reason: null }) + chunk({ delta: {}, finish_reason: "stop" }, usage) + "data: [DONE]\n\n"), 2000);
      }
      // An OpenAI-style stream of one tool call: ask_user, question n.
      const call = { index: 0, id: `call_${n}`, type: "function", function: { name: "ask_user", arguments: JSON.stringify({ question: `question ${n}?`, options: ["yes", "no"] }) } };
      response.end(chunk({ delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }) + chunk({ delta: {}, finish_reason: "tool_calls" }) + "data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  mkdirSync(join(scratch, "pi"), { recursive: true });
  // Priced so a reply's 1000 tokens read cost $1.00: what the chat has spent, in whole dollars.
  const cost = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 };
  const provider = { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "test", models: [{ id: "silent", input: ["text", "image"], cost }] };
  writeFileSync(join(scratch, "pi", "models.json"), JSON.stringify({ providers: { stub: provider } }));
  const config = join(project, "config.turri.yaml");
  writeFileSync(config, readFileSync(config, "utf8").replace(/^harness-model: .*$/m, "harness-model: stub/silent"));
  return { requests, close: () => server.close() };
}

export { expect } from "@playwright/test";

/** What of ***plain the turri running gives the window - its standard library, the graph, concepts - once the project is open. */
export async function offers(window: Page): Promise<{ stdlib: boolean; links: boolean; concepts: boolean; resources: boolean; chats: boolean; settingChoices?: boolean }> {
  await window.locator(".tree-row").first().waitFor();
  return window.evaluate(() =>
    (window as unknown as { turri: { call: (method: string) => Promise<{ offers: { stdlib: boolean; links: boolean; concepts: boolean; resources: boolean; chats: boolean; settingChoices?: boolean } }> } }).turri
      .call("summary")
      .then((summary) => summary.offers),
  );
}

/** An event of the chat shown, sent to the window as the engine sends it - what a model would say, without one. */
export async function tellChat(app: ElectronApplication, window: Page, event: string, data: unknown) {
  // The chat's model is read with its history: by then the engine has the chat. (Not when a question's card covers it.)
  if ((await window.locator(".question-card").count()) === 0) await window.locator(".chat-model").waitFor();
  const chats = await window.evaluate(() => (window as unknown as { turri: { call: (method: string) => Promise<Array<{ id: string; shown: boolean }>> } }).turri.call("chats"));
  const chat = (chats.find((each) => each.shown) ?? chats[0])!.id;
  await app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0]!.webContents.send(`engine:${sent.event}`, { chat: sent.chat, data: sent.data }), { event, chat, data });
}

/** Regen shown: the dive, opened by the dive button at the toolbar's right. */
export async function showRegen(window: Page) {
  await window.locator(".toolbar .dive-open").click();
  await expect(window.locator(".dive").getByRole("tab", { name: /^regen/, selected: true })).toBeVisible();
}

/** Back from the dive to the project's window, by its ‹. */
export async function leaveRegen(window: Page) {
  await window.locator(".dive .dive-back").click();
  await expect(window.locator(".dive")).toHaveCount(0);
}

/** A menu bar item clicked, by its label - as its key would. */
export async function clickMenu(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, BrowserWindow }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const inside = item.submenu ? find(item.submenu.items) : undefined;
        if (inside) return inside;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()!.items);
    if (item === undefined) throw new Error(`No menu item ${wanted}`);
    item.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, label);
}
