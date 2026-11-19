import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalise } from "../engine/entries.mjs";
import { expect, tellChat, test } from "./app.ts";

/** A test plain file of hello's: print-hello's scenarios - written, and tested only with conformance tests on. */
function scenarios(project: string) {
  mkdirSync(join(project, "tests", "hello"), { recursive: true });
  writeFileSync(join(project, "tests", "hello", "print-hello.plain"), "---\nmodule: hello\nfunc_id: print-hello\n---\n\n***conformance tests***\n\n# prints-hello\nRunning :Greeter: prints \"hello, world\".\n");
}

test.describe("conformance tests off", () => {
  test.use({ conformance: false });

  test("show a module's scenarios as not tested, and offer nothing that tests on its marks", async ({ launched: { window: page, project } }) => {
    scenarios(project);
    const header = page.locator(".editor-pane .pane-header");
    await expect(header.locator(".conformed-count.off")).toContainText("conformance tests off");
    // Its scenarios there, grey, not tested - and never counted conformed.
    const chip = page.locator(".scenario-chip");
    await expect(chip).toHaveClass(/untested/);
    await expect(chip).toHaveAttribute("title", /not tested: conformance tests are off/);
    await expect(header).not.toContainText("conformed ·");
    // Its mark offers no conformance testing - nor turning them on, which is more than its own.
    await page.locator('.editor-colours .mark[aria-label^="functional spec print-hello,"]').click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["regenerate", "open its scenarios"]);
    await page.keyboard.press("Escape");
    // The test plain file's mark in the files, grey too.
    await page.locator('.tree-row[title="tests"]').click();
    await page.locator('.tree-row[title="tests/hello"]').click();
    await expect(page.locator(".tree-state.tests")).toHaveClass(/untested/);
  });

  test("are turned on from the module's header - written in config.turri.yaml, the module tested as before", async ({ launched: { window: page, project } }) => {
    scenarios(project);
    await page.locator(".conformed-count.off").getByRole("button", { name: "turn on" }).click();
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^conformance-tests: true$/m);
    await expect(page.locator(".status-said")).toHaveText("conformance tests turned on - written in config.turri.yaml.");
    // By turri itself, as its tool does it - not /turri-config's words in the chat.
    await expect(page.locator(".chat-body")).not.toContainText("written to config.turri.yaml");
    // On: counted as turri counts it - nothing built, so nothing tested yet.
    await expect(page.locator(".conformed-count")).toHaveText(/0 of 1 conformed/);
    await expect(page.locator(".scenario-chip")).not.toHaveClass(/untested/);
  });

  test("are turned on from the project's settings, which say what does nothing while they are off", async ({ launched: { app, window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", "project-settings"));
    const sheet = page.getByRole("dialog", { name: "project settings" });
    const conformance = sheet.getByRole("switch", { name: "conformance-tests" });
    await expect(conformance).toHaveAttribute("aria-checked", "false");
    await expect(sheet.locator(".project-setting", { has: page.getByLabel("conformance-tests-script", { exact: true }) })).toContainText("no effect while conformance tests are off");
    await conformance.click();
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^conformance-tests: true$/m);
    await expect(conformance).toHaveAttribute("aria-checked", "true");
    await expect(sheet).not.toContainText("no effect while conformance tests are off");
  });

});

test.describe("the chat's conformance tools", () => {
  test("say what conform tests - named, the module's, or written again from scratch, its whole chain's too", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:message", {
      role: "assistant",
      text: "",
      tools: [
        { id: "c1", name: "conform", args: { plain_file: "hello.plain", funcIds: ["hello:print-hello"] } },
        { id: "c2", name: "conform", args: { plain_file: "hello.plain" } },
        { id: "c3", name: "conform", args: { plain_file: "hello.plain", from_scratch: "module" } },
        { id: "c4", name: "conform", args: { plain_file: "app/hello.plain", from_scratch: "chain" } },
      ],
    });
    await expect(window.locator(".tool-call")).toHaveText([
      "conformance testing hello:print-hello",
      "conformance testing hello.plain",
      "writing hello's conformance tests again, from scratch",
      "writing hello's conformance tests and its whole chain's again, from scratch",
    ]);
  });

  test("have no renderer left for the tools turri dropped - said by their names, as any tool it does not know", async ({ launched: { app, window } }) => {
    // A file's result no longer carries the file written: that was turn_on_conformance_tests's.
    expect(normalise({ role: "toolResult", toolCallId: "t1", toolName: "write", content: [{ type: "text", text: "…" }], isError: false, details: { file: "config.turri.yaml" } })).not.toHaveProperty("file");
    await tellChat(app, window, "chat:message", {
      role: "assistant",
      text: "",
      tools: [
        { id: "t1", name: "turn_on_conformance_tests", args: {} },
        { id: "t2", name: "evaluate_tests", args: { funcIds: ["hello:print-hello"] } },
        { id: "t3", name: "change_plain", args: { plain_file: "hello.plain", diff: "-a\n+b" } },
      ],
    });
    await expect(window.locator(".tool-call")).toHaveText(["turn on conformance tests", "evaluate tests", "change plain · hello.plain"]);
    await expect(window.locator(".tool-call .tool-diff")).toHaveCount(0);
  });

  test("say what pulses looks up - one, a look ahead at a module, or every one", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:message", {
      role: "assistant",
      text: "",
      tools: [
        { id: "p1", name: "pulses", args: {} },
        { id: "p2", name: "pulses", args: { runs: 6 } },
        { id: "p3", name: "pulses", args: { plain_file: "hello.plain" } },
        { id: "p4", name: "pulses", args: { job_id: "planned-hello-1" } },
      ],
    });
    await expect(window.locator(".tool-call")).toHaveText(["listed the pulses", "listed the pulses, and 6 earlier runs", "looked ahead at hello.plain - planned, nothing started", "looked up planned-hello-1"]);
  });
});
