import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// A reply's changes, on a model of the test's own: its first reply runs a command that changes the project (EDITS in
// app.ts) - the ***plain, a resource it links, and files that are no part of the ***plain - and the ones after say words.
test.describe("what a reply changed", () => {
  test.use({ stubModel: "edits" });

  test("shows the ***plain files a reply changed, each opening into its diff - none for a reply that changed nothing, and kept when drawn again", async ({ launched: { window, project, spec } }) => {
    // A resource the ***plain links: part of the ***plain, as the tree shows it.
    mkdirSync(join(project, "resources"), { recursive: true });
    writeFileSync(join(project, "resources", "greeting.yaml"), "greeting: hello\n");
    writeFileSync(spec, readFileSync(spec, "utf8").replace("greets the person running it.", "greets the person running it, as [the greeting](resources/greeting.yaml) says."));

    const box = window.locator(".composer textarea");
    await box.fill("change it");
    await box.press("Enter");
    await expect(window.locator(".msg.assistant").last()).toContainText("edited", { timeout: 20_000 });

    // The ***plain and the resource - not the note, nor turri's code - with their lines added and removed.
    const card = window.locator(".msg.changes");
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await expect(card.locator(".changes-head")).toHaveText(/2 files changed\s*\+2 −1/);
    await expect(card.locator(".changes-name")).toHaveText(["resources", "greeting.yaml", "hello.plain"]);
    await expect(card.locator(".changes-file", { hasText: "hello.plain" }).locator(".changes-counts")).toHaveText("+1 −0");

    // A file opens into its diff, from the project as the reply began to as it ended.
    await card.locator(".changes-file-open", { hasText: "hello.plain" }).click();
    const diff = card.locator(".changes-file", { hasText: "hello.plain" }).locator(".changes-diff");
    await expect(diff.locator(".line.add")).toHaveText("+- :Greeter: waves as it greets.");
    await card.locator(".changes-file-open", { hasText: "greeting.yaml" }).click();
    const resource = card.locator(".changes-file", { hasText: "greeting.yaml" }).locator(".changes-diff");
    await expect(resource.locator(".line.del")).toHaveText("-greeting: hello");
    await expect(resource.locator(".line.add")).toHaveText("+greeting: hi");

    // A reply that changed nothing has no card.
    await box.fill("and now?");
    await box.press("Enter");
    await expect(window.locator(".msg.assistant").last()).toContainText("reply 3", { timeout: 20_000 });
    await window.waitForTimeout(1500);
    await expect(card).toHaveCount(1);

    // The checkpoints are the app's, never the project's.
    expect(existsSync(join(project, ".git"))).toBe(false);

    // Drawn again - the chat read from its history - the card is still there, its diffs still a click away.
    await window.reload();
    await expect(window.locator(".msg.changes")).toHaveCount(1, { timeout: 15_000 });
    await window.locator(".msg.changes .changes-file-open", { hasText: "hello.plain" }).click();
    await expect(window.locator(".msg.changes .changes-diff .line.add")).toHaveText("+- :Greeter: waves as it greets.");
  });

  test("lets go of the checkpoints no card names as the project opens again - keeping the cards' own", async ({ launched: { app, window }, scratch }) => {
    const box = window.locator(".composer textarea");
    await box.fill("change it");
    await box.press("Enter");
    await expect(window.locator(".msg.changes")).toHaveCount(1, { timeout: 25_000 });

    // The project's store, in the app's userData: a checkpoint of its own that no card names.
    const root = join(scratch, "user-data", "checkpoints");
    const store = join(root, readdirSync(root).find((name) => name.endsWith(".git"))!);
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_DIR: store, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
    const refs = () => git("for-each-ref", "--format=%(refname)", "refs/turri/").split("\n").filter(Boolean).sort();
    const cards = refs();
    expect(cards).toHaveLength(2);
    const orphan = git("commit-tree", `${cards[0]}^{tree}`, "-m", "nobody's");
    git("update-ref", `refs/turri/${orphan}`, orphan);
    expect(refs()).toHaveLength(3);

    // The engine started again opens the project again: the orphan let go, the card's two kept.
    const main = app.process().pid!;
    const first = enginePid(main)!;
    process.kill(first, "SIGKILL");
    await window.getByRole("alert").getByRole("button", { name: "start it again" }).click();
    await expect.poll(() => enginePid(main), { timeout: 15_000 }).not.toBe(first);
    await expect.poll(refs, { timeout: 15_000 }).toEqual(cards);
    // The card's diff is there still - its conversation is kept, a new chat shown in its place.
    const [a, b] = cards.map((ref) => ref.slice("refs/turri/".length));
    const diff = await window.evaluate(
      ([from, to]) => (window as unknown as { turri: { call: (method: string, params: unknown) => Promise<string | null> } }).turri.call("replyDiff", { from, to, path: "hello.plain" }),
      [a, b],
    );
    expect(diff).toContain("waves as it greets.");
  });

  test("opens a changed file in the window from its row", async ({ launched: { window } }) => {
    const box = window.locator(".composer textarea");
    await box.fill("change it");
    await box.press("Enter");
    const card = window.locator(".msg.changes");
    await expect(card).toHaveCount(1, { timeout: 25_000 });
    // Only hello.plain: the fixture links no resource, so the one written is not the ***plain's.
    await expect(card.locator(".changes-name")).toHaveText(["hello.plain"]);
    await card.getByRole("button", { name: "open hello.plain" }).click();
    await expect(window.locator(".tree-row.active")).toContainText("hello.plain");
  });
});

