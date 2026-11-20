import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, showRegen, test } from "./app.ts";

// turri launches what each pulse lands on its own (launch-after-pulse), in the background, and the sentinel tries what it
// launched - or, with none, the chat opens it once told it is up: the window has no Launch of its own. turri tells the
// window of each launch (onLaunch), and the window says it where the person looks for what runs - the preview's bar,
// and the pulse's card in regen - sent here as the engine sends it, no model called.

/** A launch as the engine sends it (engine.mjs's launchView). */
const launch = (id: string, status: string, more: Record<string, unknown> = {}) => ({
  id,
  codebase: "hello",
  commit: `${id.replace(/\D/g, "")}f2a1bc0000000000000000000000000000000000`.slice(0, 40),
  short: `${id.replace(/\D/g, "")}f2a1bc`.slice(0, 7),
  status,
  cause: { chat: "chat-1" },
  queuedAt: Date.now() + Number(id.replace(/\D/g, "")),
  ...more,
});

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

const send = (app: ElectronApplication, channel: string, data: unknown) =>
  app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);

/** The project's summary, as the engine gives it, with every functional spec built - as after a regeneration. */
async function built(window: Page) {
  // How the module stands read first, after the project opens: else it would come over what is sent here.
  await expect(window.locator(".tree-row", { hasText: "hello.plain" }).locator(".spec-row-count")).toHaveText("0/1");
  type Summary = { specs: Array<{ functionalSpecs: object[] }>; offers: { check?: boolean } };
  const summary = (await window.evaluate(() => (globalThis as unknown as { turri: { call: (method: string) => Promise<unknown> } }).turri.call("summary"))) as Summary;
  return { ...summary, specs: summary.specs.map((spec) => ({ ...spec, built: true, drifted: false, functionalSpecs: spec.functionalSpecs.map((entry) => ({ ...entry, built: true })) })) };
}

