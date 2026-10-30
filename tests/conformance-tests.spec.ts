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

  test("show a module's scenarios as not tested, and offer nothing that tests - but turning them on", async ({ launched: { window: page, project } }) => {
    scenarios(project);
    const header = page.locator(".editor-pane .pane-header");
    await expect(header.locator(".conformed-count.off")).toContainText("conformance tests off");
    // Its scenarios there, grey, not tested - and never counted conformed.
    const chip = page.locator(".scenario-chip");
    await expect(chip).toHaveClass(/untested/);
    await expect(chip).toHaveAttribute("title", /not tested: conformance tests are off/);
    await expect(header).not.toContainText("conformed ·");
    // Its mark offers no conformance testing, nor the test advisor: turning them on instead.
    await page.locator('.editor-colours .mark[aria-label^="functional spec print-hello,"]').click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["regenerate", "open its scenarios", "turn on conformance tests"]);
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
    await expect(sheet.locator(".project-setting", { has: page.getByRole("switch", { name: "test-advisor" }) })).toContainText("no effect while conformance tests are off");
    await conformance.click();
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^conformance-tests: true$/m);
    await expect(conformance).toHaveAttribute("aria-checked", "true");
    await expect(sheet).not.toContainText("no effect while conformance tests are off");
  });

  test("leave the test advisor refusing - in turri's words, not the IPC's", async ({ launched: { window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    const refused = await page.evaluate((file) => window.turri.call("evaluateTests", { file, funcIds: ["print-hello"] }).then(() => "", (error: Error) => error.message), join(project, "hello.plain"));
    expect(refused).toMatch(/conformance-tests/);
  });
});

test.describe("the chat's conformance tools", () => {
  test("say conformance tests turned on, and the file written - and what conform tests", async ({ launched: { app, window } }) => {
    // The file the tool wrote reaches the window with its result.
    expect(normalise({ role: "toolResult", toolCallId: "t1", toolName: "turn_on_conformance_tests", content: [{ type: "text", text: "…" }], isError: false, details: { file: "config.turri.yaml" } })).toMatchObject({ file: "config.turri.yaml" });
    await tellChat(app, window, "chat:message", { role: "assistant", text: "", tools: [{ id: "t1", name: "turn_on_conformance_tests", args: {} }, { id: "c1", name: "conform", args: { plain_file: "hello.plain", funcIds: ["hello:print-hello"] } }] });
    await tellChat(app, window, "chat:message", { role: "toolResult", id: "t1", name: "turn_on_conformance_tests", text: "…", isError: false, file: "config.turri.yaml" });
    await expect(window.locator(".tool-call")).toHaveText(["conformance tests turned on - written in config.turri.yaml", "conformance testing hello:print-hello"]);
  });
});
