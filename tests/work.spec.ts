import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { clickMenu, expect, leaveRegen, offers, showRegen, tellChat, test } from "./app.ts";

/** A pulse as the engine sends it, done: it rendered one line of hello.plain, its functional specs' second. */
const pulse = () => ({
  id: "p1",
  kind: "regenerate",
  summary: "hello: the greeting by name",
  module: "hello",
  pulse: 1,
  title: "the greeting by name",
  diff: "diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ -13,1 +13,2 @@\n ***functional specs***\n+- :Greeter: prints \"hello, world\" and exits with 0.\n",
  diffWhere: { 4: { file: "hello.plain", line: 13 }, 5: { file: "hello.plain", line: 15 } },
  status: "succeeded",
  sequence: 1,
  queuedAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now(),
  waitingOn: [],
  activity: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  agents: [],
  specGaps: [],
  failures: [],
});

/** A pulse's card opened, by its head. */
async function opened(card: Locator): Promise<Locator> {
  await card.locator(".job-head").click();
  await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
  return card;
}

/** A part of an open card unfolded by its line - its ***plain (by its file's name), trace, report, gaps or failure. */
async function unfold(card: Locator, part: string): Promise<Locator> {
  const head = card.locator(".part-head", { hasText: part });
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return card;
}

/**
 * A pulse that rendered repos.plain's two functional specs, its card opened on them in regen - since when a definition
 * was added above them, so they are two lines further down now.
 */
async function reposPulse({ app, window, project }: { app: ElectronApplication; window: Page; project: string }): Promise<Locator> {
    // Since the pulse ran, a definition was added above what it rendered: its lines are two further down now.
    writeFileSync(
      join(project, "repos.plain"),
      "---\ndescription: Repos.\n---\n\n***definitions***\n\n- :Repo: is a store.\n\n- :Owner: is who owns a :Repo:.\n\n***implementation reqs***\n\n- :Implementation: is in Java.\n\n***functional specs***\n\n- An :Owner: creates a :Repo:.\n  - A missing token returns `401`.\n\n- An :Owner: lists their :Repo: items.\n  - A missing token returns `401`.\n",
    );
    await expect(window.locator(".tree-row", { hasText: "repos.plain" })).toBeVisible();
    const diff = [
      "diff --git a/repos.plain b/repos.plain",
      "--- a/repos.plain",
      "+++ b/repos.plain",
      "@@ @@",
      " ***functional specs***",
      "+- An :Owner: creates a :Repo:.",
      "+  - A missing token returns `401`.",
      "+- An :Owner: lists their :Repo: items.",
      "+  - A missing token returns `401`.",
    ].join("\n");
    const where = Object.fromEntries([13, 15, 16, 18, 19].map((line, at) => [at + 4, { file: "repos.plain", line }]));
    const job = { ...pulse(), id: "p2", module: "repos", summary: "repos: create and list", title: "create and list", diff, diffWhere: where };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    await showRegen(window);
    return unfold(await opened(window.locator(".job", { hasText: "create and list" })), "repos.plain");
}

