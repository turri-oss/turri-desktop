import type { ElectronApplication, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryItem } from "../engine/entries.mjs";
import { expect, tellChat, test } from "./app.ts";

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

/** The answers the window gives notices, as the main process is asked them: each answered `done`, and kept here. */
async function answersTaken(app: ElectronApplication): Promise<() => Promise<unknown[]>> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
    const real = handlers.get("engine:call")!;
    const taken: unknown[] = [];
    (globalThis as unknown as { taken: unknown[] }).taken = taken;
    handlers.set("engine:call", (event, method, params) => {
      if (method !== "answerNotice") return real(event, method, params);
      taken.push(params);
      return "done";
    });
  });
  return () => app.evaluate(() => (globalThis as unknown as { taken: unknown[] }).taken);
}

test.describe("the sentinel", () => {
  test("maps turri's notice, its ending and a conclusion from the transcript", () => {
    const put = notice("1");
    expect(entryItem({ type: "custom", customType: "turri_notice", data: put })).toEqual({ role: "notice", notice: put });
    expect(entryItem({ type: "custom", customType: "turri_notice_over", data: { state: "dismissed", summary: put.summary } })).toEqual({ role: "noticeOver", state: "dismissed", summary: put.summary });
    const conclusion = { job: "j-backend-3", verdict: "holds", summary: "the guestbook saves and lists messages", module: "backend", pulse: 3 };
    expect(entryItem({ type: "custom", customType: "turri_sentinel_concluded", data: conclusion })).toEqual({ role: "concluded", conclusion });
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

  test("draws a notice as a card in the chat, its actions as buttons that answer it", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const answers = await answersTaken(app);
    await transcript(app, window, [{ customType: "turri_notice", data: notice(chat) }]);
    await tellChat(app, window, "chat:notice", notice(chat));

    const card = window.getByRole("region", { name: "notice: the guestbook does not save a message" });
    await expect(card.locator(".notice-about")).toHaveText("sentinel · backend · pulse 3");
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
    await tellChat(app, window, "chat:notice", notice(chat, { id: "n2" }));

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

  test("says how a notice of the transcript ended, with nothing to press", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    await transcript(app, window, [
      { customType: "turri_notice", data: notice(chat) },
      { customType: "turri_notice_over", data: { state: "superseded", summary: "the guestbook does not save a message" } },
      { customType: "turri_notice", data: notice(chat, { id: "n2", severity: "warning", summary: "the list is not newest first" }) },
      { customType: "turri_notice_over", data: { state: "steered", summary: "the list is not newest first" } },
    ]);
    const first = window.getByRole("region", { name: "notice: the guestbook does not save a message" });
    await expect(first.locator(".notice-ended")).toHaveText("superseded by a newer notice");
    await expect(first.getByRole("button")).toHaveCount(0);
    await expect(window.getByRole("region", { name: "notice: the list is not newest first" }).locator(".notice-ended")).toHaveText("answered in your words");
  });

  test("shows the sentinel's conclusions as a line - what it found only when something is wrong - linking its chat and the pulse", async ({ launched: { app, window } }) => {
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
    await expect(lines.nth(0).locator(".concluded-head")).toHaveText("sentinel · backend · pulse 3");
    await expect(lines.nth(0)).not.toContainText("it saves and lists messages");
    await expect(lines.nth(1).locator(".concluded-head")).toHaveText("sentinel · frontend · pulse 2 · found something wrong");
    await expect(lines.nth(1)).toContainText("the send button does nothing");
    // Its name a link to the sentinel's chat, the pulse a link to regen.
    await expect(lines.nth(0).getByRole("button", { name: "sentinel" })).toBeEnabled();
    await lines.nth(0).getByRole("button", { name: "backend · pulse 3" }).click();
    // A pulse the ledger does not have - this one is made up - is said so, rather than opened.
    await expect(window.getByText("that pulse ran in an earlier session")).toBeVisible();
  });

  test("opens the sentinel's chat at what it said of the pulse, from a conclusion's sentinel - not at its end", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    const chats = (shown: string) => [
      { id: chat, title: "new chat", status: "idle", shown: shown === chat },
      { id: "s", title: "sentinel", status: "idle", shown: shown === "s", role: "sentinel" },
    ];
    const tell = (event: string, to: string, data: unknown) => app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0]!.webContents.send(`engine:${sent.event}`, { chat: sent.to, data: sent.data }), { event, to, data });
    await app.evaluate(({ BrowserWindow }, told) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chats", told), chats(chat));
    // The sentinel's chat, as it goes: a pulse checked and concluded, what it found said after, then much more.
    const filler = (n: number) => ({ role: "assistant", text: `checking pulse ${n}.\n\n${"what it ran and saw. ".repeat(40)}` });
    const said = [
      filler(1),
      filler(2),
      { role: "assistant", text: "", tools: [{ id: "c3", name: "conclude", args: { pulse: "j-backend-3", verdict: "holds", summary: "it saves" } }] },
      { role: "toolResult", id: "c3", name: "conclude", text: "The chat the person is in is told.", isError: false },
      { role: "assistant", text: "Pulse j-backend-3 holds. I ran the release and it saves and lists messages." },
      ...[4, 5, 6, 7, 8, 9].map(filler),
    ];
    for (const item of said) await tell("chat:message", "s", item);
    await transcript(app, window, [{ customType: "turri_sentinel_concluded", data: { job: "j-backend-3", verdict: "holds", summary: "it saves", module: "backend", pulse: 3 } }]);
    await window.locator(".msg.concluded").getByRole("button", { name: "sentinel" }).click();
    // The engine shows it, as turri tells it has.
    await app.evaluate(({ BrowserWindow }, told) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chats", told), chats("s"));
    const summary = window.locator(".chat-anchor").getByText("Pulse j-backend-3 holds.");
    await expect(summary).toBeInViewport();
    await expect(window.getByText("checking pulse 9.")).not.toBeInViewport();
  });

  test("draws the sentinel's tab last, by its eye - closable, while the person's only chat is not", async ({ launched: { app, window } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    const chat = await shownChat(window);
    // As turri tells of its chats: the sentinel opened between the person's - it is drawn after them all the same.
    await app.evaluate(({ BrowserWindow }, chats) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chats", chats), [
      { id: "s", title: "sentinel", status: "working", shown: false, role: "sentinel" },
      { id: chat, title: "new chat", status: "idle", shown: true },
    ]);
    const tabs = window.locator(".chat-tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.last()).toHaveClass(/sentinel/);
    await expect(tabs.last().locator(".chat-tab-eye")).toBeVisible();
    await expect(tabs.last().locator(".chat-tab-title")).toHaveText("sentinel");
    // Working: its spinner beside its eye, as any chat's.
    await expect(tabs.last().locator(".spinner")).toBeVisible();
    await expect(tabs.last().getByRole("button", { name: "close sentinel" })).toBeVisible();
    await expect(tabs.first().locator(".chat-tab-close")).toHaveCount(0);
    // Never shown by itself: the person's chat stays the one shown.
    await expect(tabs.first().getByRole("tab")).toHaveAttribute("aria-selected", "true");
  });

  test("is a setting of the project's, turned off through /turri-config, and has a model of its own", async ({ launched: { app, window, project } }) => {
    test.skip(!(await hasSentinel(window)), "the turri running has no sentinel");
    await window.locator(".chat-model").waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "project-settings"));
    const sheet = window.getByRole("dialog", { name: "project settings" });
    // Each role's model is folded away until asked for: found, as the person would find it.
    await sheet.getByRole("searchbox", { name: "find a setting" }).fill("sentinel");
    await expect(sheet.getByRole("combobox", { name: "models.sentinel", exact: true })).toBeVisible();
    const sentinel = sheet.getByRole("switch", { name: "sentinel", exact: true });
    // Unset, it is on.
    await expect(sentinel).toHaveAttribute("aria-checked", "true");
    await sentinel.click();
    await expect(window.locator(".chat-body")).toContainText("sentinel: false - written to config.turri.yaml");
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^sentinel: false$/m);
    await expect(sentinel).toHaveAttribute("aria-checked", "false");
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
