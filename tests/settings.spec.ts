import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, offers, test } from "./app.ts";

/** A menu item chosen: the window in front is sent its action, as the native menu sends it - once it is drawn, to hear it. */
async function choose(app: ElectronApplication, page: Page, action: string) {
  await expect(page.locator(".welcome, .app").first()).toBeVisible();
  await app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", action), action);
}

test.describe("first run", () => {
  test.use({ open: false, recent: false });

  test("leads the way from the machine to a first project", async ({ launched: { window: page } }) => {
    const steps = page.getByRole("list", { name: "getting started" });
    await expect(steps).toBeVisible();
    await expect(steps.locator("> li")).toHaveCount(3);
    // The test's ANTHROPIC_API_KEY is a provider turri can reach.
    await expect(steps.locator("> li", { hasText: "turri can reach a model" })).toHaveClass(/done/);
    await expect(steps).toContainText("start your first project");
  });
});

test.describe("settings", () => {
  test.use({ open: false, recent: true });

  test("change the look and the models new projects start on, and keep them", async ({ launched: { app, window: page } }) => {
    await choose(app, page, "settings");
    const sheet = page.getByRole("dialog", { name: "settings" });
    await sheet.getByRole("button", { name: "light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const vendor = sheet.getByRole("combobox", { name: "the models new projects start on" });
    const first = await vendor.locator("option").nth(1).getAttribute("value");
    await vendor.selectOption(first!);
    await sheet.getByRole("switch", { name: "pre-releases too" }).click();
    const saved = await page.evaluate(() => window.turri.settings.get());
    expect(saved).toMatchObject({ theme: "light", vendor: first, prerelease: true, checkUpdates: true });
    // Run from source, the app does not update itself: the sheet says so.
    await expect(sheet).toContainText("cannot update itself here");
  });

  test("refuses a setting there is not", async ({ launched: { window: page } }) => {
    const saved = await page.evaluate(() => window.turri.settings.set({ theme: "purple", zoom: "big", nonsense: 1 } as never));
    expect(saved.theme).toBe("dark");
    expect(saved.zoom).toBe(0);
    expect(saved).not.toHaveProperty("nonsense");
  });
});

test.describe("about", () => {
  test.use({ open: false, recent: true });

  test("says what the app is made of, what it sends, and its third-party notices", async ({ launched: { app, window: page } }) => {
    await choose(app, page, "about");
    const sheet = page.getByRole("dialog", { name: "about turri" });
    await expect(sheet.locator(".about-versions")).toContainText("Electron");
    await sheet.getByRole("tab", { name: "privacy" }).click();
    await expect(sheet).toContainText("the app collects no telemetry");
    await sheet.getByRole("tab", { name: "third-party notices" }).click();
    await sheet.getByRole("searchbox").fill("react-dom");
    const row = sheet.locator(".notice-row", { hasText: "react-dom" });
    await expect(row).toContainText("MIT");
    await row.click();
    await expect(sheet.locator(".notice-text pre")).toContainText("Permission is hereby granted");
  });
});

test.describe("the window's reach", () => {
  test("is sandboxed, and opens only the project's own files", async ({ launched: { app, window: page }, scratch }) => {
    await expect(page.locator(".editor textarea")).toHaveValue(/Greeter/);
    // The window's renderer, as the system sees it: sandboxed (said on macOS; Linux leaves it unsaid).
    const sandboxed = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
      return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
    });
    if (process.platform === "darwin") expect(sandboxed).toBe(true);
    const outside = await page.evaluate(() => window.turri.openPath("/bin/sh").then(() => "opened", (error: Error) => error.message));
    expect(outside).toMatch(/not a file of this project/);
    // An empty folder the new-project sheet did not make is not its to take away.
    const empty = join(scratch, "empty");
    mkdirSync(empty);
    await page.evaluate((dir) => window.turri.abandonProject(dir), empty);
    expect(existsSync(empty)).toBe(true);
  });
});

