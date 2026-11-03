import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./app.ts";

/** The engine the app runs for its project: its main process's child running engine/engine.mjs. */
function enginePid(main: number): number | undefined {
  const children = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && Number(match[2]) === main && match[3]!.includes("engine.mjs"));
  return children[0] ? Number(children[0][1]) : undefined;
}

test.describe("the engine", () => {
  test("stopped under the window, says so until it is started again, and starts again at a click", async ({ launched: { app, window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const main = app.process().pid!;
    const first = enginePid(main);
    expect(first).toBeDefined();
    process.kill(first!, "SIGKILL");
    const notice = window.getByRole("alert");
    await expect(notice).toContainText("the turri engine stopped");
    await notice.getByRole("button", { name: "start it again" }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => enginePid(main), { timeout: 15_000 }).not.toBe(first);
    expect(enginePid(main)).toBeDefined();
    // It answers: a slash command that only prints, no model called.
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The plain standard library", { timeout: 15_000 });
  });
});

test.describe("a project opening", () => {
  test("shows its files at once, and how each module stands once it is read - in a thread of its own", async ({ launched: { window: page } }) => {
    const row = page.locator(".tree-row", { hasText: "hello.plain" });
    await expect(row).toBeVisible();
    // Read: its mark and count in the tree, and what is regenerated of it in the ***plain view's header.
    await expect(row.locator(".state-dot.unread")).toHaveCount(0, { timeout: 15_000 });
    await expect(row.locator(".spec-row-count")).toHaveText("0/1");
    await expect(page.locator(".editor-pane .pane-header")).toContainText("0 of 1 regenerated");
    const spec = (await page.evaluate(() => window.turri.call<{ specs: Array<{ unread?: boolean; drifted?: boolean }> }>("summary"))).specs[0]!;
    expect(spec.unread).toBeUndefined();
    expect(spec.drifted).toBe(true);
  });
});

test.describe("the project's modules", () => {
  test("are its .plain files but its test plain files, each functional spec by its func-id", async ({ launched: { window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    // A test plain file of hello's, in turri's test folder: a functional spec's scenarios, not a module.
    mkdirSync(join(project, "tests", "hello"), { recursive: true });
    writeFileSync(join(project, "tests", "hello", "print-hello.plain"), "---\nmodule: hello\nfunc_id: print-hello\n---\n\n***conformance tests***\n\n# prints-hello\nRunning :Greeter: prints \"hello, world\".\n");
    const summary = () => page.evaluate(() => window.turri.call<{ specs: Array<{ rel: string; functionalSpecs: Array<{ funcId: string; text: string }> }> }>("summary"));
    expect((await summary()).specs.map((spec) => spec.rel)).toEqual(["hello.plain"]);
    // Its scenarios, from its test plain file - once the modules are read again, after it is written.
    await expect.poll(async () => (await summary()).specs[0]!.functionalSpecs, { timeout: 15_000 }).toEqual([
      {
        funcId: "print-hello",
        text: ':Greeter: prints "hello, world" and exits with 0.',
        built: false,
        conformed: false,
        testPlainFile: join(project, "tests", "hello", "print-hello.plain"),
        scenarios: { conformance: [{ id: "prints-hello", text: 'Running :Greeter: prints "hello, world".', line: 8 }], acceptance: [] },
        // Not looked at by the test advisor.
        advisor: null,
      },
    ]);
  });
});

test.describe("the engine, with NODE_OPTIONS from the login shell that Electron's Node does not take", () => {
  test.use({ env: { TURRI_APP_SHELL_ENV: "1", SHELL: join(import.meta.dirname, "node-options-shell.sh") } });

  test("starts all the same, and answers", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The plain standard library", { timeout: 15_000 });
  });
});
