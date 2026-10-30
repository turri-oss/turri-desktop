import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { entryItem, normalise } from "../engine/entries.mjs";
import { clickMenu, expect, tellChat, test } from "./app.ts";
import { keys } from "./keys.ts";

/** A test plain file of hello's print-hello: one conformance scenario, naming a concept of hello's. */
const SCENARIOS = "---\nmodule: hello\nfunc_id: print-hello\n---\n\n***conformance tests***\n\n# prints-hello\nRunning :Greeter: prints \"hello, world\".\n";

/** A piece of the coloured text ⌘-clicked: at its middle, on the textarea over it, which takes the pointer. */
async function modClick(window: Page, piece: Locator) {
  const at = (await piece.boundingBox())!;
  const area = window.locator(".editor textarea");
  const box = (await area.boundingBox())!;
  await area.click({ position: { x: at.x - box.x + at.width / 2, y: at.y - box.y + at.height / 2 }, modifiers: ["ControlOrMeta"] });
}

/**
 * The engine's evaluateTests answered by the test - the real one starts the advisor, which calls a model - with what
 * the window asked kept, to read back.
 */
async function evaluationsTaken(app: ElectronApplication, outcome: object): Promise<() => Promise<unknown[]>> {
  await app.evaluate(({ ipcMain }, outcome) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers;
    const real = handlers.get("engine:call")!;
    const taken: unknown[] = [];
    (globalThis as unknown as { taken: unknown[] }).taken = taken;
    handlers.set("engine:call", (event, method, params) => {
      if (method !== "evaluateTests") return real(event, method, params);
      taken.push(params);
      return outcome;
    });
  }, outcome);
  return () => app.evaluate(() => (globalThis as unknown as { taken: unknown[] }).taken);
}

/** The tree opened down to hello's test folder, and a file in it. */
async function inTests(window: Page, name: string): Promise<Locator> {
  await window.locator(".tree-row", { hasText: /^tests$/ }).click();
  await window.locator(".tree-row", { hasText: /^hello$/ }).click();
  const row = window.locator(".tree-row", { hasText: name });
  await expect(row).toBeVisible();
  return row;
}

