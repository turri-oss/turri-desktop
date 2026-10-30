import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clickMenu, expect, offers, tellChat, test } from "./app.ts";

// Only what calls no model: slash commands that print, and the window's own.
test.describe("the chat", () => {
  test("is on the project's harness-model", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toHaveText("claude-sonnet-5-5");
  });

  test("suggests slash commands as one is typed", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/std");
    await expect(window.locator(".suggestions")).toContainText("/stdlib");
  });

  test("opens a concept clicked in the chat where the ***plain defines it", async ({ launched: { app, window } }) => {
    // Where it is defined, from turri's graph: on a turri whose host entry gives it.
    test.skip(!(await offers(window)).links, "the turri running gives the window no graph of the ***plain");
    await tellChat(app, window, "chat:message", { role: "assistant", text: "The :Greeter: greets whoever runs it." });
    await window.locator(".toolbar").getByRole("tab", { name: "preview" }).click();
    await window.locator(".prose .plain-concept", { hasText: ":Greeter:" }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    // Its definition, lit: line 6 of hello.plain.
    await expect(window.locator(".editor-colours > div.revealed")).toContainText(":Greeter: is a command-line program");
  });

  test("offers the concepts the ***plain names as one is typed, and takes one", async ({ launched: { window } }) => {
    // Concepts as turri reads them: on a turri whose host entry gives them.
    test.skip(!(await offers(window)).concepts, "the turri running gives the window no concepts");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("what does :Gre");
    const offered = window.getByRole("listbox", { name: "concepts" });
    // The fixture's own, with what its definition says; and ***plain's own, which it does not start.
    await expect(offered.getByRole("option").first()).toContainText(":Greeter:");
    await expect(offered).toContainText("greets the person running it");
    await box.press("Tab");
    await expect(box).toHaveValue("what does :Greeter: ");
    await expect(offered).toHaveCount(0);
    // Not after a concept closed: its colon opens none.
    await box.fill("what does :Greeter:");
    await expect(offered).toHaveCount(0);
  });

  test("completes a file the tree shows with tab - the one it fits, or a choice of those it fits", async ({ launched: { window, project } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    // What tab completes from is the files the tree shows, read as the project opens - a moment after the chat is there,
    // longer on a slow machine: tried again until they are.
    await expect(async () => {
      await box.fill("/regenerate hel");
      await box.press("Tab");
      await expect(box).toHaveValue("/regenerate hello.plain ", { timeout: 1000 });
    }).toPass();
    // Nothing it fits: tab leaves the draft as it is, and the focus in the box.
    await box.fill("/regenerate xyz");
    await box.press("Tab");
    await expect(box).toHaveValue("/regenerate xyz");
    await expect(box).toBeFocused();
    // Two it fits: both offered, the arrows choose and enter takes one.
    writeFileSync(join(project, "helper.plain"), "***definitions***\n\n- :Helper: helps.\n");
    await expect(window.locator(".sidebar")).toContainText("helper.plain");
    await box.fill("/regenerate hel");
    await box.press("Tab");
    const offered = window.getByRole("listbox", { name: "files" });
    await expect(offered.getByRole("option")).toHaveText(["hello.plain", "helper.plain"]);
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(box).toHaveValue("/regenerate helper.plain ");
    await expect(offered).toHaveCount(0);
    // No word begun: every file offered, none taken - enter takes the one chosen. Tried again until the draft is only what
    // is typed: on a slow machine, the one just taken may still be put in it as this is typed.
    await expect(async () => {
      await box.fill("");
      await box.fill("/regenerate ");
      await box.press("Tab");
      await expect(box).toHaveValue("/regenerate ", { timeout: 1000 });
    }).toPass();
    await expect(offered.getByRole("option").filter({ hasText: "hello.plain" })).toHaveCount(1);
    await expect(offered.getByRole("option").filter({ hasText: "helper.plain" })).toHaveCount(1);
    await box.press("Escape");
    await expect(offered).toHaveCount(0);
  });

  test("offers the commands on tab in an empty box", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("");
    await box.press("Tab");
    await expect(box).toHaveValue("/");
    await expect(box).toBeFocused();
    await expect(window.locator(".composer .suggestions li").first()).toBeVisible();
  });

  test("runs a slash command that only prints", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    // ***plain written as its name is: its mark, then plain.
    await expect(window.locator(".chat-body .plain-name", { hasText: "plain" }).first()).toBeVisible();
    await expect(window.locator(".chat-body")).toContainText("The plain standard library");
    await expect(window.locator(".chat-body")).toContainText("stdlib/backend/python-fastapi");
    // Nothing went to the model: no turn started, nothing spent.
    await expect(window.locator(".chat-body .msg.assistant")).toHaveCount(0);
  });

  test("opens the sign-in sheet for /login, rather than sending it", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/login");
    await box.press("Enter");
    await expect(window.locator(".sheet.auth h2")).toHaveText("sign in to your models");
    await expect(window.locator(".chat-body .msg.assistant")).toHaveCount(0);
  });

  test("leaves /pulses, the terminal's side panel, out of what / offers, and shows regen for it, rather than sending it", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/");
    await expect(window.locator(".suggestions li", { hasText: "/regenerate" })).toBeVisible();
    await expect(window.locator(".suggestions")).not.toContainText("/pulses");
    await expect(window.locator(".suggestions")).not.toContainText("ctrl+h");
    await box.fill("/pulses");
    await box.press("Enter");
    await expect(window.locator(".dive").getByRole("tab", { name: "regen", selected: true })).toBeVisible();
    await window.locator(".dive .dive-back").click();
    await expect(window.locator(".chat-body .msg.assistant")).toHaveCount(0);
  });

  test("writes ***plain as its name is, its mark then plain - but not in code", async ({ launched: { window, app } }) => {
    // The window's own words: the empty chat's.
    await expect(window.locator(".chat-empty .plain-name img.plain-mark")).toHaveAttribute("src", "./plain/plain-mark.svg");
    await tellChat(app, window, "chat:notify", { level: "info", text: "the \\*\\*\\*plain says so - `***plain` in code stays as it is." });
    const note = window.locator(".chat-body .msg.note", { hasText: "says so" });
    await expect(note.locator(".plain-name")).toHaveCount(1);
    await expect(note.locator("code")).toHaveText("***plain");
  });

  test("colours a ```plain block by turri's grammar", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // As the engine says a note: what a model would write, without one.
    await tellChat(app, window, "chat:notify", {
      level: "info",
      text: "the change:\n\n```plain\n***definitions***\n\n- :Greeter: is a command-line program.\n```",
    });
    const block = window.locator(".chat-body pre.plain-code");
    await expect(block.locator(".plain-concept").first()).toHaveText(":Greeter:");
    await expect(block).toHaveText("***definitions***\n\n- :Greeter: is a command-line program.");
  });

  test("colours a block with no language that is ***plain, and leaves other code alone", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const say = (text: string) => tellChat(app, window, "chat:notify", { level: "info", text });
    await say(
      '```\n---\nimport:\n  - stdlib/backend/python-fastapi\ndescription: A small HTTP server.\n---\n\n***definitions***\n\n- :Server: is the HTTP service this module builds, named `server`.\n\n***functional specs***\n\n- :Server: answers `GET /` with `200` and the JSON body `{"name": "server"}`.\n```',
    );
    await say("```\nprint('***not plain***, as no line is only a section')\n```");
    await expect(window.locator(".chat-body pre.plain-code .plain-concept").first()).toHaveText(":Server:");
    await expect(window.locator(".chat-body pre.plain-code .plain-section").first()).toHaveText("***definitions***");
    await expect(window.locator(".chat-body pre.plain-code")).toHaveCount(1);
  });

  test("colours a diff, and the ***plain in a diff of ***plain", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const say = (text: string) => tellChat(app, window, "chat:notify", { level: "info", text });
    await say("```diff\n--- a/hello.plain\n+++ b/hello.plain\n@@ -1,2 +1,2 @@\n ***definitions***\n-- :Greeter: greets.\n+- :Greeter: greets the person.\n```");
    await say("```diff\n--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-print('hi')\n+print('hello, world')\n```");
    const [plain, code] = [window.locator(".chat-body pre.diff").first(), window.locator(".chat-body pre.diff").nth(1)];
    await expect(plain.locator(".line.add .plain-concept")).toHaveText(":Greeter:");
    await expect(plain.locator(".line.del")).toHaveText("-- :Greeter: greets.");
    await expect(plain.locator(".line.hunk")).toHaveText("@@ -1,2 +1,2 @@");
    await expect(code.locator(".line.add")).toHaveText("+print('hello, world')");
    await expect(code.locator("[class^='plain-']")).toHaveCount(0);
  });

  test("once hidden, is opened again by the turri button, leftmost in the toolbar", async ({ launched: { window } }) => {
    await window.locator(".chat button[title^='hide the chat']").click();
    const open = window.locator(".toolbar > :first-child");
    await expect(open).toHaveText("turri");
    await expect(open.locator("img")).toHaveAttribute("src", "./jellyfish/logo-mark.svg");
    await open.click();
    await expect(window.locator(".chat-model")).toBeVisible();
  });

  test("has no new session button: a new chat is a tab of its own", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await expect(window.locator(".chat-top button[aria-label='new session']")).toHaveCount(0);
  });

  test("opens a new chat with ⌘T, as a tab, and closes it with ⌘W", async ({ launched: { app, window } }) => {
    test.skip(!(await offers(window)).chats, "the turri running has one chat");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await tellChat(app, window, "chat:notify", { level: "info", text: "said in the first chat" });
    await box.fill("kept as it was");
    // One chat: one tab, with no × - ⌘W would close the window.
    const tabs = window.locator(".chat-tabs [role=tab]");
    await expect(tabs).toHaveCount(1);
    await expect(window.locator(".chat-tab-close")).toHaveCount(0);
    await clickMenu(app, "New Chat");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveText("new chat");
    // A chat of its own: nothing of the first said in it, nothing typed.
    await expect(window.locator(".chat-body")).not.toContainText("said in the first chat");
    await expect(box).toHaveValue("");
    // The first, shown again: what was said and typed in it is there.
    await tabs.nth(0).click();
    await expect(window.locator(".chat-body")).toContainText("said in the first chat");
    await expect(box).toHaveValue("kept as it was");
    // ⌘W closes the chat shown - its menu item says so - and the other is shown.
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await clickMenu(app, "Close Chat");
    await expect(tabs).toHaveCount(1);
    await expect(window.locator(".chat-body")).toContainText("said in the first chat");
    const closes = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((item) => item.label === "File")!.submenu!.items.some((item) => item.label === "Close Window"));
    expect(closes).toBe(true);
  });

  test("goes to the next chat with ctrl+tab and the one before with ctrl+shift+tab, round from the ends", async ({ launched: { app, window } }) => {
    test.skip(!(await offers(window)).chats, "the turri running has one chat");
    await window.locator(".chat-model").waitFor();
    const tabs = window.locator(".chat-tabs [role=tab]");
    await clickMenu(app, "New Chat");
    await clickMenu(app, "New Chat");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Tab");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Shift+Tab");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Shift+Tab");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("keeps a hidden chat's question until it is shown", async ({ launched: { app, window } }) => {
    test.skip(!(await offers(window)).chats, "the turri running has one chat");
    await window.locator(".chat-model").waitFor();
    const [first] = await window.evaluate(() => (window as unknown as { turri: { call: (method: string) => Promise<Array<{ id: string }>> } }).turri.call("chats"));
    await clickMenu(app, "New Chat");
    const tabs = window.locator(".chat-tabs [role=tab]");
    await expect(tabs).toHaveCount(2);
    await app.evaluate(({ BrowserWindow }, chat) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:ask", { chat, data: { id: 999, kind: "select", title: "which colour?", options: ["red", "blue"] } }), first!.id);
    // Asked in the chat not shown: its tab says so, the chat shown keeps its message box.
    await expect(tabs.nth(0).locator(".chat-tab-mark.asks")).toBeVisible();
    await expect(window.locator(".question-card")).toHaveCount(0);
    await tabs.nth(0).click();
    await expect(window.locator(".question-card h2")).toHaveText("which colour?");
    // The question alone heads it: no jellyfish, nor "turri asks", above it.
    await expect(window.locator(".question-card .jellyfish")).toHaveCount(0);
    await expect(window.locator(".question-card")).not.toContainText("turri asks");
  });

  test("clears the draft with ctrl+c in a chat doing nothing", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await window.locator(".chat-model").waitFor();
    await box.fill("not sent");
    await box.press("Control+c");
    await expect(box).toHaveValue("");
    // The window is still there: a draft cleared ends nothing.
    await expect(window.locator(".chat-model")).toBeVisible();
  });

  test("ends turri's session with ctrl+c in a chat doing nothing, as the terminal leaves turri - and its window closes", async ({ launched: { app, window } }) => {
    test.skip(!(await offers(window)).chats, "the turri running cannot end its session from a chat");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await window.locator(".chat-model").waitFor();
    const closed = window.waitForEvent("close");
    // The window may close before the press is done with: that is what is wanted.
    await box.press("Control+c").catch(() => {});
    await closed;
    // On Linux the app quits with its last window, and is no longer there to ask: none left either way.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)).toBe(0);
  });

  test("puts a question away once turri says it is over - declined, or its turn stopped", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:ask", { id: 998, kind: "select", title: "which colour?", options: ["red", "blue"] });
    await expect(window.locator(".question-card h2")).toHaveText("which colour?");
    await tellChat(app, window, "chat:unask", { id: 998 });
    await expect(window.locator(".question-card")).toHaveCount(0);
    await expect(window.getByPlaceholder("talk to turri - or / for a command")).toBeVisible();
  });

  test("declines a question with ctrl+c, and never stops the turn or closes the window for it", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:ask", { id: 999, kind: "select", title: "which colour?", options: ["red", "blue"] });
    await expect(window.locator(".question-card h2")).toHaveText("which colour?");
    // A chat doing nothing: ctrl+c without the question would end turri's session and close the window.
    await window.locator(".question-card").press("Control+c");
    await window.locator(".question-card").press("Control+c");
    await expect(window.locator(".question-card h2")).toHaveText("which colour?");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });
});