test.describe("the regen view", () => {
  test("shows each pulse closed, to its head, and opens and closes it on a click", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      report: "The greeter now greets by name.",
      specGaps: [{ question: "What if no name is given?", assumption: "it greets the world" }],
    });
    await showRegen(window);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    const head = card.locator(".job-head");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
    await expect(card.locator(".job-report")).toHaveCount(0);
    // Open: a line for each part of it - its ***plain, its gaps - each closed until it is unfolded. Its report is for
    // debugging turri: with debug off, not shown.
    await head.click();
    await expect(card.locator(".part-head")).toHaveText([/^regenerated.*hello\.plain$/, /1.*plain gap/]);
    await expect(card.locator(".part-head[aria-expanded=true]")).toHaveCount(0);
    await expect(card.locator(".pulse-spec-lines")).toHaveCount(0);
    await unfold(card, "hello.plain");
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    await unfold(card, "gap");
    await expect(card.locator(".gaps")).toContainText("What if no name is given?");
    // Unfolded, a part folds again by its line.
    await card.locator(".part-head", { hasText: "gap" }).click();
    await expect(card.locator(".gaps")).toHaveCount(0);
    // From the keyboard too, and closed again.
    await head.focus();
    await window.keyboard.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
  });

  test("traces a running pulse with debug off, and has no trace once it has ended", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (job: object) => app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    const running = {
      ...pulse(),
      status: "running",
      finishedAt: undefined,
      now: { label: "waiting for the model", since: Date.now() - 9_000 },
      activity: ["read hello.plain"],
      agents: [{ label: "coder", turns: 1, compactions: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }],
    };
    await send(running);
    await showRegen(window);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    // Closed, its head says nothing of what it is on now.
    await expect(card).not.toContainText("waiting for the model");
    await opened(card);
    await expect(card.locator(".part-head", { hasText: "agent trace" })).toHaveCount(1);
    await send({ ...running, status: "succeeded", finishedAt: Date.now() });
    await expect(card).toHaveClass(/\bsucceeded\b/);
    await expect(card.locator(".part-head", { hasText: "agent trace" })).toHaveCount(0);
    await expect(card.locator(".agent-chip")).toHaveCount(0);
  });

  test("heads a pulse by its module and kind, not its number", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await showRegen(window);
    await expect(window.locator(".job", { hasText: "the greeting by name" }).locator(".job-title .muted")).toHaveText("hello · regenerate");
    expect(await window.locator(".job-title .muted").first().evaluate((element) => element.textContent)).toBe("hello\u00a0 · regenerate");
  });

  test("folds a running pulse's trace - its steps and agents - and what failed that it went on past", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const usage = { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.01 };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      status: "running",
      finishedAt: undefined,
      now: { label: "writing the greeter", since: Date.now() - 5_000 },
      activity: ["read hello.plain", "wrote greeter.py"],
      agents: [{ label: "coder", turns: 3, compactions: 0, usage }],
      failures: [{ mark: "debugger failed", text: "The debugger could not start." }],
    });
    await showRegen(window);
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    const trace = card.locator(".part-head", { hasText: "agent trace" });
    // Its line says no more than that it is there: not the stage the pulse is at.
    await expect(trace).toHaveText("agent trace");
    await expect(card.locator(".activity")).toHaveCount(0);
    await unfold(card, "agent trace");
    await expect(card.locator(".activity li")).toHaveText(["read hello.plain", "wrote greeter.py"]);
    await expect(card.locator(".agent-chip")).toContainText("coder · 3 turns");
    await expect(card.locator(".part-head", { hasText: "failure" })).toContainText("debugger failed");
    await expect(card.locator(".failure-mark")).toHaveCount(0);
    await unfold(card, "failure");
    await expect(card.locator(".failure-mark")).toHaveText("debugger failed");
  });

  test("traces an agent turri gave no label - its release agent - as an agent", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const usage = { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.01 };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      status: "running",
      finishedAt: undefined,
      activity: ["releasing what this pulse landed"],
      agents: [
        { label: "coder", turns: 3, compactions: 0, usage },
        { model: "haiku", turns: 1, compactions: 0, usage },
      ],
    });
    await showRegen(window);
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    await unfold(card, "agent trace");
    await expect(card.locator(".agent-chip")).toHaveCount(2);
    await expect(card.locator(".agent-chip").nth(1)).toContainText("agent · 1 turn");
  });

  test("shows regen on a screen of its own - no chat, no views, no files - from the dive button, ⌘2 or the chat, and goes back to the project's window", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // Not among the views.
    const tabs = window.locator(".toolbar").getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(window.locator(".toolbar").getByRole("tab", { name: "regen" })).toHaveCount(0);
    // ctrl+tab goes along the two.
    await window.locator(".editor-pane textarea").first().click();
    await window.keyboard.press("Control+Tab");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Tab");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    // The dive: none of the window.
    await showRegen(window);
    await expect(window.locator(".dive-mark")).toHaveAttribute("aria-label", "dive");
    for (const gone of [".chat-model", ".toolbar", ".sidebar"]) await expect(window.locator(gone)).toBeHidden();
    await expect(window.locator(".dive .dive-back")).toContainText("hello");
    await leaveRegen(window);
    await expect(window.locator(".chat-model")).toBeVisible();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    // ⌘2, and again back: the menu's Dive.
    await clickMenu(app, "Dive");
    await expect(window.locator(".dive")).toBeVisible();
    await clickMenu(app, "Dive");
    await expect(window.locator(".dive")).toHaveCount(0);
    // A view chosen from the menu leaves it too.
    await clickMenu(app, "Dive");
    await clickMenu(app, "preview");
    await expect(window.locator(".dive")).toHaveCount(0);
    await expect(window.locator(".toolbar").getByRole("tab", { name: "preview", selected: true })).toBeVisible();
  });

  test("opens what a pulse clicked in the chat built in the ***plain, lit - as a click on its lines in regen does", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await tellChat(app, window, "chat:message", { role: "job", id: "p1", summary: "hello: the greeting by name", status: "succeeded", duration: "1m" });
    await window.locator(".toolbar").getByRole("tab", { name: "preview" }).click();
    // Said as plainly as it gets: its module, and that it finished - no time, cost or status word.
    await expect(window.locator(".job-note-head")).toHaveText("hello · regeneration finished");
    await window.locator(".job-note-head").click();
    await expect(window.locator(".dive")).toHaveCount(0);
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(window.locator(".editor-colours > div.revealed")).toContainText('prints "hello, world"');
  });

  test("says a conformance run's end as validation", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), id: "c1", kind: "conformance" });
    await tellChat(app, window, "chat:message", { role: "job", id: "c1", summary: "hello: conformance tests", status: "succeeded", duration: "2m", spent: "$0.04" });
    await expect(window.locator(".job-note-head")).toHaveText("hello · validation finished");
    await expect(window.locator(".msg.job-note")).toHaveClass(/conformance/);
  });

  test("opens a pulse clicked in the chat that went wrong in regen, to see why", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), status: "failed", error: "the tests failed" });
    await tellChat(app, window, "chat:message", { role: "job", id: "p1", summary: "hello: the greeting by name", status: "failed", duration: "1m" });
    await expect(window.locator(".job-note-head")).toHaveText("hello · regeneration failed");
    await window.locator(".job-note-head").click();
    await expect(window.locator(".dive").getByRole("tab", { name: "regen", selected: true })).toBeVisible();
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".part-head", { hasText: "hello.plain" })).toHaveAttribute("aria-expanded", "false");
  });

  test("turns a spinner in regen's tab while a pulse runs", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await showRegen(window);
    const send = (job: object) => app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    const tab = window.locator(".dive").getByRole("tab", { name: /^regen/ });
    await expect(tab.locator(".spinner")).toHaveCount(0);
    await send({ ...pulse(), kind: "conformance", status: "running", finishedAt: undefined });
    await expect(tab.locator(".spinner")).toBeVisible();
    await send(pulse());
    await expect(tab.locator(".spinner")).toHaveCount(0);
  });

  test("marks the dive button with ! when a pulse fails, and regen shown, opens that pulse once, in view and focused", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (job: object) => app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    const button = window.locator(".toolbar .dive-open");
    await send({ ...pulse(), status: "running", finishedAt: undefined });
    await send({ ...pulse(), id: "p2", title: "a later one", summary: "hello: a later one", sequence: 2, queuedAt: Date.now() });
    await expect(button.locator(".tab-failed")).toHaveCount(0);
    await send({ ...pulse(), status: "failed", error: "the tests failed" });
    await expect(button.locator(".tab-failed")).toHaveText("!");
    await showRegen(window);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".job-head")).toBeFocused();
    await expect(window.locator(".job", { hasText: "a later one" }).locator(".job-head")).toHaveAttribute("aria-expanded", "false");
    // A pulse failing while regen is shown: it is in view, so the dive button is not marked.
    await send({ ...pulse(), id: "p3", title: "a third one", summary: "hello: a third one", status: "failed", sequence: 3, queuedAt: Date.now() });
    await expect(window.locator(".job", { hasText: "a third one" })).toBeVisible();
    // Once: closed, and regen shown again, it stays closed.
    await card.locator(".job-head").click();
    await leaveRegen(window);
    await expect(button.locator(".tab-failed")).toHaveCount(0);
    await showRegen(window);
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "false");
  });

  test("lists every pulse the newest first - this session's queued, running and done, and each earlier run and its pulses", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    const now = Date.now();
    // Sent oldest first; the last two from an engine started again, numbered from 1 again.
    await send("engine:job", { ...pulse(), id: "a", title: "first done", sequence: 1, queuedAt: now - 50_000 });
    await send("engine:job", { ...pulse(), id: "b", title: "second done", sequence: 2, queuedAt: now - 40_000 });
    await send("engine:job", { ...pulse(), id: "c", title: "third running", status: "running", finishedAt: undefined, sequence: 1, queuedAt: now - 30_000 });
    await send("engine:job", { ...pulse(), id: "d", title: "fourth queued", status: "queued", startedAt: undefined, finishedAt: undefined, sequence: 2, queuedAt: now - 20_000 });
    // The ledger's runs and their pulses oldest first, as a turri may give them.
    const past = (id: string, title: string, minutes: number) => ({ id, run: "r", kind: "regenerate", summary: title, module: "hello", pulse: 1, title, status: "succeeded", landed: true, stoppedBy: null, ms: 1000, usage: null, error: null, failures: [], queued: new Date(now - minutes * 60_000).toISOString() });
    const run = (id: string, minutes: number, pulses: unknown[]) => ({ run: id, mode: "host", started: new Date(now - minutes * 60_000).toISOString(), version: "0.1.18", pulses });
    await send("engine:earlier", [run("r1", 300, [past("o1", "older run first", 299), past("o2", "older run second", 298)]), run("r2", 120, [past("n1", "newer run first", 119), past("n2", "newer run second", 118)])]);
    await showRegen(window);
    await expect(window.locator(".job:not(.past) .job-title strong")).toHaveText(["fourth queued", "third running", "second done", "first done"]);
    await expect(window.locator(".job.past .job-title strong")).toHaveText(["newer run second", "newer run first", "older run second", "older run first"]);
  });

  test("shows what a pulse renders in its card, and opens that in the ***plain view", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await showRegen(window);
    // In the card itself, nothing to open: no panel beside it, and no conversation - and its lines, unfolded, open in the ***plain.
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    await expect(card.locator(".opens-in-plain")).toHaveCount(0);
    await unfold(card, "hello.plain");
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    await card.locator(".job-body").click({ position: { x: 4, y: 4 } });
    await expect(window.locator(".transcript")).toHaveCount(0);
    await expect(window.getByRole("tab", { name: "conversation" })).toHaveCount(0);
    await card.locator(".opens-in-plain").click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
  });

  test("offers to open a pulse's lines in the ***plain only while they are still there", async ({ launched: { app, window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    // A pulse on a ***plain file that is no longer the project's: nothing to open.
    const gone = pulse();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...gone,
      id: "p2",
      summary: "gone: a file since removed",
      title: "a file since removed",
      diff: gone.diff.replaceAll("hello.plain", "gone.plain"),
      diffWhere: { 4: { file: "gone.plain", line: 13 }, 5: { file: "gone.plain", line: 15 } },
    });
    await showRegen(window);
    const card = await unfold(await opened(window.locator(".job", { hasText: "the greeting by name" })), "hello.plain");
    const open = card.locator(".opens-in-plain");
    await expect(open).toBeVisible();
    const removed = await unfold(await opened(window.locator(".job", { hasText: "a file since removed" })), "gone.plain");
    await expect(removed.locator(".pulse-spec-lines")).toContainText("hello, world");
    await expect(removed.locator(".opens-in-plain")).toHaveCount(0);
    // Its line edited away since: the button goes.
    const file = join(project, "hello.plain");
    writeFileSync(file, readFileSync(file, "utf8").replace('prints "hello, world" and exits with 0.', "prints a greeting."));
    await expect(open).toHaveCount(0);
  });

  test("lights a functional spec a pulse carries unchanged as what it builds, beside one it adds", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // turri's diff of a pulse that writes fs 1's tests again and adds fs 2's: fs 1 carried as it is, as context.
    const diff = `diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ @@\n ***functional specs***\n - :Greeter: prints "hello, world" and exits with 0.\n+- :Greeter: waves.\n`;
    const diffWhere = { 4: { file: "hello.plain", line: 13 }, 5: { file: "hello.plain", line: 15 }, 6: { file: "hello.plain", line: 17 } };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), kind: "conformance", diff, diffWhere });
    await showRegen(window);
    const rows = (await unfold(await opened(window.locator(".job", { hasText: "the greeting by name" })), "hello.plain")).locator(".pulse-spec-lines > div");
    await expect(rows.filter({ hasText: "hello, world" })).toHaveClass(/\badd\b.*\bagain\b/);
    await expect(rows.filter({ hasText: "waves." })).toHaveClass("add");
    await expect(rows.filter({ hasText: "***functional specs***" })).toHaveClass("context");
  });

  test("keeps a long ***plain change within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const added = Array.from({ length: 80 }, (_, at) => `+- :Greeter: greets visitor ${at + 1}.`);
    const diff = `diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ -13,1 +13,${added.length + 1} @@\n ***functional specs***\n${added.join("\n")}\n`;
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), diff, diffWhere: {} });
    await showRegen(window);
    const lines = (await unfold(await opened(window.locator(".job", { hasText: "the greeting by name" })), "hello.plain")).locator(".pulse-spec-lines");
    await expect(lines).toContainText("greets visitor 80.");
    const box = await lines.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
    await lines.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => lines.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("goes along the views with ctrl+tab and ctrl+shift+tab while the focus is in them, and the chats while it is in the chat", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const tab = (name: string) => window.locator(".toolbar").getByRole("tab", { name, exact: true });
    await window.locator(".editor-pane textarea").first().click();
    await window.keyboard.press("Control+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
    // Round from the ends.
    await window.keyboard.press("Control+Tab");
    await expect(tab("***plain")).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Shift+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
    // In the chat, ctrl+tab is the chats': the view stays.
    await window.locator(".composer textarea").click();
    await window.keyboard.press("Control+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
  });

  test("moves the focus to the chat with ⌥⌘← and to the view shown with ⌥⌘→", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    const box = window.locator(".composer textarea");
    await box.click();
    await window.keyboard.press(`${mod}+Alt+ArrowRight`);
    await expect(window.locator(".editor-pane textarea").first()).toBeFocused();
    await window.keyboard.press(`${mod}+Alt+ArrowLeft`);
    await expect(box).toBeFocused();
    // From the dive, ⌥⌘← goes back to the chat.
    await showRegen(window);
    await window.keyboard.press(`${mod}+Alt+ArrowLeft`);
    await expect(window.locator(".dive")).toHaveCount(0);
    await expect(box).toBeFocused();
  });

  test("says a codebase is built from ***plain as it is, never the spec", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const status = { modules: [{ module: "hello", plainFile: "hello.plain", planned: [], why: "built from the spec as it is" }], jobs: [] };
    await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:status", data), status);
    await showRegen(window);
    const head = window.locator(".module-plan-head", { hasText: "hello" });
    await expect(head).toContainText("built from");
    await expect(head).not.toContainText("from the");
    await expect(head).toContainText("plain as it is");
    await expect(head).not.toContainText("spec");
  });

  test("keeps a failed pulse's long diagnosis within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const diagnosis = Array.from({ length: 60 }, (_, at) => `Cause ${at + 1}: the greeter was not found.`).join("\n");
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), status: "failed", diagnosis });
    await showRegen(window);
    // Failed while regen was not shown: shown, it is open already - and its failure folded, until unfolded.
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".diagnosis")).toHaveCount(0);
    const text = (await unfold(card, "failure")).locator(".diagnosis > div");
    await expect(text).toContainText("Cause 60");
    const box = await text.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
  });

  test("finds a pulse's lines where they are now, and shows the blank line between two of its functional specs", async ({ launched: { app, window, project } }) => {
    const card = await reposPulse({ app, window, project });

    // Two functional specs, and the blank lines turri's diff leaves out - after the section's header, and between them -
    // drawn, numbered.
    const panel = card.locator(".pulse-spec-lines > div");
    await expect(panel.nth(1)).toHaveText("14​");
    await expect(panel.nth(4)).toHaveText("17​");
    await expect(panel.nth(5)).toContainText("lists their :Repo: items");

    // Both lit in the ***plain view, where they are now - not where they were.
    await card.locator(".opens-in-plain").click();
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    // In the highlighter's tan - where the click took the person - not the pink of what is being built.
    await expect(line(16)).toHaveClass(/revealed/);
    await expect(line(19)).toHaveClass(/revealed/);
    await expect(line(16)).not.toHaveClass(/rendering/);
    await expect(line(12)).not.toHaveClass(/revealed/);
    await expect(line(14)).not.toHaveClass(/revealed/);

    // Lit once: back to regen and to the ***plain view again, nothing is.
    await showRegen(window);
    await leaveRegen(window);
    await expect(window.locator(".editor-pane .pane-header")).toContainText("repos.plain");
    await expect(line(16)).toBeVisible();
    // Looked at once, a moment in: lines lit again would stay so for seconds, and a retrying expect would wait them out.
    await window.waitForTimeout(600);
    expect(await window.locator(".editor-colours .revealed").count()).toBe(0);
  });

  test("shows each file a pulse's ***plain comes from on its own line - its module's, and what it takes from the standard library", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // As turri gives it: the ***plain the pulse renders, under its module's file, and where each line of it is.
    const diff = [
      "diff --git a/hello.plain b/hello.plain",
      "--- a/hello.plain",
      "+++ b/hello.plain",
      "@@ @@",
      " ***definitions***",
      "+- :Greeter: is the command-line tool.",
      "@@ @@",
      " ***implementation reqs***",
      "+- :Implementation: is written in Python.",
      "+- :Implementation: manages dependencies with uv.",
      "+- :Implementation: greets in English.",
      "@@ @@",
      " ***test reqs***",
      "+- :ConformanceTests: run with pytest.",
      "@@ @@",
      " ***functional specs***",
      "+- :Greeter: prints hello.",
    ].join("\n");
    const diffWhere = {
      4: { file: "hello.plain", line: 7 },
      5: { file: "hello.plain", line: 9 },
      8: { file: "stdlib/lang/python.plain", line: 7 },
      9: { file: "stdlib/lang/python.plain", line: 8 },
      10: { file: "hello.plain", line: 13 },
      // A section of the module's whose lines are all the standard library's: its header placed in the module's file.
      12: { file: "hello.plain", line: 15 },
      13: { file: "stdlib/lang/python.plain", line: 11 },
      15: { file: "hello.plain", line: 17 },
      16: { file: "hello.plain", line: 19 },
    };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), diff, diffWhere });
    await showRegen(window);
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    await expect(card.locator(".part-head")).toHaveText([/^regenerated.*hello\.plain$/, /^regenerated.*stdlib\/lang\/python\.plain$/]);
    // Its module's own lines, each section headed - and nothing of the standard library's.
    await unfold(card, "hello.plain");
    const own = card.locator(".pulse-spec-lines").first();
    await expect(own).toContainText("greets in English");
    await expect(own).toContainText("***implementation reqs***");
    await expect(own).not.toContainText("written in Python");
    // A section none of whose lines are the module's own is not headed in it.
    await expect(own).not.toContainText("***test reqs***");
    // The standard library's, under the section they are in, numbered as they are in its file.
    await unfold(card, "python.plain");
    const taken = card.locator(".pulse-spec-lines").nth(1).locator("> div");
    await expect(taken).toHaveText([/^\*\*\*implementation reqs\*\*\*$/, /^7.*written in Python\.$/, /^8.*uv\.$/, "⋯", /^\*\*\*test reqs\*\*\*$/, /^11.*pytest\.$/]);
  });

  test("opens a template's lines the pulse rendered as its file, named in the title, the caret on the line clicked", async ({ launched: { app, window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    mkdirSync(join(project, "template"), { recursive: true });
    writeFileSync(join(project, "template", "greeter_stack.plain"), "***implementation reqs***\n\n- :Implementation: is written in Python.\n\n- :Implementation: manages dependencies with uv.\n");
    const diff = ["diff --git a/hello.plain b/hello.plain", "--- a/hello.plain", "+++ b/hello.plain", "@@ @@", " ***implementation reqs***", "+- :Implementation: is written in Python.", "+- :Implementation: manages dependencies with uv."].join("\n");
    const diffWhere = { 4: { file: "template/greeter_stack.plain", line: 1 }, 5: { file: "template/greeter_stack.plain", line: 3 }, 6: { file: "template/greeter_stack.plain", line: 5 } };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), diff, diffWhere });
    await showRegen(window);
    const card = await unfold(await opened(window.locator(".job", { hasText: "the greeting by name" })), "greeter_stack.plain");
    await card.locator(".pulse-spec-lines > div", { hasText: "uv." }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".pane-title")).toHaveText(/template\/greeter_stack\.plain$/);
    await expect
      .poll(() => window.locator(".editor-pane textarea").evaluate((area: HTMLTextAreaElement) => document.activeElement === area && area.value.slice(0, area.selectionStart).split("\n").length))
      .toBe(5);
  });

  test("puts the caret in the ***plain on the line clicked in a pulse's ***plain, where it is now - a blank one too, and one taken out since", async ({ launched: { app, window, project } }) => {
    const card = await reposPulse({ app, window, project });
    const rows = card.locator(".pulse-spec-lines > div");
    // The caret's line in the editor, and the line after it - as the editor shows them, a functional spec folded or not.
    const caret = () =>
      window.locator(".editor-pane textarea").evaluate((area: HTMLTextAreaElement) => {
        const lines = area.value.split("\n");
        const at = area.value.slice(0, area.selectionStart).split("\n").length - 1;
        return { focused: document.activeElement === area, line: lines[at], next: lines[at + 1] };
      });
    const back = () => showRegen(window);
    // A line of text: there, two lines down from where it was.
    await rows.filter({ hasText: "lists their" }).click();
    await expect.poll(caret).toEqual({ focused: true, line: "- An :Owner: lists their :Repo: items.", next: expect.any(String) });
    await expect(window.locator(".pane-title")).toHaveText(/repos\.plain$/);
    // A blank line, between the two: the blank still between them.
    await back();
    // Unfolded, it stays so.
    await expect(card.locator(".part-head", { hasText: "repos.plain" })).toHaveAttribute("aria-expanded", "true");
    await card.locator(".opens-in-plain").waitFor();
    await rows.nth(4).click();
    await expect.poll(caret).toMatchObject({ focused: true, line: "", next: "- An :Owner: lists their :Repo: items." });
    // A line taken out since: where it was, below what was above it.
    const file = join(project, "repos.plain");
    writeFileSync(file, readFileSync(file, "utf8").replace("- An :Owner: lists their :Repo: items.\n  - A missing token returns `401`.\n", ""));
    await back();
    // Unfolded, it stays so.
    await expect(card.locator(".part-head", { hasText: "repos.plain" })).toHaveAttribute("aria-expanded", "true");
    await card.locator(".opens-in-plain").waitFor();
    await rows.filter({ hasText: "lists their" }).click();
    await expect.poll(async () => (await caret()).focused).toBe(true);
    const before = await window.locator(".editor-pane textarea").evaluate((area: HTMLTextAreaElement) => area.value.slice(0, area.selectionStart));
    expect(before).toContain("creates a :Repo:");
  });

  test("keeps what a running pulse renders lit in the ***plain view as a functional spec is added above it", async ({ launched: { app, window, spec } }) => {
    // Running: it renders hello.plain's functional spec, line 15 when it started.
    const diff = ["diff --git a/hello.plain b/hello.plain", "--- a/hello.plain", "+++ b/hello.plain", "@@ @@", " ***functional specs***", '+- :Greeter: prints "hello, world" and exits with 0.'].join("\n");
    const running = { ...pulse(), id: "p3", status: "running", finishedAt: undefined, diff, diffWhere: { 4: { file: "hello.plain", line: 13 }, 5: { file: "hello.plain", line: 15 } } };
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), running);
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    await expect(line(14)).toHaveClass(/rendering/);

    // A functional spec written in above it, as turri or the chat would: it moves down two lines, and stays lit there.
    writeFileSync(spec, readFileSync(spec, "utf8").replace("- :Greeter: prints", "- :Greeter: waves first.\n\n- :Greeter: prints"));
    await expect(line(16)).toContainText("prints");
    await expect(line(16)).toHaveClass(/rendering/);
    await expect(line(14)).not.toHaveClass(/rendering/);
  });

  test("lights a line with a link a running pulse renders - found by its text as the file has it, not as turri reads it", async ({ launched: { app, window, spec } }) => {
    // A definition with a nested line linking a resource: the diff has its link as turri reads it, `written` as the file has it.
    const linked = "  - It is described in [resources/greeting spec.yaml](resources/greeting spec.yaml).";
    writeFileSync(spec, readFileSync(spec, "utf8").replace("greets the person running it.", `greets the person running it.\n${linked}`));
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    await expect(line(7)).toContainText("It is described in");
    const read = "  - It is described in `[resource]resources/greeting spec.yaml`.";
    const diff = ["diff --git a/hello.plain b/hello.plain", "--- a/hello.plain", "+++ b/hello.plain", "@@ @@", " ***definitions***", "+- :Greeter: is a command-line program that greets the person running it.", `+${read}`].join("\n");
    const where = { 4: { file: "hello.plain", line: 5 }, 5: { file: "hello.plain", line: 7 }, 6: { file: "hello.plain", line: 8, written: linked } };
    const running = { ...pulse(), id: "p4", status: "running", finishedAt: undefined, diff, diffWhere: where };
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), running);
    await expect(line(6)).toHaveClass(/rendering/);
    await expect(line(7)).toHaveClass(/rendering/);

    // A line written in above them: both move down one, and stay lit there.
    writeFileSync(spec, readFileSync(spec, "utf8").replace("***definitions***\n", "***definitions***\n\n- :Visitor: is whoever runs it.\n"));
    await expect(line(9)).toContainText("It is described in");
    await expect(line(9)).toHaveClass(/rendering/);
    await expect(line(8)).toHaveClass(/rendering/);
  });

  test("shows an earlier session's pulse with nothing more to it as a card that does not open", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const run = {
      run: "r1",
      mode: "host",
      started: new Date(Date.now() - 3_600_000).toISOString(),
      version: "0.1.15",
      pulses: [{ id: "old1", run: "r1", kind: "regenerate", summary: "hello: the root endpoint", module: "hello", pulse: 1, title: "the root endpoint", status: "succeeded", landed: true, stoppedBy: null, ms: 97_000, usage: null, error: null, failures: [] }],
    };
    await app.evaluate(({ BrowserWindow }, runs) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:earlier", runs), [run]);
    await showRegen(window);
    const card = window.locator(".job.past", { hasText: "the root endpoint" });
    await expect(card).toContainText("succeeded, landed");
    // What the ledger says of it is not the window's to show, and no ***plain kept of it: a click opens nothing.
    await expect(card.locator(".job-head")).not.toHaveAttribute("role", "button");
    await card.click();
    await expect(card).not.toContainText("from the ledger");
    await expect(card.locator(".job-body")).toHaveCount(0);
  });

  test("shows the ***plain an earlier session's pulse regenerated, as the ledger keeps it, and opens it", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const { diff, diffWhere } = pulse();
    const run = {
      run: "r1",
      mode: "host",
      started: new Date(Date.now() - 3_600_000).toISOString(),
      version: "0.1.19",
      pulses: [{ id: "old1", run: "r1", kind: "regenerate", summary: "hello: the root endpoint", module: "hello", pulse: 1, title: "the root endpoint", status: "succeeded", landed: true, stoppedBy: null, ms: 97_000, usage: null, error: null, failures: [], diff, diffWhere }],
    };
    await app.evaluate(({ BrowserWindow }, runs) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:earlier", runs), [run]);
    await showRegen(window);
    const card = window.locator(".job.past", { hasText: "the root endpoint" });
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
    await unfold(await opened(card), "hello.plain");
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    await card.locator(".opens-in-plain").click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
  });
});