test.describe("test plain files", () => {
  test("are in the tree as a functional spec's scenarios, not modules - one turri does not read marked so", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), SCENARIOS);
    writeFileSync(join(project, "tests", "hello", "nowhere.plain"), SCENARIOS.replace("func_id: print-hello", "func_id: nowhere"));
    const row = await inTests(window, "print-hello.plain");
    await expect(row.locator(".tree-state.tests")).toHaveAttribute("title", "the scenarios of hello:print-hello - 1 conformance scenario, 0 acceptance scenarios");
    // No state of a module's, nor its count of what is built.
    await expect(row.locator(".spec-row-count")).toHaveCount(0);
    await expect(window.locator(".tree-row", { hasText: "nowhere.plain" }).locator(".state-dot.error")).toBeVisible();
    // Still one module.
    await expect(window.locator(".tree-row .spec-row-count")).toHaveCount(1);
  });

  test("open in the ***plain view, coloured, with no functional spec marked - and go to the functional spec they are of", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), SCENARIOS);
    await (await inTests(window, "print-hello.plain")).click();
    await expect(window.locator(".editor textarea")).toHaveValue(/# prints-hello/);
    await expect(window.locator(".editor-colours .plain-id", { hasText: "# prints-hello" })).toBeVisible();
    await expect(window.locator(".editor-colours .plain-section").first()).toBeVisible();
    // A scenario's heading is not a functional spec's.
    await expect(window.locator(".editor-colours .mark")).toHaveCount(0);
    const header = window.locator(".editor-pane .pane-header");
    await expect(header).toContainText("tests/hello/print-hello.plain");
    await expect(header).toContainText("the scenarios of hello:print-hello");
    await header.getByRole("button", { name: "print-hello" }).click();
    await expect(header).toContainText("hello.plain");
    await expect(window.locator(".editor-colours > div.revealed")).toContainText("# print-hello");
  });

  test("go to their module and their functional spec - from the header, and ⌘-clicked in the front matter, coloured", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), SCENARIOS);
    // Its folders opened once; then its row, again and again.
    const row = await inTests(window, "print-hello.plain");
    const open = async () => {
      await row.click();
      await expect(window.locator(".editor textarea")).toHaveValue(/# prints-hello/);
    };
    const header = window.locator(".editor-pane .pane-header");
    // The header: its module, and its functional spec - each a link.
    await open();
    await header.getByRole("button", { name: "hello", exact: true }).click();
    await expect(header).toContainText("hello.plain");
    await expect(header).not.toContainText("tests/hello");

    // The front matter coloured: module: names the module, a link ⌘-clicked.
    await open();
    const module = window.locator(".editor-colours .plain-module", { hasText: "hello" });
    await expect(module).toBeVisible();
    await modClick(window, module);
    await expect(header).toContainText("hello.plain");
    await expect(header).not.toContainText("tests/hello");

    // func_id: names the functional spec - on a turri whose grammar marks it.
    await open();
    const funcId = window.locator(".editor-colours .plain-func-ref", { hasText: "print-hello" });
    if ((await funcId.count()) === 0) return;
    await modClick(window, funcId);
    await expect(window.locator(".editor-colours > div.revealed")).toContainText("# print-hello");
  });

  test("show under their functional spec: how many, each by its id - and none says it is not tested, not that it is wrong", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const heading = window.locator(".editor-colours > div", { hasText: "# print-hello" });
    await expect(heading).toBeVisible();
    // None with scenarios: nothing to count as conformance tested.
    await expect(window.locator(".editor-pane .pane-header .conformed-count")).toHaveCount(0);
    // None yet: nothing beside it - and its card says so.
    await expect(heading.locator(".scenario-chip")).toHaveCount(0);
    // Pointed at once its colours say it is a functional spec's heading - its mark there - in two moves, as a pointer
    // comes to rest.
    const hover = async () => {
      await expect(heading.locator(".mark")).toBeVisible();
      const box = (await heading.boundingBox())!;
      await window.mouse.move(box.x + 30, box.y + box.height / 2);
      await window.mouse.move(box.x + 40, box.y + box.height / 2);
      return window.getByRole("tooltip");
    };
    await expect(await hover()).toContainText("no scenarios - not tested");
    await window.mouse.move(0, 0);
    // Its menu: nothing to conform, no scenarios to open.
    await window.locator(".editor-colours .mark").first().click();
    await expect(window.getByRole("menuitem", { name: /conform/ })).toBeDisabled();
    await expect(window.getByRole("menuitem", { name: /conform/ })).toContainText("it has no scenarios");
    await expect(window.getByRole("menuitem", { name: "open its scenarios" })).toHaveCount(0);
    await window.keyboard.press("Escape");

    // Its scenarios written: counted at the end of its heading, by kind.
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), SCENARIOS);
    const chip = heading.locator(".scenario-chip");
    await expect(chip).toHaveText("1 · 0");
    // What is tested counted over the functional specs with scenarios: one of one, not one of all.
    await expect(window.locator(".editor-pane .pane-header .conformed-count")).toContainText("0 of 1 conformed");
    await expect(chip).toHaveAttribute("title", "1 conformance scenario, 0 acceptance scenarios - open its test plain file");
    await expect(await hover()).toContainText("prints-hello");
    await window.mouse.move(0, 0);
    await window.locator(".editor-colours .mark").first().click();
    await expect(window.getByRole("menuitem", { name: "open its scenarios" })).toBeVisible();
    await window.keyboard.press("Escape");
    // Opened at its first scenario.
    await chip.click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("tests/hello/print-hello.plain");
    await expect(window.locator(".editor-colours > div.revealed")).toHaveText("# prints-hello");
  });

  test("save as a module does, and open a concept their scenarios name where their module has it", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const file = join(project, "tests", "hello", "print-hello.plain");
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(file, SCENARIOS);
    await (await inTests(window, "print-hello.plain")).click();
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/# prints-hello/);
    await area.evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await window.keyboard.type("\n***acceptance tests***\n\n# exits-zero\nRunning :Greeter: exits with 0.\n");
    await window.keyboard.press(`${keys.mod}+s`);
    await expect(window.locator(".pane-header-right")).toContainText("saved");
    expect(readFileSync(file, "utf8")).toContain("# exits-zero\nRunning :Greeter: exits with 0.");
    // Written under ***acceptance tests***, a section of its own: an acceptance scenario.
    await expect(window.locator(".tree-row", { hasText: "print-hello.plain" }).locator(".tree-state.tests")).toHaveAttribute("title", "the scenarios of hello:print-hello - 1 conformance scenario, 1 acceptance scenario");

    // :Greeter: is hello's: ⌘-clicked in a scenario, its definition there.
    await modClick(window, window.locator(".editor-colours .plain-concept", { hasText: ":Greeter:" }).first());
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(window.locator(".editor-colours > div.revealed")).toContainText("is a command-line program");
  });
});

