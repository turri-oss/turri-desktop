import type { ElectronApplication, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryItem } from "../engine/entries.mjs";
import { expect, tellChat, test } from "./app.ts";

/** A pulse as the engine sends it, done: the sentinel's to check. */
const pulse = (id: string, title: string, sequence: number) => ({
  id,
  kind: "regenerate",
  summary: `hello: ${title}`,
  module: "hello",
  pulse: sequence,
  title,
  status: "succeeded",
  sequence,
  queuedAt: Date.now() - 60_000 + sequence,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now(),
  waitingOn: [],
  activity: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  agents: [],
  specGaps: [],
  failures: [],
});

/** Whether the turri running has a sentinel: on one without it, the window draws none of this. */
async function hasSentinel(window: Page): Promise<boolean> {
  await window.locator(".tree-row").first().waitFor();
  return window.evaluate(() =>
    (window as unknown as { turri: { call: (method: string) => Promise<{ offers: { sentinel?: boolean } }> } }).turri.call("summary").then((summary) => summary.offers.sentinel === true),
  );
}

/** A notice as turri puts it, in the chat `chat`. */
const notice = (chat: string, more: object = {}) => ({
  id: "n1",
  chat,
  severity: "error",
  summary: "the guestbook does not save a message",
  evidence: ["POST /messages answered 500", "sqlite3.OperationalError: no such table: messages"],
  actions: [
    { label: "regenerate the backend", task: "Regenerate backend.plain from scratch." },
    { label: "add the table to the ***plain", task: "Say in backend.plain that messages are kept in a table." },
  ],
  module: "backend",
  pulse: 3,
  job: "j-backend-3",
  state: "open",
  at: "2026-10-23T10:00:00.000Z",
  ...more,
});

/** The chat shown's id, as the engine has it. */
async function shownChat(window: Page): Promise<string> {
  await window.locator(".chat-model").waitFor();
  const chats = await window.evaluate(() => (window as unknown as { turri: { call: (method: string) => Promise<Array<{ id: string; shown: boolean }>> } }).turri.call("chats"));
  return (chats.find((each) => each.shown) ?? chats[0])!.id;
}

/** Entries of a chat's transcript, put in the window as the engine maps them (entries.mjs) - turri's own custom entries. */
async function transcript(app: ElectronApplication, window: Page, entries: Array<{ customType: string; data: unknown }>) {
  for (const entry of entries) {
    const item = entryItem({ type: "custom", ...entry });
    expect(item).not.toBeNull();
    await tellChat(app, window, "chat:message", item);
  }
}

/** The answers the window gives notices, as the main process is asked them: each answered `reply` - `done` - and kept here. */
async function answersTaken(app: ElectronApplication, reply = "done"): Promise<() => Promise<unknown[]>> {
  await app.evaluate(({ ipcMain }, reply) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
    const real = handlers.get("engine:call")!;
    const taken: unknown[] = [];
    (globalThis as unknown as { taken: unknown[] }).taken = taken;
    handlers.set("engine:call", (event, method, params) => {
      if (method !== "answerNotice") return real(event, method, params);
      taken.push(params);
      return reply;
    });
  }, reply);
  return () => app.evaluate(() => (globalThis as unknown as { taken: unknown[] }).taken);
}