test.describe("a pulse's report, with debug on", () => {
  test.use({ debug: true });

  test("shows a pulse's report, folded", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), report: "The greeter now greets by name." });
    await showRegen(window);
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    await expect(card.locator(".part-head")).toHaveText([/^regenerated.*hello\.plain$/, "report"]);
    await expect(card.locator(".job-report .prose")).toHaveCount(0);
    await unfold(card, "report");
    await expect(card.locator(".job-report .prose")).toContainText("The greeter now greets by name.");
  });

  test("stops the pulses that were running once the engine stops", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    await send("engine:job", { ...pulse(), status: "running", finishedAt: undefined });
    await showRegen(window);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card).toHaveClass(/\brunning\b/);
    await send("engine:exit", { code: 1 });
    await expect(card).toHaveClass(/\bstopped\b/);
    await unfold(await opened(card), "report");
    await expect(card.locator(".job-report .prose")).toContainText("The turri engine stopped under this pulse.");
  });

  test("keeps a long report within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const report = Array.from({ length: 60 }, (_, at) => `Step ${at + 1}: the greeting was checked again.`).join("\n\n");
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), report });
    await showRegen(window);
    const card = await unfold(await opened(window.locator(".job", { hasText: "the greeting by name" })), "report");
    const prose = card.locator(".job-report .prose");
    await expect(prose).toContainText("Step 60:");
    const box = await prose.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
  });
});