test.describe("the steps of adding tests, and the old ***plain", () => {
  test.use({ stubModel: "silent" });

  test("say when conformance tests wait on a step of adding tests - a warning among the problems, asking nothing of the person", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const strip = window.getByRole("button", { name: /^problems:/ });
    await expect(window.locator(".editor textarea")).toHaveValue(/print-hello/);
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 0 warnings");
    // Scenarios, and hello has no test reqs: turri writes no conformance tests there until it does.
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), SCENARIOS);
    // Counted in the strip - a warning, not an error, so the panel stays shut until it is opened.
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 1 warnings");
    await expect(window.locator(".status-body")).toHaveCount(0);
    await strip.click();
    const waiting = window.getByRole("tabpanel", { name: "problems" }).locator(".problem.warning");
    await expect(waiting.locator(".problem-head strong")).toHaveText("turri warns");
    await expect(waiting).toContainText("hello:print-hello - but no ***test reqs***");
    await expect(waiting.locator(".problem-file")).toHaveText("hello.plain");
    // turri takes the step itself: nothing for the person to do.
    await expect(waiting.locator("> .button")).toHaveCount(0);
  });

  test("say when a module's base folder is not there - a warning among the problems, in turri's words", async ({ launched: { window, project, spec } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const strip = window.getByRole("button", { name: /^problems:/ });
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 0 warnings");
    // hello requires nothing: its codebase starts from the base folder named - and there is none.
    appendFileSync(join(project, "config.turri.yaml"), "base-folder: assets\n");
    writeFileSync(spec, readFileSync(spec, "utf8"));
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 1 warnings");
    await strip.click();
    const warning = window.getByRole("tabpanel", { name: "problems" }).locator(".problem.warning");
    await expect(warning.locator(".problem-head strong")).toHaveText("turri warns");
    await expect(warning.locator("p")).toHaveText("its base folder assets (base-folder:) is not there - its codebase's first pulse stops until it is");
    await expect(warning.locator(".problem-file")).toHaveText("hello.plain");
  });

  test("ask the chat to write a functional spec's testing scenarios, from its mark", async ({ launched: { window, requests } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.locator(".editor-colours .mark").first().click();
    await window.getByRole("menuitem", { name: "write testing scenarios" }).click();
    await expect.poll(() => requests.at(-1) ?? "").toContain("Write testing scenarios for hello:print-hello.");
  });

  test("say a module in the old ***plain syntax does not parse, with turri's next step - and ask the chat to convert it", async ({ launched: { window, spec, requests } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    writeFileSync(spec, readFileSync(spec, "utf8").replace("# print-hello\n", "- "));
    // A new error: the panel opens on it, by itself.
    const error = window.getByRole("tabpanel", { name: "problems" }).locator(".problem.error");
    await expect(error).toContainText("does not parse");
    await expect(error).toContainText("hello.plain is in the old");
    await expect(error).toContainText("Ask turri to convert it");
    await error.getByRole("button", { name: "convert it" }).click();
    await expect.poll(() => requests.at(-1) ?? "").toContain("Convert hello.plain to the new ***plain syntax.");
  });
});

test.describe("the test advisor", () => {
  test("maps its no and its yes from the transcript", () => {
    const no = "hello:print-hello doesn't need testing scenarios - nothing silent to get wrong.";
    expect(entryItem({ type: "custom", customType: "turri_advisor", data: { text: no } })).toEqual({ role: "note", customType: "turri_advisor", text: no });
    // The yes, hidden: the turn it starts is the chat's - only where it came from is marked.
    expect(entryItem({ type: "custom_message", customType: "turri_advisor_verdict", display: false, content: "The test advisor found…", details: { specs: ["hello:print-hello"] } })).toEqual({ role: "advisorVerdict", specs: ["hello:print-hello"] });
  });

  test("says its no as a notification - not in the chat - and marks where its yes starts the chat's turn", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:message", { role: "note", customType: "turri_advisor", text: "hello:print-hello doesn't need testing scenarios - nothing silent to get wrong." });
    await expect(window.locator(".status-said")).toHaveText("hello:print-hello doesn't need testing scenarios - nothing silent to get wrong.");
    await expect(window.getByRole("button", { name: /^notifications:/ })).toHaveAccessibleName("notifications: 1 unread");
    await expect(window.locator(".chat-body .msg.note")).toHaveCount(0);
    await tellChat(app, window, "chat:message", { role: "advisorVerdict", specs: ["hello:print-hello"] });
    await expect(window.locator(".msg.advisor-verdict")).toHaveText("testing scenarios evaluated · hello:print-hello");
  });

  test("is asked of a functional spec with no scenarios from its mark - at once, its verdict coming to the chat", async ({ launched: { app, window, spec } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const taken = await evaluationsTaken(app, { started: ["hello:print-hello"], already: [], scenarios: [], missing: [] });
    await window.locator(".editor-colours .mark").first().click();
    await window.getByRole("menuitem", { name: "evaluate testing scenarios" }).click();
    await expect(window.locator(".status-said")).toHaveText("testing scenarios for hello:print-hello are being evaluated - the verdict comes to the chat.");
    expect(await taken()).toEqual([{ file: spec, funcIds: ["print-hello"] }]);
  });

  test("shows a functional spec with no scenarios being evaluated, and its verdict - only while it is about the text there", async ({ launched: { window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // turri's own hash of the functional spec's text - what an entry is current for.
    const { default: turri } = await import("../engine/turri.mjs");
    const hash = turri.textHash(':Greeter: prints "hello, world" and exits with 0.');
    mkdirSync(join(project, ".turri", "advisor"), { recursive: true });
    const advise = (entry: object) =>
      writeFileSync(join(project, ".turri", "advisor", "hello.json"), JSON.stringify({ module: "hello", plainFile: "hello.plain", entries: { "print-hello": { funcId: "print-hello", at: new Date().toISOString(), ...entry } } }));
    const heading = window.locator(".editor-colours > div", { hasText: "# print-hello" });
    const chip = heading.locator(".advisor-chip");
    await expect(heading.locator(".mark")).toBeVisible();
    // Of another text: nothing.
    advise({ hash: "0000000000000000", state: "pending" });
    await window.waitForTimeout(800);
    await expect(chip).toHaveCount(0);
    advise({ hash, state: "pending" });
    await expect(chip).toHaveText("evaluating testing scenarios");
    advise({
      hash,
      state: "yes",
      undelivered: true,
      report: { verdict: "yes", questions: [{ question: "silent-failure", evidence: "printing hello world without the comma looks right" }], inputs: [{ input: "no arguments", agreed: "hello, world" }] },
    });
    await expect(chip).toHaveText("needs testing scenarios");
    const box = (await heading.boundingBox())!;
    await window.mouse.move(box.x + 30, box.y + box.height / 2);
    await window.mouse.move(box.x + 40, box.y + box.height / 2);
    const card = window.getByRole("tooltip");
    await expect(card).toContainText("needs testing scenarios, covering 1 input - the chat writes them at turri's next start.");
    await expect(card).toContainText("a wrong implementation could look right - printing hello world without the comma looks right");
    await window.mouse.move(0, 0);
    // A no: nothing beside it - its card says so.
    advise({ hash, state: "no", report: { verdict: "no", questions: [], inputs: [] } });
    await expect(chip).toHaveCount(0);
    await window.mouse.move(box.x + 30, box.y + box.height / 2);
    await window.mouse.move(box.x + 40, box.y + box.height / 2);
    await expect(window.getByRole("tooltip")).toContainText("doesn't need testing scenarios.");
  });
});

test.describe("a testing script written in the background", () => {
  test("maps its start, its line and its failure from the transcript", () => {
    const line = "Unit testing script written: test_scripts/run_unittests_python.sh.";
    expect(entryItem({ type: "custom", customType: "turri_skill_run", data: { text: line } })).toEqual({ role: "note", customType: "turri_skill_run", text: line });
    // Not written, hidden: the turn it starts is the chat's - only where it came from is marked; a turri before `runs`, its skill.
    const skill = "implement-unit-testing-script";
    expect(entryItem({ type: "custom_message", customType: "turri_skill_run", display: false, content: "…", details: { skills: [skill], runs: [{ skill, kind: "unit", plainFile: "hello.plain" }] } })).toEqual({
      role: "skillRun",
      runs: [{ skill, kind: "unit", plainFile: "hello.plain" }],
    });
    expect(entryItem({ type: "custom_message", customType: "turri_skill_run", display: false, content: "…", details: { skills: [skill] } })).toEqual({ role: "skillRun", runs: [{ skill }] });
    // cultivate's result: what it writes, and for which module.
    const started = { role: "toolResult", toolCallId: "c1", toolName: "cultivate", content: [{ type: "text", text: "…" }], isError: false, details: { background: true, kind: "unit", plainFile: "hello.plain" } };
    expect(normalise(started)).toMatchObject({ role: "toolResult", background: { kind: "unit", plainFile: "hello.plain" } });
    expect(normalise({ ...started, details: { background: true, started: false } })).toMatchObject({ background: { already: true } });
    expect(normalise({ ...started, details: {} })).not.toHaveProperty("background");
  });

  test("says what cultivate started, the script written as a notification, and marks where its failure starts the chat's turn", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:message", { role: "assistant", text: "", tools: [{ id: "c1", name: "cultivate", args: { skill: "implement-unit-testing-script", plainFile: "hello.plain" } }] });
    await tellChat(app, window, "chat:message", { role: "toolResult", id: "c1", name: "cultivate", text: "…", isError: false, background: { kind: "unit", plainFile: "hello.plain" } });
    await expect(window.locator(".tool-call")).toHaveText("writing the unit testing script for hello.plain, in the background");
    await tellChat(app, window, "chat:message", { role: "note", customType: "turri_skill_run", text: "Unit testing script written: test_scripts/run_unittests_python.sh." });
    await expect(window.locator(".status-said")).toHaveText("Unit testing script written: test_scripts/run_unittests_python.sh.");
    await expect(window.locator(".chat-body .msg.note")).toHaveCount(0);
    await tellChat(app, window, "chat:message", { role: "skillRun", runs: [{ skill: "implement-conformance-testing-script", kind: "conformance", plainFile: "hello.plain" }] });
    await expect(window.locator(".msg.skill-run")).toHaveText("conformance testing script not written · hello.plain");
  });
});

test.describe("a module's base folder", () => {
  test("says what drift says of it once the codebase has code - changed, named differently, gone - among the problems", async ({ launched: { app, window: page, spec } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const strip = page.getByRole("button", { name: /^problems:/ });
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 0 warnings");
    // The module as the engine describes it, with drift's line on its base folder - as the watcher sends it.
    const summary = await page.evaluate(() => window.turri.call<{ specs: Array<{ file: string }> }>("summary"));
    const said = "its base folder is now old-assets, but its codebase started from assets - regenerate it from scratch to start again from it";
    const next = { ...summary.specs[0]!, baseFolder: said };
    await app.evaluate(({ BrowserWindow }, sent) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:spec", sent), { file: spec, text: readFileSync(spec, "utf8"), spec: next });
    await expect(strip).toHaveAccessibleName("problems: 0 errors, 1 warnings");
    await strip.click();
    const warning = page.getByRole("tabpanel", { name: "problems" }).locator(".problem.warning");
    await expect(warning.locator(".problem-head strong")).toHaveText("its base folder");
    await expect(warning.locator("p")).toHaveText(said);
    await expect(warning.locator(".problem-file")).toHaveText("hello.plain");
  });

  test("is a check of this machine's - there with its files, or not there with what to do", async ({ launched: { app, window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    appendFileSync(join(project, "config.turri.yaml"), "base-folder: assets\n");
    await clickMenu(app, "Check This Machine…");
    const row = page.locator(".checks li", { hasText: "base folder assets" });
    await expect(row).toHaveClass("missing");
    await expect(row.locator(".check-detail")).toHaveText("not there - named in config.turri.yaml");
    await expect(row.locator(".check-fix")).toHaveText("make the folder, or name the right one in base-folder:, by path from the project's folder");
    // Made, with a file in it, and checked again: there, and how many files a codebase would start with.
    mkdirSync(join(project, "assets"));
    writeFileSync(join(project, "assets", "logo.svg"), "<svg/>\n");
    await page.getByRole("button", { name: "check again" }).click();
    await expect(row).toHaveClass("ok");
    await expect(row.locator(".check-detail")).toHaveText("1 file to start a codebase from - named in config.turri.yaml");
    await expect(row.locator(".check-fix")).toHaveCount(0);
  });

  test("is never listed, nor its record - a codebase's files are turri's, not the tree's", async ({ launched: { window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const code = join(project, "plain_modules", "hello", "code");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, ".turri-base.json"), JSON.stringify({ folder: "assets", hash: "x", files: ["logo.svg"] }));
    writeFileSync(join(code, ".turri.json"), "{}");
    writeFileSync(join(code, "logo.svg"), "<svg/>\n");
    // A file the tree does list, written after them: once it shows, they have been looked at.
    writeFileSync(join(project, "notes.plain"), "***functional specs***\n\n# note\nIt notes.\n");
    await expect(page.locator(".tree-row", { hasText: "notes.plain" })).toBeVisible();
    await expect(page.locator(".tree-row", { hasText: "plain_modules" })).toHaveCount(0);
    const listed = await page.evaluate(() => window.turri.call<string[]>("treeFiles"));
    expect(listed.filter((file) => file.includes("plain_modules") || file.includes(".turri"))).toEqual([]);
  });
});