test.describe("a project's settings", () => {
  test("are in the menu bar, File > Project Settings…, and changed through /turri-config", async ({ launched: { app, window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    // Not in the window's toolbar: in the menu bar, and chosen there - sent as the menu sends it, as a hidden window is
    // never the one in front, which the menu acts on (and enables it for).
    await expect(page.getByRole("button", { name: "project settings" })).toHaveCount(0);
    const item = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.find((menu) => menu.label === "File")?.submenu?.items.some((entry) => entry.label === "Project Settings…"));
    expect(await item()).toBe(true);
    await choose(app, page, "project-settings");
    const sheet = page.getByRole("dialog", { name: "project settings" });
    // As config.turri.yaml has them, the models among turri's own choices.
    await expect(sheet.getByRole("combobox", { name: "harness-model", exact: true })).toHaveValue("anthropic/claude-sonnet-5-5");
    // Conformance tests on or off, a switch - on, as the fixture has them - beside the test advisor's start and the test
    // plain files' folder.
    await expect(sheet.getByRole("switch", { name: "conformance-tests" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByRole("switch", { name: "test-advisor" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByLabel("test-dir", { exact: true })).toBeVisible();
    // Every setting of the file, as /turri-config knows them - not only the ones the sidebar used to show.
    await expect(sheet.getByRole("switch", { name: "mutation-testing" })).toBeVisible();
    await expect(sheet.getByRole("switch", { name: "release-after-pulse" })).toBeVisible();
    const review = sheet.getByRole("switch", { name: "review" });
    await expect(review).toHaveAttribute("aria-checked", "false");
    // Sent as the person would type it - a slash command, no model called - and written into the file, comments kept.
    await review.click();
    await expect(page.locator(".chat-body")).toContainText("review: true - written to config.turri.yaml, in effect from the next pulse");
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^review: true$/m);
    expect(readFileSync(join(project, "config.turri.yaml"), "utf8")).toContain("# The app's tests open this project");
    await expect(review).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("a model setting", () => {
  test.use({ env: { OPENAI_API_KEY: "sk-test" } });

  test("offers every model of every provider signed in to - more than forty - grouped by provider", async ({ launched: { app, window: page } }) => {
    test.skip(!(await offers(page)).settingChoices, "the turri running offers a setting's first forty values alone");
    await expect(page.locator(".chat-model")).toBeVisible();
    await choose(app, page, "project-settings");
    const model = page.getByRole("dialog", { name: "project settings" }).getByRole("combobox", { name: "harness-model", exact: true });
    await expect(model).toHaveValue("anthropic/claude-sonnet-5-5");
    // Anthropic's, the project's, and OpenAI's, signed in to as well - and any this machine is signed in to - each model
    // by its id under its provider.
    await expect.poll(() => model.locator("optgroup").evaluateAll((groups) => groups.map((group) => group.getAttribute("label")))).toEqual(expect.arrayContaining(["anthropic", "openai"]));
    expect(await model.locator("option").count()).toBeGreaterThan(40);
    await expect(model.locator("optgroup[label=openai] option").first()).not.toContainText("openai/");
    // Chosen across providers, sent as the person would type it.
    const openai = await model.locator("optgroup[label=openai] option").first().getAttribute("value");
    await model.selectOption(openai!);
    await expect(page.locator(".chat-body")).toContainText(`harness-model: ${openai}`);
  });
});

test.describe("a folder setting", () => {
  test("is chosen in the system's sheet - in the project or beside it, never the project itself or turri's own", async ({ launched: { app, window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    mkdirSync(join(project, "assets"));
    // The system's sheet answers with each folder in turn.
    const answer = (path: string) =>
      app.evaluate(({ dialog }, chosen) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as unknown as typeof dialog.showOpenDialog;
      }, path);
    await choose(app, page, "project-settings");
    const sheet = page.getByRole("dialog", { name: "project settings" });
    const row = sheet.locator(".project-setting", { has: page.getByLabel("base-folder", { exact: true }) });
    const pick = row.getByRole("button", { name: "choose…" });

    // The project's own folder, one holding it, or turri's: refused, saying why.
    await answer(project);
    await pick.click();
    await expect(row.getByRole("alert")).toHaveText("that is the project's own folder - choose a folder in it, or beside it.");
    await answer(join(project, "plain_modules", "hello"));
    await pick.click();
    await expect(row.getByRole("alert")).toContainText("that is turri's own");

    // One in it: sent as /turri-config, written by turri, by its path from the project's folder.
    await answer(join(project, "assets"));
    await pick.click();
    await expect(row.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".chat-body")).toContainText("base-folder: assets - written to config.turri.yaml");
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^base-folder: assets$/m);
    // One beside it, by a path that goes up out of it.
    await answer(join(project, "..", "legacy-app"));
    await pick.click();
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^base-folder: \.\.\/legacy-app$/m);
  });
});

test.describe("⌘R", () => {
  test("reloads the window back onto its project, not its welcome screen", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await choose(app, page, "reload");
    await page.waitForEvent("domcontentloaded");
    // The project it had, its engine never stopped - the conversation taken up from it.
    await expect(page.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(page.locator(".welcome")).toHaveCount(0);
    await expect(page.locator(".chat-model")).toHaveText("claude-sonnet-5-5");
  });

  test("in the preview reloads its page, never the window", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await page.getByRole("tab", { name: "preview" }).click();
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    await choose(app, page, "reload");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    await expect(page.getByRole("tab", { name: "preview", selected: true })).toBeVisible();
  });
});

test.describe("the files' sidebar", () => {
  test("shows only the ***plain and the resources it links - no config, test scripts or what turri keeps", async ({ launched: { window: page, project, spec } }) => {
    test.skip(!(await offers(page)).resources, "the turri running gives no linked resources in its graph");
    for (const dir of ["test_scripts", "plain_modules", ".turri", "resources", "notes"]) mkdirSync(join(project, dir), { recursive: true });
    writeFileSync(join(project, "test_scripts", "run_unittests.sh"), "#!/bin/sh\n");
    writeFileSync(join(project, "plain_modules", "hello.txt"), "built\n");
    writeFileSync(join(project, ".turri", "state.json"), "{}\n");
    writeFileSync(join(project, "resources", "greeting.yaml"), "greeting: hello\n");
    writeFileSync(join(project, "resources", "unlinked.yaml"), "nobody: links me\n");
    writeFileSync(join(project, "notes", "todo.md"), "- nothing\n");
    writeFileSync(spec, readFileSync(spec, "utf8").replace("greets the person running it.", "greets the person running it, as [the greeting](resources/greeting.yaml) says."));
    const names = () => page.locator(".tree-row .tree-name").allTextContents();
    await expect.poll(names).toEqual(["resources", "hello.plain"]);
    await page.locator(".tree-row", { hasText: "resources" }).click();
    await expect.poll(names).toEqual(["resources", "greeting.yaml", "hello.plain"]);
    // Linked no more, it goes - and its folder with it.
    writeFileSync(spec, readFileSync(spec, "utf8").replace(", as [the greeting](resources/greeting.yaml) says.", "."));
    await expect.poll(names).toEqual(["hello.plain"]);
  });

  test.describe("in debug mode", () => {
    test.use({ debug: true });

    test("shows every file of the project - but version control's and installed packages - and only the ***plain again once it is off", async ({ launched: { window: page, project } }) => {
      for (const dir of ["test_scripts", "plain_modules/hello", ".turri/debug", ".git", "node_modules"]) mkdirSync(join(project, dir), { recursive: true });
      writeFileSync(join(project, "test_scripts", "run_unittests.sh"), "#!/bin/sh\n");
      writeFileSync(join(project, "plain_modules", "hello", "main.py"), "print('hello')\n");
      writeFileSync(join(project, ".turri", "debug", "coding-agent.log"), "…\n");
      writeFileSync(join(project, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(project, "node_modules", "left-pad.js"), "\n");
      const names = () => page.locator(".tree-row .tree-name").allTextContents();
      await expect.poll(names).toEqual([".turri", "plain_modules", "test_scripts", "config.turri.yaml", "hello.plain"]);
      // What turri built, and what it keeps for debugging: each folder opened as any.
      for (const path of ["plain_modules", "plain_modules/hello", ".turri", ".turri/debug"]) await page.locator(`.tree-row[title="${path}"]`).click();
      await expect.poll(names).toEqual(expect.arrayContaining(["debug", "coding-agent.log", "hello", "main.py"]));
      expect(await names()).not.toContain("HEAD");
      // Off - /turri-config debug false writes it so: the ***plain alone, the folders open listed again.
      const config = join(project, "config.turri.yaml");
      writeFileSync(config, readFileSync(config, "utf8").replace("debug: true", "debug: false"));
      await expect.poll(names).toEqual(["hello.plain"]);
    });
  });

  test("hides and shows, by the toolbar's button and ⌘B, and stays as it was left", async ({ launched: { app, window: page } }) => {
    const sidebar = page.locator(".sidebar");
    const toggle = page.getByRole("button", { name: "hide the files" });
    await expect(sidebar).toBeVisible();
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(page.getByRole("button", { name: "show the files" })).toHaveAttribute("aria-pressed", "false");
    // Hidden it stays, the window drawn again.
    await page.reload();
    await expect(page.locator(".chat-model")).toBeVisible();
    await expect(sidebar).toHaveCount(0);
    // View > Show or Hide the Files, ⌘B: as the menu sends it.
    await choose(app, page, "sidebar");
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("button", { name: "hide the files" })).toHaveAttribute("aria-pressed", "true");
  });

  test("leaves the traffic lights their room at the window's left - the chat's header, or the toolbar's with the chat hidden", async ({ launched: { app, window: page } }) => {
    const left = (selector: string) => () => page.locator(selector).first().evaluate((element) => Math.round(element.getBoundingClientRect().left));
    const darwin = process.platform === "darwin";
    // The chat at the window's left, its tabs right of the traffic lights.
    await expect.poll(left(".chat-top > :first-child")).toBe(darwin ? 78 : 16);
    // The chat hidden, the toolbar's first button is there.
    await page.locator(".chat button[title^='hide the chat']").click();
    await expect.poll(left(".toolbar > :first-child")).toBe(darwin ? 78 : 12);
    expect(await left(".toolbar .segmented")()).toBeLessThan(220);
    // Full screen, as the main process says it: no traffic lights to leave room for.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("fullscreen", true));
    await expect.poll(left(".toolbar > :first-child")).toBe(12);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("fullscreen", false));
    await expect.poll(left(".toolbar > :first-child")).toBe(darwin ? 78 : 12);
  });

  test("starts at the window's top: the project's name in its title bar, the files straight below", async ({ launched: { window: page } }) => {
    await expect(page.locator(".tree-row").first()).toBeVisible();
    const top = (selector: string) => page.locator(selector).first().evaluate((element) => Math.round(element.getBoundingClientRect().top));
    expect(await top(".project-name")).toBe(0);
    expect(await top(".sidebar-section")).toBe(52);
    expect(await top(".tree-row")).toBeLessThan(100);
  });

  test("is shown or hidden on ⌘B, by View's menu", async ({ launched: { app } }) => {
    const item = await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((each) => each.label === "View")!;
      const files = view.submenu!.items.find((each) => each.label === "Show or Hide the Files");
      return files?.accelerator ?? null;
    });
    expect(item).toBe("CmdOrCtrl+B");
  });
});

test.describe("the window's text", () => {
  // A button's label is not among them: a click presses it - or, disabled, is not heard - as in any app.
  test("can all be selected, as in a document - the sidebar, the headers, the chat", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    for (const [where, text] of [
      [page.locator(".sidebar-section", { hasText: "files" }), "files"],
      [page.locator(".project-name span"), "hello"],
      [page.locator(".chat-model"), "claude-sonnet-5-5"],
      [page.locator(".editor-pane .pane-header").getByText("hello.plain", { exact: true }), "hello.plain"],
      [page.locator(".editor-pane .pane-header").getByText("0 of 1 regenerated"), "0 of 1 regenerated"],
    ] as const) {
      await where.click({ clickCount: 3 });
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain(text);
    }
  });
});

test.describe("a project just started", () => {
  test.use({ open: false });

  test("is made where the last new project was - the system's save sheet starting there, not in Documents", async ({ launched: { app, window: page }, scratch }) => {
    // The save sheet answered with a folder in a place of the person's own, and asked where it starts - each time.
    await app.evaluate(({ dialog }, scratch) => {
      const asked: string[] = [];
      (globalThis as unknown as { asked: string[] }).asked = asked;
      dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => {
        asked.push(options.defaultPath ?? "");
        return { canceled: false, filePath: `${scratch}/work/projects/project-${asked.length}` };
      }) as unknown as typeof dialog.showSaveDialog;
    }, scratch);
    await page.evaluate(() => window.turri.newProject());
    await page.evaluate(() => window.turri.newProject());
    const asked = await app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked);
    // The first, with none made before: Documents. The next, beside the one made.
    expect(asked[0]).not.toContain(scratch);
    expect(asked[1]).toBe(join(scratch, "work", "projects", "my-project"));
  });

  test("on Amazon Bedrock in a geography of its own, says the AWS region turri calls its models in - nothing to set in a shell", async ({ launched: { app, window: page }, scratch }) => {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: dir })) as typeof dialog.showSaveDialog;
    }, join(scratch, "on-bedrock"));
    await choose(app, page, "new-project");
    await page.locator(".new-project .option").filter({ hasText: "Amazon Bedrock" }).click();
    await page.locator(".bedrock .segmented button", { hasText: /^Anthropic$/ }).click();
    await page.locator(".bedrock .segmented button", { hasText: /^eu$/ }).click();
    await expect(page.locator(".bedrock-note")).toHaveText(/^turri calls these models in eu-central-1, as they answer only in eu/);
    await expect(page.locator(".bedrock-note")).not.toContainText("set AWS_REGION");
  });

  test("starts from a folder chosen as it is made - written as base-folder: through /turri-config, said in its empty view", async ({ launched: { app, window: page }, scratch }) => {
    const dir = join(scratch, "on-legacy");
    mkdirSync(join(scratch, "legacy"), { recursive: true });
    // The save sheet answers with the new folder, the folder sheet with one beside it; the doctor finds nothing.
    await app.evaluate(({ dialog, ipcMain }, [dir, legacy]) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: dir })) as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [legacy] })) as unknown as typeof dialog.showOpenDialog;
      ipcMain.removeHandler("doctor:run");
      ipcMain.handle("doctor:run", () => []);
    }, [dir, join(scratch, "legacy")] as const);
    await choose(app, page, "new-project");
    const sheet = page.locator(".new-project");
    await expect(sheet.locator(".new-project-start")).toContainText("nothing - the code starts empty");
    await sheet.getByRole("button", { name: "a folder…" }).click();
    await expect(sheet.locator(".new-project-start code")).toHaveText("../legacy");
    await sheet.locator(".option").filter({ hasText: "Anthropic" }).first().click();
    await sheet.getByRole("button", { name: "create" }).click();

    // Open, and written as the person would type it - turri saying so in the chat.
    await expect(page.locator(".chat-body")).toContainText("base-folder: ../legacy - written to config.turri.yaml");
    await expect.poll(() => readFileSync(join(dir, "config.turri.yaml"), "utf8")).toMatch(/^base-folder: \.\.\/legacy$/m);
    // No ***plain yet: it says what the code starts from.
    await expect(page.locator(".empty-start")).toContainText("its code starts from ../legacy");
  });

  test("opens on the conversation - the chat two thirds of the window, the files hidden - until its first ***plain", async ({ launched: { app, window: page }, scratch }) => {
    const dir = join(scratch, "fresh");
    // The system's save sheet answered with a folder, and the doctor's checks finding nothing - so no model is asked.
    await app.evaluate(({ dialog, ipcMain }, dir) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: dir })) as typeof dialog.showSaveDialog;
      ipcMain.removeHandler("doctor:run");
      ipcMain.handle("doctor:run", () => []);
    }, dir);
    await choose(app, page, "new-project");
    await page.locator(".new-project .option").filter({ hasText: "Anthropic" }).first().click();
    await page.getByRole("button", { name: "create" }).click();

    await expect(page.locator(".main .empty h3")).toHaveText("no plain yet");
    await expect(page.locator(".sidebar")).toHaveCount(0);
    const width = (selector: string) => () => page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().width));
    const wide = await page.evaluate(() => window.innerWidth);
    await expect.poll(width(".chat")).toBe(Math.round((wide * 2) / 3));
    // Not kept as the person's own: the next project opens as they left it.
    expect(await page.evaluate(() => localStorage.getItem("turri-app.sidebar"))).not.toBe("hidden");

    // The first ***plain written: the files, and the chat as wide as it was.
    writeFileSync(join(dir, "fresh.plain"), "***definitions***\n\n- :App: is the app.\n\n***functional specs***\n\n- :App: says hello.\n");
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect.poll(width(".chat")).toBeLessThan(Math.round((wide * 2) / 3));
    // And it is open, where "no ***plain yet" was.
    await expect(page.locator(".editor-pane .pane-header")).toContainText("fresh.plain");
  });
});
