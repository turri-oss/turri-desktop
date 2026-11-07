// A release's notes, from its commits: what is new (feat) and what is fixed (fix, perf) since the release before -
// each commit's description, as the Conventional Commits it is written in say what the app now does - and which turri it
// runs. The release workflow writes the draft's body with it; the draft can be edited before it is published.
//
//   node scripts/release-notes.mjs v0.2.3            # since the tag before it
//   node scripts/release-notes.mjs v0.2.3 v0.2.1     # since a tag of your choosing
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const tag = process.argv[2];
if (!tag) {
  console.error("say which tag: node scripts/release-notes.mjs v0.2.3");
  process.exit(1);
}
/** The release before: the tag given, or the newest v-tag reachable from the commit before this one. */
const since = process.argv[3] ?? (() => {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
  } catch {
    return undefined;
  }
})();

const KINDS = { feat: "New", fix: "Fixed", perf: "Fixed" };
const CONVENTIONAL = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/;
/** Markdown's own characters in a description, as text - ***plain stays ***plain, not bold. */
const text = (words) => words.replace(/([\\`*_[\]<>])/g, "\\$1");

const sections = { New: [], Fixed: [] };
const subjects = git("log", "--no-merges", "--reverse", "--format=%s", since ? `${since}..${tag}` : tag).split("\n").filter(Boolean);
for (const subject of subjects) {
  const parsed = CONVENTIONAL.exec(subject)?.groups;
  const kind = parsed && KINDS[parsed.type];
  if (!kind) continue;
  const description = text(parsed.description);
  sections[kind].push(`- ${parsed.breaking ? "**Breaking:** " : ""}${description[0].toUpperCase()}${description.slice(1)}`);
}

/** The turri a release runs: the version package.json pins, at its tag. */
const turriAt = (ref) => {
  try {
    return JSON.parse(git("show", `${ref}:package.json`)).dependencies?.["@turri-dev/cli"];
  } catch {
    return undefined;
  }
};
const turri = turriAt(tag);
const before = since ? turriAt(since) : undefined;
/** A turri's own release, on GitHub. */
const turriLink = (version) => `[turri ${version}](https://github.com/turri-oss/turri/releases/tag/v${version})`;

const repository = "https://github.com/turri-oss/turri-desktop";
const lines = [
  `Download it below: the \`.dmg\` for macOS (Apple silicon), the AppImage or the \`.deb\` for Linux. Installed on Linux, the app updates itself.${turri ? ` It runs ${turriLink(turri)}.` : ""}`,
  "",
];
// A new turri is a new app: what turri itself brings is in its own release.
if (turri && before && turri !== before) lines.push("**turri**", `- Runs ${turriLink(turri)}, after turri ${before}: what it brings is in its release.`, "");
for (const [kind, items] of Object.entries(sections)) if (items.length > 0) lines.push(`**${kind}**`, ...items, "");
if (sections.New.length === 0 && sections.Fixed.length === 0) lines.push(turri && before && turri !== before ? "Nothing else new in the app itself." : "Nothing new in the app itself.", "");
if (since) lines.push(`**Every change**: ${repository}/compare/${since}...${tag}`);
console.log(lines.join("\n").trim());