test.describe("the sentinel", () => {
  test("maps turri's notice, its ending and a conclusion from the transcript", () => {
    const put = notice("1");
    expect(entryItem({ type: "custom", customType: "turri_notice", data: put })).toEqual({ role: "notice", notice: put });
    expect(entryItem({ type: "custom", customType: "turri_notice_over", data: { state: "dismissed", summary: put.summary } })).toEqual({ role: "noticeOver", state: "dismissed", summary: put.summary });
    const conclusion = { job: "j-backend-3", verdict: "holds", summary: "the guestbook saves and lists messages", module: "backend", pulse: 3 };
    expect(entryItem({ type: "custom", customType: "turri_sentinel_concluded", data: conclusion })).toEqual({ role: "concluded", conclusion });
    // turri's brief of a pulse, hidden from the person: where the sentinel's work on that pulse starts.
    expect(entryItem({ type: "custom_message", customType: "turri_sentinel_pulse", display: false, content: "A pulse finished.", details: { jobId: "j-backend-3", status: "succeeded" } })).toEqual({ role: "sentinelPulse", job: "j-backend-3" });
  });

  test("is told where the person watches it try a release, by the tools it is given", async () => {
    // The engine's own JavaScript, untyped: what the sentinel is told of the window, and the tools it is given.
    const [app, browser, terminal]: string[] = ["../engine/app.mjs", "../engine/browser.mjs", "../engine/terminal.mjs"];
    const { SENTINEL_SURFACE } = (await import(app)) as { SENTINEL_SURFACE: string };
    const { browserTools } = (await import(browser)) as { browserTools: (request: unknown) => Array<{ name: string }> };
    const { terminalTools } = (await import(terminal)) as { terminalTools: (request: unknown) => Array<{ name: string }> };
    const given = new Set([...browserTools(() => {}), ...terminalTools(() => {})].map((tool) => tool.name));
    const named = SENTINEL_SURFACE.match(/\b(?:browser|terminal)_[a-z]+/g) ?? [];
    expect(named).toContain("terminal_run");
    expect(named).toContain("browser_navigate");
    for (const tool of named) expect(given, `${tool} is a tool the sentinel is given`).toContain(tool);
    expect(SENTINEL_SURFACE).toContain("preview");
  });

  test("puts a notice among the notifications - not in the chat - its actions as buttons that answer it", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const answers = await answersTaken(app);
    await transcript(app, window, [{ customType: "turri_notice", data: notice(chat) }]);
    await tellChat(app, window, "chat:notice", notice(chat));

    // The panel opens on it, as it waits on an answer - and the chat draws nothing of it.
    const card = window.getByRole("tabpanel", { name: "notifications" }).getByRole("region", { name: "notice: the guestbook does not save a message" });
    await expect(card.locator(".notice-about")).toHaveText("sentinel · backend");
    await expect(window.locator(".chat-body .notice-card")).toHaveCount(0);
    await expect(window.getByRole("button", { name: /^notifications:/ })).toHaveAccessibleName("notifications: 0 unread, 1 to answer");
    await expect(card.locator(".notice-mark")).toHaveAttribute("aria-label", "error");
    await expect(card.locator(".notice-evidence li")).toHaveText(["POST /messages answered 500", "sqlite3.OperationalError: no such table: messages"]);
    // It blocks nothing: the message box is there beside it.
    await expect(window.getByPlaceholder("talk to turri - or / for a command")).toBeVisible();

    await card.getByRole("button", { name: "add the table to the ***plain" }).click();
    await expect.poll(answers).toEqual([{ id: "n1", answer: { action: 1 } }]);
    // Answered, its buttons rest until turri says it is over - then it says how it ended.
    await expect(card.getByRole("button", { name: "regenerate the backend" })).toBeDisabled();
    await tellChat(app, window, "chat:noticeOver", notice(chat, { state: "accepted" }));
    await expect(card.locator(".notice-ended")).toHaveText("accepted");
    await expect(card.getByRole("button")).toHaveCount(0);
    // Ended, it stays until it is put away.
    await expect(window.getByRole("button", { name: /^notifications:/ })).toHaveAccessibleName("notifications: 0 unread");
    await window.getByRole("button", { name: "put away" }).click();
    await expect(card).toHaveCount(0);
  });

  test("answers a notice in the person's words, or dismisses it", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const answers = await answersTaken(app);
    await transcript(app, window, [
      { customType: "turri_notice", data: notice(chat) },
      { customType: "turri_notice", data: notice(chat, { id: "n2", module: "frontend", summary: "the send button does nothing" }) },
    ]);
    await tellChat(app, window, "chat:notice", notice(chat));
    await tellChat(app, window, "chat:notice", notice(chat, { id: "n2", module: "frontend", summary: "the send button does nothing" }));

    const first = window.getByRole("region", { name: "notice: the guestbook does not save a message" });
    await first.getByRole("button", { name: "say what to do instead…" }).click();
    const words = first.getByPlaceholder("what should turri do about it?");
    await expect(words).toBeFocused();
    await words.fill("look at the migration first");
    await words.press("Enter");
    await window.getByRole("region", { name: "notice: the send button does nothing" }).getByRole("button", { name: "dismiss" }).click();
    await expect.poll(answers).toEqual([
      { id: "n1", answer: { steer: "look at the migration first" } },
      { id: "n2", answer: { dismiss: true } },
    ]);
  });

  test("offers to ignore what turri says may be left as it is for good - a gap in the ***plain - and only that", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const answers = await answersTaken(app);
    const gap = notice(chat, { id: "n2", severity: "warning", summary: "the ***plain does not say what happens to passwords over 72 bytes", ignorable: true });
    await transcript(app, window, [
      { customType: "turri_notice", data: notice(chat) },
      { customType: "turri_notice", data: gap },
    ]);
    await tellChat(app, window, "chat:notice", notice(chat));
    await tellChat(app, window, "chat:notice", gap);
    await expect(window.getByRole("region", { name: "notice: the guestbook does not save a message" }).getByRole("button", { name: "ignore" })).toHaveCount(0);
    const card = window.getByRole("region", { name: /passwords over 72 bytes/ });
    await card.getByRole("button", { name: "ignore" }).click();
    await expect.poll(answers).toEqual([{ id: "n2", answer: { ignore: true } }]);
    await tellChat(app, window, "chat:noticeOver", { ...gap, state: "ignored" });
    await expect(card.locator(".notice-ended")).toHaveText("ignored - left as the build has it, not raised again");
  });

  test("keeps a notice open, its buttons back, when turri refuses to ignore it", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    await answersTaken(app, "refused");
    const gap = notice(chat, { ignorable: true });
    await transcript(app, window, [{ customType: "turri_notice", data: gap }]);
    await tellChat(app, window, "chat:notice", gap);
    const card = window.getByRole("region", { name: "notice: the guestbook does not save a message" });
    await card.getByRole("button", { name: "ignore" }).click();
    await expect(window.locator(".status-said")).toContainText("this notice cannot be ignored");
    await expect(card.getByRole("button", { name: "dismiss" })).toBeEnabled();
  });

  test("leaves out the notices of the transcript that ended before - in the chat and the panel alike", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    await transcript(app, window, [
      { customType: "turri_notice", data: notice(chat) },
      { customType: "turri_notice_over", data: { state: "superseded", summary: "the guestbook does not save a message" } },
    ]);
    await expect(window.locator(".chat-body .notice-card")).toHaveCount(0);
    await expect(window.getByRole("region", { name: /^notice:/ })).toHaveCount(0);
    await expect(window.getByRole("button", { name: /^notifications:/ })).toHaveAccessibleName("notifications: 0 unread");
  });

  test("shows the sentinel's conclusions as a line - what it found only when something is wrong - linking what it did and the pulse", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    await app.evaluate(({ BrowserWindow }, chats) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chats", chats), [
      { id: chat, title: "new chat", status: "idle", shown: true },
      { id: "s", title: "sentinel", status: "idle", shown: false, role: "sentinel" },
    ]);
    await transcript(app, window, [
      { customType: "turri_sentinel_concluded", data: { job: "j-backend-3", verdict: "holds", summary: "it saves and lists messages", module: "backend", pulse: 3 } },
      { customType: "turri_sentinel_concluded", data: { job: "j-frontend-2", verdict: "wrong", summary: "the send button does nothing", module: "frontend", pulse: 2 } },
    ]);
    const lines = window.locator(".msg.concluded");
    await expect(lines.nth(0)).toHaveClass(/holds/);
    await expect(lines.nth(0).locator(".concluded-head")).toHaveText("sentinel · backend");
    await expect(lines.nth(0)).not.toContainText("it saves and lists messages");
    await expect(lines.nth(1).locator(".concluded-head")).toHaveText("sentinel · frontend · found something wrong");
    await expect(lines.nth(1)).toContainText("the send button does nothing");
    // Its name a link to what it did, the pulse a link to it - both in regen.
    await expect(lines.nth(0).getByRole("button", { name: "sentinel" })).toBeEnabled();
    await lines.nth(0).getByRole("button", { name: "backend", exact: true }).click();
    // A pulse the ledger does not have - this one is made up - is said so, rather than opened.
    await expect(window.getByText("that pulse ran in an earlier session")).toBeVisible();
  });

  test("shows what the sentinel did of each pulse in that pulse's card in regen, opened from a conclusion's sentinel", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const tell = (event: string, to: string, data: unknown) => app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0]!.webContents.send(`engine:${sent.event}`, { chat: sent.to, data: sent.data }), { event, to, data });
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    await send("engine:chats", [
      { id: chat, title: "new chat", status: "idle", shown: true },
      { id: "s", title: "sentinel", status: "working", shown: false, role: "sentinel" },
    ]);
    await send("engine:job", pulse("j1", "the greeting by name", 1));
    await send("engine:job", pulse("j2", "a farewell", 2));
    // The sentinel's chat, as it goes: turri's brief of each pulse, then what it did of it - the second still going.
    const said = [
      { role: "sentinelPulse", job: "j1" },
      { role: "assistant", text: "Trying the greeter in the terminal.", tools: [{ id: "t1", name: "terminal_run", args: { command: "hello Ana" } }] },
      { role: "toolResult", id: "t1", name: "terminal_run", text: "hello, Ana", isError: false },
      { role: "assistant", text: "", tools: [{ id: "c1", name: "conclude", args: { pulse: "j1", verdict: "holds", summary: "it greets by name" } }] },
      { role: "toolResult", id: "c1", name: "conclude", text: "The chat the person is in is told.", isError: false },
      { role: "sentinelPulse", job: "j2" },
      { role: "assistant", text: "Now the farewell." },
    ];
    for (const item of said) await tell("chat:message", "s", item);
    await tell("chat:busy", "s", { busy: true });
    await transcript(app, window, [{ customType: "turri_sentinel_concluded", data: { job: "j1", verdict: "holds", summary: "it greets by name", module: "hello", pulse: 1 } }]);
    await window.locator(".msg.concluded").getByRole("button", { name: "sentinel" }).click();

    // The dive, the pulse's card open on what the sentinel did of it - and only of it.
    const card = window.locator(".dive .job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
    const part = card.locator(".job-sentinel");
    await expect(part.locator(".part-head")).toHaveAttribute("aria-expanded", "true");
    await expect(part.locator(".part-summary")).toHaveText("checked, it holds");
    await expect(part.locator(".sentinel-conclusion")).toHaveText("it greets by name");
    await expect(part.locator(".transcript-read")).toContainText("Trying the greeter in the terminal.");
    await expect(part.locator(".transcript-read")).not.toContainText("Now the farewell.");
    // Read only: nothing to type into.
    await expect(window.locator(".dive textarea")).toHaveCount(0);
    // The other, still being checked: its eye a spinner, and its part says so.
    const other = window.locator(".dive .job", { hasText: "a farewell" });
    await expect(other.locator(".job-sentinel-mark .spinner")).toBeVisible();
    await other.locator(".job-head").click();
    await other.locator(".job-sentinel .part-head").click();
    await expect(other.locator(".job-sentinel .part-summary")).toHaveText("checking it");
    await expect(other.locator(".transcript-read")).toContainText("Now the farewell.");
  });

  test("has no tab: the chat's tabs are the person's alone", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    await app.evaluate(({ BrowserWindow }, chats) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chats", chats), [
      { id: "s", title: "sentinel", status: "working", shown: false, role: "sentinel" },
      { id: chat, title: "new chat", status: "idle", shown: true },
    ]);
    const tabs = window.locator(".chat-tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.locator(".chat-tab-title")).toHaveText("new chat");
    // The person's only chat: nothing to close.
    await expect(tabs.locator(".chat-tab-close")).toHaveCount(0);
  });

  test("is a setting of the project's, turned off through /turri-config, and has a model of its own", async ({ launched: { app, window, project } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    await window.locator(".chat-model").waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "project-settings"));
    const sheet = window.getByRole("dialog", { name: "project settings" });
    // Each role's model is folded away until asked for: found, as the person would find it.
    await sheet.getByRole("searchbox", { name: "find a setting" }).fill("sentinel");
    await expect(sheet.getByRole("combobox", { name: "models.sentinel", exact: true })).toBeVisible();
    // A choice: asked before it first opens, on without asking, or off.
    const sentinel = sheet.getByRole("combobox", { name: "sentinel", exact: true });
    // Unset, the person is asked.
    await expect(sentinel).toHaveValue("");
    await expect(sentinel.locator("option:checked")).toHaveText("unset - ask");
    await sentinel.selectOption("false");
    await expect(window.locator(".chat-body")).toContainText("sentinel: false - written to config.turri.yaml");
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^sentinel: false$/m);
    await expect(sentinel).toHaveValue("false");
  });

  test("refuses a notice's answer of no shape it has", async ({ launched: { window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const tried = (answer: unknown) =>
      window.evaluate(
        (given) =>
          (window as unknown as { turri: { call: (method: string, params: unknown) => Promise<unknown> } }).turri.call("answerNotice", { id: "n1", answer: given }).then(
            (did) => String(did),
            (error: Error) => error.message,
          ),
        answer,
      );
    expect(await tried({ action: "rm -rf" })).toContain("A notice is answered with one of its actions");
    expect(await tried({ steer: "" })).toContain("A notice is answered with one of its actions");
    expect(await tried({ dismiss: true, action: 0 })).toContain("A notice is answered with one of its actions");
    // One of its shapes reaches turri, which has no such notice.
    expect(await tried({ dismiss: true })).toBe("missing");
  });
});
