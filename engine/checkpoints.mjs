// What a chat's reply changed of the project, as T3 Code has a turn's diff: the project as it stood when the reply
// began and as it stands when it is done, each a checkpoint - a commit in a git store of the app's own, in its userData,
// the project's folder its work tree - and the diff between the two. Nothing of the project's own is touched: not its
// files, nor a .git of its own. Whatever changed meanwhile is the reply's - another chat's work, the person's own edits -
// as in T3 Code, where threads share a checkout. The engine keeps the ***plain of it (engine.mjs): the chat shows that.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { devNull } from "node:os";
import { basename, join } from "node:path";

/**
 * What a checkpoint leaves out: version control's own, installed packages and caches, what turri keeps for itself and
 * the code it builds - none of it the ***plain, and some of it large.
 */
const LEFT_OUT = [".git", ".plaingit", ".turri", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"];
/** A file's patch past this is cut short: the chat shows a reply's change, not a book. */
const PATCH_SIZE = 256 * 1024;
/** A commit, as git names one. */
export const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The person's git settings and environment left out: the store is the app's, whatever theirs says. */
const CONFIG = ["-c", "core.quotepath=off", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "diff.renames=false"];

/**
 * The checkpoints of the project in `projectDir`, kept under `root` - one store a project, named by where it is - each
 * leaving out `modulesDir`, turri's code. Null without a `root`: the feature is off.
 */
export function checkpoints({ projectDir, root, modulesDir }) {
  if (!root) return null;
  const store = join(root, `${basename(projectDir).replace(/[^\w.-]/g, "_")}-${createHash("sha256").update(projectDir).digest("hex").slice(0, 12)}.git`);
  const env = { ...withoutGit(process.env), GIT_DIR: store, GIT_WORK_TREE: projectDir, GIT_INDEX_FILE: join(store, "turri-index"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "turri", GIT_AUTHOR_EMAIL: "turri@localhost", GIT_COMMITTER_NAME: "turri", GIT_COMMITTER_EMAIL: "turri@localhost" };
  const git = (args, { limit = 64 * 1024 * 1024, bare = false, input } = {}) =>
    new Promise((done, failed) => {
      const child = execFile("git", [...CONFIG, ...args], { cwd: projectDir, env: bare ? { ...env, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined } : env, maxBuffer: limit, encoding: "utf8" }, (error, stdout) => (error ? failed(error) : done(stdout)));
      if (input !== undefined) child.stdin?.end(input);
    });
  // One at a time: the chats' replies share the store's one index.
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const now = queue.then(work);
    queue = now.catch(() => {});
    return now;
  };
  let made;
  const ready = () =>
    (made ??= (async () => {
      if (existsSync(join(store, "HEAD"))) return;
      mkdirSync(root, { recursive: true });
      await git(["init", "--quiet", "--bare"], { bare: true });
    })().catch((error) => ((made = undefined), Promise.reject(error))));
  let last = null;
  /** The checkpoints taken since the engine started: a reply's first is in no chat yet, until it ends. */
  const taken = new Set();

  return {
    /**
     * The project as it stands now: a commit, kept by a ref of the store's so it is never let go - the last one again
     * when nothing changed since.
     */
    take: () =>
      inTurn(async () => {
        await ready();
        // Everything but what it leaves out - what the project's .gitignore ignores too: a resource may be.
        await git(["--glob-pathspecs", "add", "--all", "--force", "--", "**", `:(exclude)${modulesDir}/**`, ...LEFT_OUT.map((dir) => `:(exclude)**/${dir}/**`), ":(exclude)**/.DS_Store"]);
        const tree = (await git(["write-tree"])).trim();
        if (last?.tree === tree) return last.commit;
        const commit = (await git(["commit-tree", tree, "-m", "the project, as a reply of turri's began or ended"])).trim();
        await git(["update-ref", `refs/turri/${commit}`, commit]);
        last = { tree, commit };
        taken.add(commit);
        return commit;
      }),
    /**
     * Let go of every checkpoint but those in `kept` - the ones the chats' cards name - and those taken since the engine
     * started, as T3 Code deletes a thread's once the thread is gone: their refs deleted, and what nothing names any
     * more pruned by git's own gc once there is enough of it, after its grace of two weeks. How many were let go.
     */
    prune: (kept) =>
      inTurn(async () => {
        if (!existsSync(join(store, "HEAD"))) return 0;
        const refs = (await git(["for-each-ref", "--format=%(refname)", "refs/turri/"])).split("\n").filter((ref) => ref !== "");
        const gone = refs.filter((ref) => {
          const commit = ref.slice("refs/turri/".length);
          return !kept.has(commit) && !taken.has(commit);
        });
        if (gone.length > 0) await git(["update-ref", "--no-deref", "-z", "--stdin"], { input: gone.map((ref) => `delete ${ref}\0\0`).join("") });
        await git(["gc", "--auto", "--quiet"], { bare: true });
        return gone.length;
      }),
    /** The files changed from one checkpoint to another, by their paths in the project: how each changed, and by how many lines. */
    changed: (from, to) =>
      inTurn(async () => {
        if (from === to) return [];
        const status = (await git(["diff", "--no-ext-diff", "--name-status", "-z", from, to])).split("\0");
        const counts = new Map();
        for (const line of (await git(["diff", "--no-ext-diff", "--numstat", "-z", from, to])).split("\0")) {
          const [added, removed, path] = line.split("\t");
          if (path !== undefined) counts.set(path, added === "-" ? { binary: true } : { added: Number(added), removed: Number(removed) });
        }
        const files = [];
        for (let at = 0; at + 1 < status.length; at += 2) {
          const path = status[at + 1];
          const how = status[at] === "A" ? "added" : status[at] === "D" ? "deleted" : "modified";
          files.push({ path, status: how, ...(counts.get(path) ?? { added: 0, removed: 0 }) });
        }
        // In the order a person counts them: r2 before r10.
        return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      }),
    /** One file's change from one checkpoint to another, as a unified diff - null when the store no longer has them. */
    patch: (from, to, path) =>
      inTurn(async () => {
        if (!existsSync(join(store, "HEAD"))) return null;
        const text = await git(["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color", from, to, "--", path], { limit: PATCH_SIZE * 4 }).catch(() => null);
        if (text === null) return null;
        return text.length > PATCH_SIZE ? `${text.slice(0, PATCH_SIZE)}\n… cut short: the change is longer than the chat shows\n` : text;
      }),
  };
}

/** The environment without git's own variables: a GIT_DIR of the person's would point the store elsewhere. */
function withoutGit(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}