test.describe("launching", () => {
  test("has no button or menu item of the window's", async ({ launched: { app, window } }) => {
    await expect(window.locator(".toolbar-actions")).toBeVisible();
    await expect(window.locator(".toolbar-actions").getByRole("button", { name: /launch|release/i })).toHaveCount(0);
    const labels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap((item) => [item.label, ...(item.submenu?.items.map((sub) => sub.label) ?? [])]),
    );
    expect(labels).toContain("Regenerate…");
    expect(labels.filter((label) => /launch|release/i.test(label))).toEqual([]);
  });

  test("is turri's, in the background - the chat told once it is up, to open it and say what to test; after a pulse, the sentinel's", async () => {
    // The engine's own JavaScript, untyped: what turri is told of the window.
    const engine: string = "../engine/app.mjs";
    const { APP_SURFACE, SENTINEL_SURFACE, SENTINEL } = (await import(engine)) as { APP_SURFACE: string; SENTINEL_SURFACE: string; SENTINEL: boolean };
    // turri's words of now: launch, never release, deploy or activate.
    expect(APP_SURFACE).not.toMatch(/releas|deploy|activat/i);
    expect(SENTINEL_SURFACE).not.toMatch(/releas|deploy|activat/i);
    expect(APP_SURFACE).toContain("launch-after-pulse");
    // The app being built is launched with launch, never started by the chat in the terminal - even with the command a
    // failed launch quotes: else nothing the window or the sentinel knows of runs it.
    expect(APP_SURFACE).toMatch(/the app being built is never\s+yours to start there, even with the command a launch that did not come up quotes: it is launched with launch/);
    expect(APP_SURFACE).toMatch(/Asked\s+to launch it another way - another port, say - call launch with that as its guidance/);
    expect(APP_SURFACE).not.toContain("/turri-config");
    if (SENTINEL) {
      // After a pulse turri launches it itself, and it is the sentinel's to try: the chat does neither.
      expect(APP_SURFACE).toMatch(/turri launches what\s+each pulse lands itself, in the background[^]*you never call launch for that/);
      expect(APP_SURFACE).toMatch(/What a pulse launched is the sentinel's to try: after a pulse you do not open it or say what to test/);
      // Asked, the chat launches it - at once, never waiting in silence - and opens it once told it is up.
      expect(APP_SURFACE).toMatch(/When the person asks to try something[^]*call launch\. It\s+returns at once[^]*never wait for it in silence/);
      expect(APP_SURFACE).toMatch(/You are told once it is up[^]*out already[^]*open it in the preview where they can\s+watch/);
      // With no sentinel, told as each launch after a pulse ends, it opens it and says what to test.
      expect(APP_SURFACE).toMatch(/With sentinel: false[^]*you are told as each launch after a pulse ends - open what it launched where they can watch, and\s+tell them what to test/);
      // A pulse that lands with no sentinel is launching already: the chat says so, never offers to launch it.
      expect(APP_SURFACE).toMatch(/When such a pulse\s+lands, with launch-after-pulse on, it is launching already[^]*never offer to launch it, nor say that nothing runs/);
      // The sentinel tries what is launched, and starts nothing of its own - never the code in plain_modules, which it
      // once ran on a port of its own from the preview's terminal when its brief said nothing was left running.
      expect(SENTINEL_SURFACE).toMatch(/in what turri launched/);
      expect(SENTINEL_SURFACE).toMatch(/a CLI or a library from dist\/<module>, where it was launched/);
      expect(SENTINEL_SURFACE).toMatch(/Never start the app yourself\s+in the terminal - nor run anything from plain_modules/);
      expect(SENTINEL_SURFACE).toMatch(/A server your brief says does not run[^]*is what you find out about, not something to start in its place/);
      expect(SENTINEL_SURFACE).not.toMatch(/A server you start/);
    } else {
      expect(APP_SURFACE).toMatch(/Once something is launched, open it in the preview where the person can watch/);
      expect(APP_SURFACE).toMatch(/what to test: what was built from the \*\*\*plain/);
      expect(APP_SURFACE).not.toMatch(/sentinel/);
    }
  });

  test("is said in the preview's bar, as turri tells of each launch - under way, up, not up, stopped, out already", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    // Nothing launched yet: nothing said.
    await expect(window.locator(".preview-launches")).toHaveCount(0);

    await send(app, "engine:launch", launch("launch-1", "running", { startedAt: Date.now() }));
    const line = window.locator(".preview-launch[data-codebase='hello']");
    await expect(line).toHaveText("launching hello at 1f2a1bc…");
    // A newer commit asked for meanwhile waits its turn: said beside it.
    await send(app, "engine:launch", launch("launch-2", "waiting"));
    await expect(line).toHaveText("launching hello at 1f2a1bc… then 2f2a1bc");

    // The first one done, the newer one launching; then up, where it runs - the whole of what it said on hover.
    await send(app, "engine:launch", launch("launch-1", "launched", { summary: "Runs at http://localhost:8000.", finishedAt: Date.now() }));
    await send(app, "engine:launch", launch("launch-2", "running", { startedAt: Date.now() }));
    await expect(line).toHaveText("launching hello at 2f2a1bc…");
    await send(app, "engine:launch", launch("launch-2", "launched", { summary: "Runs at http://localhost:8000.\nThe API docs are at /docs.", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 2f2a1bc runs - Runs at http://localhost:8000.");
    await expect(line).toHaveAttribute("title", "Runs at http://localhost:8000.\nThe API docs are at /docs.");
    // A click opens all it said, under its line, to read and copy - another puts it away.
    const whole = window.locator(".preview-launch-whole");
    await expect(whole).toHaveCount(0);
    await line.click();
    await expect(line).toHaveAttribute("aria-expanded", "true");
    await expect(whole).toContainText("Runs at http://localhost:8000.");
    await expect(whole).toContainText("The API docs are at /docs.");
    await line.click();
    await expect(whole).toHaveCount(0);

    // Every pane says it - the browser's and the terminal's bar too.
    await window.getByRole("tab", { name: "browser" }).click();
    await expect(window.locator(".preview-launch[data-codebase='hello']")).toHaveText("hello at 2f2a1bc runs - Runs at http://localhost:8000.");
    await window.getByRole("tab", { name: "home" }).click();

    // Out already - a launch of its own, ended at once, never running: what runs is still the last one's, now at its
    // commit, where it runs as that one said it.
    await send(app, "engine:launch", launch("launch-3", "launched", { already: true, summary: "Runs at http://localhost:8000.\nThe API docs are at /docs.", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello still runs, now at 3f2a1bc - out already - Runs at http://localhost:8000.");
    await expect(line).toHaveClass(/already/);
    // Did not come up: why, as it said it - nothing more of the window's.
    await send(app, "engine:launch", launch("launch-4", "failed", { summary: "node is not installed: brew install node", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 4f2a1bc did not come up - node is not installed: brew install node");
    await expect(line).toHaveClass(/failed/);
    // Its agent saying it the way the window does - "hello did not come up: …" - is not said twice.
    await send(app, "engine:launch", launch("launch-4", "failed", { summary: "hello did not come up: port 8000 is held by another project's server (PID 66816).", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 4f2a1bc did not come up - port 8000 is held by another project's server (PID 66816).");
    // Up, and replaced at once by the newer launch waiting: the newer one is what the bar says.
    await send(app, "engine:launch", launch("launch-6", "launched", { summary: "Runs at http://localhost:8000.", replacedBy: "launch-7", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 6f2a1bc was replaced by a newer launch");
    await send(app, "engine:launch", launch("launch-7", "running", { startedAt: Date.now() }));
    await expect(line).toHaveText("launching hello at 7f2a1bc…");
    await send(app, "engine:launch", launch("launch-7", "launched", { summary: "Runs at http://localhost:8000.", finishedAt: Date.now() }));
    // /halt launched hello: the launch that was up comes again, stopped - nothing of it runs.
    await send(app, "engine:launch", launch("launch-7", "stopped", { summary: "Stopped on request.", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 7f2a1bc was stopped - nothing of it runs");
    // Stopped before it came up: the same.
    await send(app, "engine:launch", launch("launch-5", "stopped", { summary: "Stopped on request.", finishedAt: Date.now() }));
    await expect(line).toHaveText("hello at 5f2a1bc was stopped - nothing of it runs");
    // The engine gone: what its launches started went with it.
    await send(app, "engine:exit", { code: 0 });
    await expect(window.locator(".preview-launches")).toHaveCount(0);
  });

  test("says on a pulse's card in regen how its launch went - superseded by a newer pulse's, launching, launched, not up", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await send(app, "engine:job", pulse("j1", "the greeting by name", 1));
    await send(app, "engine:job", pulse("j2", "a farewell", 2));
    await send(app, "engine:job", pulse("j3", "a wave", 3));
    // Each landed under launch-after-pulse: j1's launching, j2's waiting behind it - then j3's, newer, taking its place.
    await send(app, "engine:launch", launch("launch-1", "running", { cause: { pulse: "j1", title: "hello pulse 1" }, startedAt: Date.now() }));
    await send(app, "engine:launch", launch("launch-2", "waiting", { cause: { pulse: "j2", title: "hello pulse 2" } }));
    await showRegen(window);
    const card = (title: string) => window.locator(".job", { hasText: title }).locator(".job-launch");
    await expect(card("the greeting by name")).toHaveText("launching at 1f2a1bc…");
    await expect(card("a farewell")).toHaveText("waiting to launch - hello's launch before it runs first");
    // A pulse not launched after it landed - none of its own - says nothing of it.
    await expect(card("a wave")).toHaveCount(0);

    await send(app, "engine:launch", launch("launch-3", "waiting", { cause: { pulse: "j3", title: "hello pulse 3" } }));
    await send(app, "engine:launch", launch("launch-2", "superseded", { cause: { pulse: "j2", title: "hello pulse 2" }, supersededBy: "launch-3", finishedAt: Date.now() }));
    // Why j2 was not launched on its own: j3's launch holds its code.
    await expect(card("a farewell")).toHaveText("not launched on its own - superseded by hello pulse 3's launch, which holds its code");

    await send(app, "engine:launch", launch("launch-1", "launched", { cause: { pulse: "j1", title: "hello pulse 1" }, summary: "Prints Hello, World! - run node index.js from dist/hello.", finishedAt: Date.now() }));
    await expect(card("the greeting by name")).toHaveText("launched at 1f2a1bc - Prints Hello, World! - run node index.js from dist/hello.");
    await send(app, "engine:launch", launch("launch-3", "failed", { cause: { pulse: "j3", title: "hello pulse 3" }, summary: "index.js exited: SyntaxError", finishedAt: Date.now() }));
    await expect(card("a wave")).toHaveText("launch did not come up - index.js exited: SyntaxError");
    await expect(card("a wave")).toHaveClass(/failed/);
    await send(app, "engine:launch", launch("launch-3", "failed", { cause: { pulse: "j3", title: "hello pulse 3" }, summary: "Not launched: port 8000 is held by PID 66816, an earlier hello.", finishedAt: Date.now() }));
    await expect(card("a wave")).toHaveText("launch did not come up - port 8000 is held by PID 66816, an earlier hello.");
    await send(app, "engine:launch", launch("launch-3", "failed", { cause: { pulse: "j3", title: "hello pulse 3" }, summary: "The launch of hello at 3f2a1bc did not come up. index.js exited: SyntaxError", finishedAt: Date.now() }));
    await expect(card("a wave")).toHaveText("launch did not come up - index.js exited: SyntaxError");

    // Up, but a newer pulse's launch was waiting, which stops what it started as it starts: replaced, not what runs.
    await send(app, "engine:launch", launch("launch-1", "launched", { cause: { pulse: "j1", title: "hello pulse 1" }, summary: "Runs.", replacedBy: "launch-3", finishedAt: Date.now() }));
    await expect(card("the greeting by name")).toHaveText("launched at 1f2a1bc, then replaced by hello pulse 3's launch, which holds its code");

    // A pulse that landed only tests: its code what runs already - launched, out already, not missing a launch.
    await send(app, "engine:job", { ...pulse("j4", "the greeting's tests", 4), kind: "conformance" });
    await send(app, "engine:launch", launch("launch-4", "launched", { cause: { pulse: "j4", title: "hello pulse 4" }, already: true, summary: "Prints Hello, World! - run node index.js from dist/hello.", finishedAt: Date.now() }));
    await expect(card("the greeting's tests")).toHaveText("launched at 4f2a1bc - out already: its code was running");
  });

  test("offers the sentinel's check on the preview's home only once something of the module runs - saying why not until then", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const summary = await built(window);
    // The check offered, as on a turri whose sentinel can be asked.
    await send(app, "project:opened", { ...summary, offers: { ...summary.offers, check: true } });
    await window.getByRole("tab", { name: "preview" }).click();
    await expect(window.locator(".preview-home-launch")).toHaveText("tried in: hello:print-hello - the codebase as built up to it");
    await window.getByRole("checkbox", { name: "print-hello" }).click();
    const check = window.getByRole("button", { name: "use sentinel" });
    // Nothing of hello launched: the sentinel launches nothing, so it would end unchecked - not offered, and why.
    await expect(check).toBeDisabled();
    await expect(window.locator(".preview-home-why")).toHaveText("nothing of hello is launched for it to check in - try it first");
    await expect(window.getByRole("button", { name: "try it" })).toBeEnabled();

    // Its last launch did not come up: try it again first.
    await send(app, "engine:launch", launch("launch-1", "failed", { summary: "the port is taken", finishedAt: Date.now() }));
    await expect(window.locator(".preview-home-why")).toHaveText("hello's last launch did not come up - try it again first");
    await expect(check).toBeDisabled();
    // Being launched: offered - turri has the check wait until it has settled.
    await send(app, "engine:launch", launch("launch-2", "running", { startedAt: Date.now() }));
    await expect(check).toBeEnabled();
    await expect(window.locator(".preview-home-why")).toHaveCount(0);
    // Up: offered.
    await send(app, "engine:launch", launch("launch-2", "launched", { summary: "Runs at http://localhost:8000.", finishedAt: Date.now() }));
    await expect(check).toBeEnabled();
    // Halted - /halt launched hello: it comes again, stopped, and nothing of hello runs to check in.
    await send(app, "engine:launch", launch("launch-2", "stopped", { summary: "Stopped on request.", finishedAt: Date.now() }));
    await expect(check).toBeDisabled();
    await expect(window.locator(".preview-home-why")).toHaveText("nothing of hello is launched for it to check in - try it first");
  });

  test("asks turri on the preview's home to launch what is chosen and say how to try it once it is up", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await send(app, "project:opened", await built(window));
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("checkbox", { name: "print-hello" }).click();
    await window.getByRole("button", { name: "try it" }).click();
    const asked = window.locator(".chat-body .msg.action");
    await expect(asked.locator(".action-title")).toHaveText("hello:print-hello, launched from hello");
    await asked.getByRole("button", { name: "what turri was asked" }).click();
    await expect(asked.locator(".action-prompt")).toHaveText(
      "Launch hello for me to try hello:print-hello - its last commit, out already if that is what runs - and once it is up, open it and tell me in a few steps how to try it and what I should see. Don't test it yourself: I'll try it.",
    );
  });
});

test.describe("an existing project's release-after-pulse", () => {
  test.use({ configLines: ["release-after-pulse: true  # what each pulse lands, started"] });

  test("is renamed launch-after-pulse by turri itself - its value and comment kept - which the notifications say, as no warning", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // turri's own doing, as it first read the config: the app writes none of it.
    const config = readFileSync(join(project, "config.turri.yaml"), "utf8");
    expect(config).toContain("launch-after-pulse: true  # what each pulse lands, started");
    expect(config).not.toContain("release-after-pulse");
    await window.locator(".status-strip .status-bell").click();
    const said = window.getByRole("tabpanel", { name: "notifications" }).locator(".notification", { hasText: "release-after-pulse is called launch-after-pulse now" });
    await expect(said).toHaveClass(/info/);
    await expect(said).toContainText("turri says · config.turri.yaml: release-after-pulse is called launch-after-pulse now");
    await expect(said.getByRole("button", { name: "take it out" })).toHaveCount(0);
  });
});

test.describe("an old name beside its new one", () => {
  test.use({ configLines: ["release-after-pulse: true", "launch-after-pulse: true"] });

  test("is left as it is by turri - doing nothing - and is a warning with take it out", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const config = readFileSync(join(project, "config.turri.yaml"), "utf8");
    expect(config).toContain("release-after-pulse: true");
    await window.locator(".status-strip .status-bell").click();
    const said = window.getByRole("tabpanel", { name: "notifications" }).locator(".notification", { hasText: "the old name of launch-after-pulse" });
    await expect(said).toHaveClass(/warning/);
    await expect(said.getByRole("button", { name: "take it out" })).toBeVisible();
  });
});

test.describe("turri's banner lines of the config", () => {
  test("are drawn by their kind, never their words - a key turri renamed is information, the rest warnings to take out", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const summary = await window.evaluate(() => (globalThis as unknown as { turri: { call: (method: string) => Promise<Record<string, unknown>> } }).turri.call("summary"));
    // Words that would read as either: the kind decides.
    await send(app, "project:opened", {
      ...summary,
      configLines: [
        { kind: "renamed", text: "config.turri.yaml: release-after-pulse is called launch-after-pulse now - nothing to take it out of." },
        { kind: "old-beside-new", text: "config.turri.yaml has release-after-pulse beside launch-after-pulse." },
      ],
    });
    await window.locator(".status-strip .status-bell").click();
    const list = window.getByRole("tabpanel", { name: "notifications" });
    const renamed = list.locator(".notification", { hasText: "is called launch-after-pulse now" });
    await expect(renamed).toHaveClass(/info/);
    await expect(renamed.getByRole("button", { name: "take it out" })).toHaveCount(0);
    const both = list.locator(".notification", { hasText: "beside launch-after-pulse" });
    await expect(both).toHaveClass(/warning/);
    await expect(both.getByRole("button", { name: "take it out" })).toBeVisible();
  });
});