// Replies one after another as fast as they come, on a model that runs what each message says (`scripted` in app.ts).
test.describe("what each of several replies changed", () => {
  test.use({ stubModel: "scripted" });

  const line = (text: string) => `printf '%s\\n' '- :Greeter: ${text}.' >> hello.plain`;
  /** The chat's messages, its replies and its cards, in order. */
  const order = (window: import("@playwright/test").Page) =>
    window
      .locator(".chat-body > .msg")
      .evaluateAll((all) => all.map((el) => (el.classList.contains("changes") ? "CARD" : el.classList.contains("user") ? "USER" : (el.textContent ?? "").includes("done") ? "DONE" : "")))
      .then((all) => all.filter(Boolean).join(" "));

  test("is each its own - the next sent the moment one answers, before it is done - and none for words alone", async ({ launched: { window } }) => {
    const box = window.locator(".composer textarea");
    const say = async (text: string, tag: string) => {
      await box.fill(`TAG${tag} ${text}`);
      await box.press("Enter");
      await expect(window.locator(".msg.assistant", { hasText: `done ${tag}` })).toHaveCount(1, { timeout: 20_000 });
    };
    await say(`RUN<<<${line("waves")}>>>`, "a");
    await say("just words", "b");
    await say(`RUN<<<${line("bows")}>>>`, "c");
    await expect(window.locator(".msg.changes")).toHaveCount(2);
    await expect.poll(() => order(window)).toBe("USER DONE CARD USER DONE USER DONE CARD");
    const second = window.locator(".msg.changes").nth(1);
    await second.locator(".changes-file-open").click();
    await expect(second.locator(".changes-diff .line.add")).toHaveText("+- :Greeter: bows.");
  });

  test("of what is said while turri answers is under its own answer - kept so when drawn again", async ({ launched: { window } }) => {
    const box = window.locator(".composer textarea");
    for (const i of [1, 2, 3]) {
      await box.fill(`TAGq${i} RUN<<<${line(`said ${i}`)} && sleep 1>>>`);
      await box.press("Enter");
    }
    await expect(window.locator(".msg.assistant", { hasText: "done q3" })).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(() => order(window)).toBe("USER DONE CARD USER DONE CARD USER DONE CARD");
    for (const i of [1, 2, 3]) {
      const card = window.locator(".msg.changes").nth(i - 1);
      await card.locator(".changes-file-open").click();
      await expect(card.locator(".changes-diff .line.add")).toHaveText(`+- :Greeter: said ${i}.`);
    }
    await window.reload();
    await expect(window.locator(".msg.changes")).toHaveCount(3, { timeout: 15_000 });
    expect(await order(window)).toBe("USER DONE CARD USER DONE CARD USER DONE CARD");
  });
});