test.describe("a turn at work", () => {
  test.use({ stubModel: "silent" });

  test("is stopped by ctrl+c wherever the focus is, and the window stays", async ({ launched: { app, window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    const stop = window.locator(".composer-bar button", { hasText: "stop" });
    for (const focus of ["the message box", "nothing", "the ***plain"]) {
      await box.fill("hello");
      await box.press("Enter");
      await expect(stop).toBeVisible();
      // ctrl+c straight after a stop is ignored, as in the terminal: the turn under way a moment first.
      await window.waitForTimeout(700);
      await window.evaluate((where) => {
        if (where === "the message box") return;
        (document.activeElement as HTMLElement | null)?.blur();
        if (where === "the ***plain") document.querySelector<HTMLTextAreaElement>(".editor-pane textarea")?.focus();
      }, focus);
      await window.keyboard.press("Control+c");
      // On Linux ctrl+c in an editor outside the chat copies, as everywhere there: the turn goes on, stopped by the button.
      if (process.platform === "linux" && focus === "the ***plain") {
        await window.waitForTimeout(1000);
        await expect(stop, "copying in the ***plain, not stopping").toHaveCount(1);
        await stop.click();
      }
      await expect(stop, `stopped with the focus on ${focus}`).toHaveCount(0);
    }
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test("is stopped by escape too - but escape puts away a menu first, and in a chat doing nothing leaves its draft and the window", async ({ launched: { app, window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    const stop = window.locator(".composer-bar button", { hasText: "stop" });
    for (const focus of ["the message box", "nothing", "the ***plain"]) {
      await box.fill("hello");
      await box.press("Enter");
      await expect(stop).toBeVisible();
      await window.waitForTimeout(700);
      await window.evaluate((where) => {
        if (where === "the message box") return;
        (document.activeElement as HTMLElement | null)?.blur();
        if (where === "the ***plain") document.querySelector<HTMLTextAreaElement>(".editor-pane textarea")?.focus();
      }, focus);
      await window.keyboard.press("Escape");
      await expect(stop, `stopped with the focus on ${focus}`).toHaveCount(0);
    }

    // A functional spec's menu open: escape closes it, and the turn goes on.
    await box.fill("hello");
    await box.press("Enter");
    await expect(stop).toBeVisible();
    await window.waitForTimeout(700);
    await window.locator(".editor-colours .mark").first().click();
    await expect(window.getByRole("menu")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByRole("menu")).toHaveCount(0);
    await window.waitForTimeout(500);
    await expect(stop).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(stop).toHaveCount(0);

    // Doing nothing: the draft stays, and so does the window.
    await box.fill("not sent yet");
    await box.press("Escape");
    await window.waitForTimeout(500);
    await expect(box).toHaveValue("not sent yet");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test("says it is thinking with the turri icon jumping, a pixel at a time", async ({ launched: { window } }) => {
    const box = window.locator(".composer textarea");
    await box.fill("hello");
    await box.press("Enter");
    const jelly = window.locator(".chat-working img.jellyfish");
    await expect(jelly).toBeVisible();
    await expect(jelly).toHaveAttribute("src", /logo-mark\.svg$/);
    await expect(window.locator(".chat-working")).toContainText("thinking");
    expect(await jelly.evaluate((image) => [getComputedStyle(image).animationName, getComputedStyle(image).animationTimingFunction])).toEqual(["bob", "steps(1)"]);
  });

  test("shows what is said meanwhile at once, waiting, and runs a slash command at once", async ({ launched: { window, requests } }) => {
    // Its placeholder says otherwise while turri answers: the box by where it is.
    const box = window.locator(".composer textarea");
    await box.fill("hello");
    await box.press("Enter");
    await expect(window.locator(".composer-bar button", { hasText: "stop" })).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    await box.fill("and then this");
    await box.press("Enter");
    const waiting = window.locator(".msg.user.queued");
    await expect(waiting).toContainText("and then this");
    await expect(waiting).toContainText("waiting - turri has not read this yet");
    // A command turri's extension runs is not held for the turn: it runs, as in the terminal.
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The plain standard library");
    await expect(waiting).toHaveCount(1);
    expect(requests.length, "nothing more sent to the model while it answers").toBe(1);
    // Stopped, it is not heard: put back in the message box, as pi's terminal puts it back in its editor.
    await box.fill("still typing");
    await window.locator(".composer-bar button", { hasText: "stop" }).click();
    await expect(waiting).toHaveCount(0);
    await expect(box).toHaveValue("and then this\n\nstill typing");
  });
});

test.describe("a turn that ends", () => {
  test.use({ stubModel: "replies" });

  test("hears what was said meanwhile, which turns from waiting to said, after its reply", async ({ launched: { window, requests } }) => {
    const box = window.locator(".composer textarea");
    await box.fill("hello");
    await box.press("Enter");
    await expect.poll(() => requests.length).toBe(1);
    await box.fill("and then this");
    await box.press("Enter");
    const waiting = window.locator(".msg.user.queued", { hasText: "and then this" });
    await expect(waiting).toBeVisible();
    // Heard once the reply is written: said, after it, and the model asked again.
    await expect(waiting).toHaveCount(0, { timeout: 10_000 });
    const said = window.locator(".chat-body .msg.user:not(.queued)", { hasText: "and then this" });
    await expect(said).toHaveCount(1);
    await expect.poll(() => requests.length).toBe(2);
    const order = await window.locator(".chat-body .msg").evaluateAll((all) => all.map((each) => each.textContent?.trim() ?? ""));
    expect(order.indexOf("reply 1")).toBeGreaterThan(order.indexOf("hello"));
    expect(order.indexOf("and then this")).toBeGreaterThan(order.indexOf("reply 1"));
  });
});

test.describe("turri's questions", () => {
  test.use({ stubModel: "asks" });

  test("are declined with ctrl+c, one after another, the turn going on", async ({ launched: { app, window, requests } }) => {
    test.skip(!(await offers(window)).chats, "the turri running cannot decline a question");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("ask me things");
    await box.press("Enter");
    // Five questions, each declined: the next one asked, the turn still running - never stopped, nor the window closed.
    for (let n = 1; n <= 5; n++) {
      await expect(window.locator(".question-card h2")).toHaveText(`question ${n}?`);
      await window.keyboard.press("Control+c");
      await expect.poll(() => requests.length, `question ${n} declined, and the model told`).toBe(n + 1);
      expect(requests[n]).toContain("declined to answer");
    }
    await expect(window.locator(".question-card h2")).toHaveText("question 6?");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test("are put away when their turn is stopped", async ({ launched: { window } }) => {
    test.skip(!(await offers(window)).chats, "the turri running does not say a question is over");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("ask me something");
    await box.press("Enter");
    await expect(window.locator(".question-card h2")).toHaveText("question 1?");
    // The stop button is under the card: the chat's stop, as the engine has it.
    await window.evaluate(() =>
      (window as unknown as { turri: { call: (method: string, params?: unknown) => Promise<unknown> } }).turri
        .call("chats")
        .then((chats) => (window as unknown as { turri: { call: (method: string, params?: unknown) => Promise<unknown> } }).turri.call("abortChat", { chat: (chats as Array<{ id: string }>)[0]!.id })),
    );
    await expect(window.locator(".question-card")).toHaveCount(0);
    await expect(box).toBeVisible();
  });
});


test.describe("what is attached to a message", () => {
  test.use({ stubModel: "replies" });
  // A PNG of one pixel.
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  test("takes an image pasted into the message box, and sends it with the message for the model to see", async ({ launched: { window, requests } }) => {
    const box = window.locator(".composer textarea");
    await box.fill("what is in this?");
    await box.evaluate((element, png) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "dot.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PNG);
    const attached = window.getByRole("list", { name: "attached" });
    await expect(attached).toContainText("dot.png");
    // Taken off with its ×, and pasted again.
    await attached.getByRole("button", { name: "remove dot.png" }).click();
    await expect(attached).toHaveCount(0);
    await box.evaluate((element, png) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "dot.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PNG);
    await expect(attached).toContainText("dot.png");
    await expect(box).toHaveValue("what is in this?");
    await box.press("Enter");
    await expect(attached).toHaveCount(0);
    await expect(window.locator(".chat-body .msg.user", { hasText: "what is in this?" }).locator("img")).toBeVisible();
    await expect.poll(() => requests.some((request) => request.includes(PNG))).toBe(true);
  });

  test("names a file attached by its path, for turri to read", async ({ launched: { window, requests } }) => {
    await window.locator(".composer textarea").waitFor();
    await window.evaluate(() =>
      (window as unknown as { turri: { call: (method: string, params: unknown) => Promise<unknown> } }).turri.call("sendChat", { text: "read this", files: ["/tmp/notes.txt"] }),
    );
    await expect.poll(() => requests.some((request) => request.includes("read this\\n\\nAttached file: /tmp/notes.txt"))).toBe(true);
  });
});

test.describe("turri's parse", () => {
  test("says what it parsed - the project, for its folder - and so on a turri that named it validate", async ({ launched: { app, window } }) => {
    await tellChat(app, window, "chat:message", { role: "assistant", text: "", tools: [{ id: "p1", name: "parse", args: { target: "hello.plain" } }] });
    await tellChat(app, window, "chat:message", { role: "assistant", text: "", tools: [{ id: "p2", name: "parse", args: { target: "." } }] });
    await tellChat(app, window, "chat:message", { role: "assistant", text: "", tools: [{ id: "p3", name: "validate", args: { target: "hello.plain" } }] });
    await expect(window.locator(".tool-call")).toHaveText(["parsed hello.plain", "parsed the project", "parsed hello.plain"]);
  });
});

test.describe("what the project has spent", () => {
  test.use({ stubModel: "replies" });

  test("counts every chat's replies - a closed one's too - under the message box, since the project opened", async ({ launched: { window } }) => {
    const box = window.locator(".composer textarea");
    const spent = window.locator(".chat-meter-cost");
    await expect(spent).toHaveText("$0.00");
    await box.fill("hello");
    await box.press("Enter");
    await expect(window.locator(".chat-body .msg.assistant", { hasText: "reply 1" })).toBeVisible();
    await expect(spent).toHaveText("$1.00");
    await window.locator(".chat-meter").hover();
    await expect(window.getByRole("tooltip").locator(".meter-pop-part").first()).toHaveText("chat$1.00the conversations' own replies");
    await window.locator(".composer textarea").hover();
    await expect(window.getByRole("tooltip")).toHaveCount(0);
    // Another chat: the project's spending, not this chat's.
    await window.locator(".chat-new").click();
    await expect(window.locator(".chat-tabs [role=tab]")).toHaveCount(2);
    await expect(spent).toHaveText("$1.00");
    await box.fill("and you");
    await box.press("Enter");
    await expect(window.locator(".chat-body .msg.assistant", { hasText: "reply 2" })).toBeVisible();
    await expect(spent).toHaveText("$2.00");
    // Closed, what it spent stays spent.
    await window.locator(".chat-tab.on .chat-tab-close").click();
    await expect(window.locator(".chat-tabs [role=tab]")).toHaveCount(1);
    await expect(spent).toHaveText("$2.00");
  });
});

test.describe("the spending's parts", () => {
  test("are each a line in a card above the meter, on hover or focus - chat, regeneration, sentinel, and turri's other agents by name", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-meter")).toBeVisible();
    const spending = { chat: 0.18, regeneration: 0.04, sentinel: 0.13, other: [{ role: "planner", cost: 0.01 }, { role: null, cost: 0.43 }, { role: "advisor", cost: 0.4 }, { role: "chat", cost: 0.04 }] };
    const card = window.getByRole("tooltip");
    // Sent, and read, until it holds: the engine says its own, $0.00, as the project opens - and may again a moment later.
    await expect(async () => {
      await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:spending", data), spending);
      await expect(window.locator(".chat-meter-cost")).toHaveText("$1.23", { timeout: 1_000 });
      await window.locator(".chat-meter").hover();
      await expect(card.locator(".meter-pop-total")).toHaveText("spent since the project opened $1.23", { timeout: 1_000 });
      await expect(card.locator(".meter-pop-part")).toHaveText(
        [
          "chat$0.18the conversations' own replies",
          "regeneration$0.04the pulses, regenerating and conformance testing",
          "sentinel$0.13checking each pulse",
          "other$0.88skills $0.43 · test advisor $0.40 · /btw $0.04 · planner $0.01",
        ],
        { timeout: 1_000 },
      );
    }).toPass();
    // Above the meter, and in the window.
    const meter = (await window.locator(".chat-meter").boundingBox())!;
    const box = (await card.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(meter.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    // The focus shows it too.
    await window.locator(".composer textarea").hover();
    await expect(card).toHaveCount(0);
    await window.locator(".chat-meter").focus();
    await expect(card).toBeVisible();
  });
});