test.describe("a failed pulse", () => {
  test.use({ stubModel: "silent" });

  test("opens a closed pulse on a click anywhere on its card - but not on investigate, nor closes it from its body", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), status: "failed", error: "the tests did not pass" });
    await showRegen(window);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    const head = card.locator(".job-head");
    // Failed while regen was not shown: showing it opens the pulse, once - closed here by its head.
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    // investigate is its own: it asks a chat - back in the project's window - and leaves the card closed.
    await card.getByRole("button", { name: "investigate" }).click();
    await expect(window.locator(".dive")).toHaveCount(0);
    await showRegen(window);
    await expect(head).toHaveAttribute("aria-expanded", "false");
    // The line under the head, and the card's own edge, open it.
    await card.locator(".job-outcome").click({ position: { x: 4, y: 4 } });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    // Open, a click in its body leaves it open; its head closes it.
    await card.locator(".job-body").click({ position: { x: 4, y: 4 } });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    const box = (await card.boundingBox())!;
    await window.mouse.click(box.x + box.width - 4, box.y + box.height - 3);
    await expect(head).toHaveAttribute("aria-expanded", "true");
  });

  test("offers only investigate, which asks a chat of its own why it failed", async ({ launched: { app, window, requests } }) => {
    test.skip(!(await offers(window)).chats, "the turri running has one chat");
    await expect(window.locator(".chat-model")).toBeVisible();
    // Regen shown first: a pulse failing while it is not shown is opened when it is, once.
    await showRegen(window);
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      status: "failed",
      error: "The conformance tests could not reach the greeter.",
    });
    // Closed, it says it failed, and investigate is right of that.
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "false");
    const outcome = card.locator(".job-outcome");
    await expect(outcome).toContainText("failed");
    const investigate = outcome.getByRole("button", { name: "investigate" });
    await expect(investigate).toBeVisible();
    const said = (await outcome.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      const box = range.getBoundingClientRect();
      return { right: box.right, y: box.y + box.height / 2 };
    }))!;
    const button = (await investigate.boundingBox())!;
    expect(button.x).toBeGreaterThan(said.right);
    expect(Math.abs(button.y + button.height / 2 - said.y)).toBeLessThan(6);
    await expect(card.getByRole("button", { name: "why it failed" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "copy" })).toHaveCount(0);
    await card.getByRole("button", { name: "investigate" }).click();
    const tabs = window.locator(".chat-tabs [role=tab]");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => requests.at(-1) ?? "").toContain("Investigate the pulse that failed (hello · pulse 1 · regenerate · p1)");
    expect(requests.at(-1)).toContain("The conformance tests could not reach the greeter.");
  });
});
