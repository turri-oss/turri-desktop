// The turri engine: a Node process - Electron's own, run as Node - that hosts turri's session for one project: its chats,
// each pi's agent session with turri in it, from the @turri-dev/cli package's host entry. It talks to the Electron main
// process over IPC. The session's job registry and work loop are the project's one: the window's buttons go through the
// chat shown's slash commands, and what its jobs do is sent to the window as they do it. The app never shells out to
// `turri`.
import turri, { turriFrom } from "./turri.mjs";
import { busy, MANY_CHATS, SENTINEL, startSession } from "./chat.mjs";
import { createAuth } from "./auth.mjs";
import { existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

// The person's NODE_OPTIONS, kept from Electron's Node (electron/main.ts): back for the programs turri runs.
if (process.env.TURRI_NODE_OPTIONS !== undefined) {
  process.env.NODE_OPTIONS = process.env.TURRI_NODE_OPTIONS;
  delete process.env.TURRI_NODE_OPTIONS;
}

// turri writes progress to the console as it would to a terminal; here it is only a log line for the app.
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => emit("log", { level, text: args.map(String).join(" ") });
}

function emit(event, data) {
  process.send?.({ event, data });
}

let projectDir;
/** turri's session: its chats, and their one job registry and work loop. */
let session;
const registryNow = () => session?.jobs();
const loopNow = () => session?.loop();
/** A loop of the engine's own that starts nothing: what is left to regenerate, read without the session's. */
let looker;
/** A chat by its id - the one shown, when none is named. */
function chatOf(id) {
  const chat = id === undefined ? session.shown() : session.chat(id);
  if (chat === undefined) throw new Error("That chat is closed.");
  return chat;
}
/** turri's questions waiting for the person, by their id: each with its chat, to put it again in a window drawn again. */
const questions = new Map();
let nextQuestion = 0;
/** turri's browser and terminal tools' requests of the preview, waiting for the main process to answer. */
const paneCalls = new Map();
let nextPaneCall = 0;
/** What the person has open in the window - its view, and the file in it - for turri to know (engine/app.mjs). */
let looking = { view: "spec", file: null, pane: null };

/** What turri's session tells its host - the window - of its jobs and its work loop (TurriHost in turri). */
const ENDED = new Set(["succeeded", "failed", "stopped"]);
const announced = new Set();
const host = {
  onJobChange: (job) => {
    const ended = ENDED.has(job.status);
    jobChanged(job, ended);
    if (!ended || announced.has(job.id)) return;
    announced.add(job.id);
    if (job.replacedBy === undefined) emit("finished", { id: job.id, status: job.status, title: job.title ?? job.summary, module: job.module, kind: job.kind });
    emit("status", statusNow());
    readEarlier();
  },
  onPlanChange: () => emit("status", statusNow()),
};

// ---------- signing in to the model providers ----------

/** pi's model runtime of the engine's own, for signing in - and its catalogue - before a project's chat has one. */
let ownRuntime;
const modelRuntime = async () => session?.shown()?.session.modelRuntime ?? (await (ownRuntime ??= turri.pi.ModelRuntime.create()));
/**
 * Sign-ins go through the chat shown's runtime, so the conversation has a credential as soon as it is stored - and the
 * chats that could not start on harness-model for want of one are put on it. With no chat, through the engine's own.
 */
const auth = createAuth({
  emit,
  runtime: modelRuntime,
  projectDir: () => projectDir,
  signedIn: async () => {
    for (const { id } of session?.chats() ?? []) await session.chat(id)?.onHarnessModel();
  },
});

// ---------- the project ----------

async function open({ dir }) {
  projectDir = resolve(dir);
  process.chdir(projectDir);
  const orphans = turri.sweepOrphanedGroups();
  looker = turri.createWorkLoop({ registry: turri.createJobRegistry(), cwd: projectDir, dryRun: true });
  turri.onModelEvent((event) => {
    const line = turri.describeTurnIncident(event);
    if (line !== undefined) emit("incident", { job: event.job, text: line });
  });
  stopHearing();
  stopHearing = turri.onLedgerEvent?.(heard) ?? (() => {});
  await startChats();
  watchSpecs();
  readEarlier();
  return { ...summary(), orphans };
}

// ---------- the ledger: what turri did, as facts ----------

// turri records what it does in the project's ledger (.turri/ledger/, turri's docs/hosting.md) on its own. The window
// shows it - the pulses of earlier sessions, and a failure the work goes on past - and never decides anything from it:
// what is running and planned is the registry's and the work loop's. A turri with no ledger (0.1.x) shows none of it.

let stopHearing = () => {};
/** The failures said of each pulse, by its id: each said once, however often it happens - and a mark on its card. */
const failures = new Map();
/** The project's earlier pulses, as the ledger has them: read as it opens and as each pulse ends, never on each event. */
let earlier = [];
/** Runs sent to the window: it shows the last few, and more on asking. */
const EARLIER_RUNS = 40;

/** A failure the person is to hear of, as it happens: a healer failing, the model provider for good, landed work not committed. */
function failureOf(entry) {
  if (entry.kind === "healer.failed") return { mark: `the ${entry.healer} failed`, text: `the ${entry.healer} failed: ${entry.error}` };
  if (entry.kind === "provider.error" && !entry.transient) return { mark: "the model provider failed", text: `the model provider failed: ${entry.error}` };
  if (entry.kind === "history.failed" && entry.landing) return { mark: "not committed", text: `the pulse's work could not be committed, so it does not land: ${entry.said}` };
  return undefined;
}

/** Each event as turri records it: a failure is said in the window - once a pulse - and marked on the pulse's card. */
function heard(entry, project) {
  if (resolve(project) !== projectDir) return;
  // A pure rename turri made - a func-id or a scenario-id, nothing else with it: its records and its tests' labels
  // rewritten, nothing regenerated. Said as a rename, never a functional spec taken out and another added.
  if (entry.kind === "loop.renamed") return emit("renamed", { what: entry.what, from: entry.from, to: entry.to, spec: entry.spec, at: Date.now() });
  const failure = failureOf(entry);
  if (failure === undefined) return;
  const key = entry.job ?? `run ${entry.run}`;
  const said = failures.get(key) ?? [];
  if (said.some((one) => one.mark === failure.mark)) return;
  failures.set(key, [...said, failure]);
  const job = entry.job !== undefined ? registryNow()?.get(entry.job) : undefined;
  const name = job !== undefined ? pulseName(job) : undefined;
  emit("incident", { job: entry.job, text: name !== undefined ? `${name}: ${failure.text}` : failure.text });
  if (job !== undefined) jobChanged(job, true);
}

function pulseName(job) {
  if (job.module === undefined) return job.title ?? job.summary;
  return job.pulse !== undefined ? `${job.module} · pulse ${job.pulse}` : `${job.module} ${job.kind}`;
}

/**
 * The project's runs and their pulses, the most recent first - but for this session's, which the window has live - each
 * a plain object, as the window is sent it.
 */
function readEarlier() {
  if (turri.runViews === undefined) return;
  const live = new Set((registryNow()?.list() ?? []).map((job) => job.id));
  let runs;
  let failed;
  try {
    runs = turri.runViews(projectDir);
    failed = turri.readLedger(projectDir, { kinds: ["healer.failed", "provider.error", "history.failed"] });
  } catch (error) {
    emit("log", { level: "error", text: `the ledger could not be read: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const marks = new Map();
  for (const entry of failed) {
    const failure = entry.job !== undefined ? failureOf(entry) : undefined;
    if (failure === undefined) continue;
    const own = marks.get(entry.job) ?? [];
    if (!own.some((one) => one.mark === failure.mark)) marks.set(entry.job, [...own, failure]);
  }
  earlier = runs
    .map((view) => ({
      run: view.run,
      mode: view.started?.mode ?? null,
      started: view.started?.ts ?? view.pulses[0]?.queued?.ts ?? null,
      version: view.started?.version ?? null,
      pulses: view.pulses.filter((pulse) => !live.has(pulse.id)).map((pulse) => pastPulse(pulse, marks.get(pulse.id) ?? [])),
    }))
    .filter((run) => run.pulses.length > 0)
    .slice(0, EARLIER_RUNS);
  emit("earlier", earlier);
}

/** A pulse of an earlier session, as its card says it: what it was, how it ended, how long it ran, what it cost, and the ***plain it worked on. */
function pastPulse(view, failed) {
  const { queued, started, finished } = view;
  return {
    id: view.id,
    run: view.run,
    kind: queued?.jobKind ?? "regenerate",
    summary: queued?.summary ?? view.id,
    module: queued?.module ?? null,
    pulse: queued?.pulse ?? null,
    title: queued?.title ?? null,
    // Never ended: its run stopped - quit, killed - while it ran, or before it started.
    status: finished?.status ?? (started !== undefined ? "unended" : "unstarted"),
    landed: finished?.landed ?? null,
    stoppedBy: finished?.stoppedBy ?? null,
    ms: finished?.ms ?? null,
    usage: finished?.usage ?? null,
    error: finished?.error ?? null,
    failures: failed,
    queued: queued?.ts ?? null,
    // The ***plain it regenerated, as last steered, from the ledger's job.diff - none for a pulse recorded before it.
    diff: view.diff?.diff ?? null,
    diffWhere: view.diff?.where ?? null,
    // The functional specs it covered, by what it did to each, as it was queued - none for a pulse that is not one.
    cases: queued?.cases ?? null,
  };
}

function earlierPulses() {
  return earlier;
}

/**
 * The project's files change under the window too - turri edits the specs from the chat, a pulse writes code - and the
 * window is told. A .plain file comes with its text and what it now says; a save of the window's own comes back the
 * same way, and is known by its text. Any other change is only where it was, for the tree to list that folder again.
 * A module's history moving - a pulse landing, its code deleted to regenerate it from scratch - changes what each spec
 * has built and conformance tested, though no spec changed: every spec is sent again, with what it has now.
 */
function watchSpecs() {
  const skip = new Set([turri.MODULES_DIR, "node_modules", ".git", ".turri", "dist"]);
  const pending = new Map();
  const changed = new Set();
  let filesTimer;
  let configTimer;
  let historyTimer;
  const advisorTimers = new Map();
  watch(projectDir, { recursive: true }, (_type, name) => {
    if (name === null) return;
    const parts = name.split(sep);
    if (parts[0] === turri.MODULES_DIR && parts.includes(".plaingit") && (parts.at(-1) === "HEAD" || parts.includes("refs"))) {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        for (const file of plainFiles(projectDir)) emit("spec", { file, text: readFileSync(file, "utf8"), spec: describeSpec(file) });
      }, 300);
    }
    // The project's config - /turri-config writes it from the chat: the window shows its settings again.
    if (CONFIG_FILE.test(name)) {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => emit("config", null), 250);
    }
    if (!parts.some((part) => UNLISTED.has(part))) {
      changed.add(join(projectDir, name));
      clearTimeout(filesTimer);
      filesTimer = setTimeout(() => {
        emit("files", { paths: [...changed] });
        changed.clear();
      }, 250);
    }
    // The test advisor's file of a module - it took up a functional spec, or came to a verdict: the module sent again.
    if (parts[0] === ".turri" && parts[1] === "advisor" && name.endsWith(".json")) {
      const module = basename(name, ".json");
      clearTimeout(advisorTimers.get(module));
      advisorTimers.set(
        module,
        setTimeout(() => {
          advisorTimers.delete(module);
          const file = plainFiles(projectDir).find((each) => basename(each, ".plain") === module);
          if (file !== undefined) emit("spec", { file, text: readFileSync(file, "utf8"), spec: describeSpec(file) });
        }, 150),
      );
    }
    if (!name.endsWith(".plain") || parts.some((part) => skip.has(part) || part.startsWith("."))) return;
    const file = join(projectDir, name);
    // An editor writes a file in more than one step: it is read once they have settled.
    clearTimeout(pending.get(file));
    pending.set(
      file,
      setTimeout(() => {
        pending.delete(file);
        if (!existsSync(file)) return;
        emit("spec", { file, text: readFileSync(file, "utf8"), spec: describePlain(file) });
      }, 150),
    );
  });
}

// ---------- the project's files ----------

/** The project's config at its root: config.turri.yaml, a stack's config.turri.<stack>.yaml, or the older config.yaml. */
const CONFIG_FILE = /^config(\.turri(\.[^./\\]+)?)?\.yaml$/;

/** What the tree leaves out: version control's own, installed packages and caches nobody reads. */
const UNLISTED = new Set([".git", ".plaingit", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".DS_Store"]);
/** A file larger than this is offered to open elsewhere, not read into the window. */
const READABLE_SIZE = 1024 * 1024;

/** A path the window names, held to the project: nothing outside it is listed, read or written. */
function inProject(path) {
  const full = resolve(projectDir, path);
  if (full !== projectDir && !full.startsWith(projectDir + sep)) throw new Error(`Not in the project: ${path}`);
  return full;
}

/**
 * What the tree shows: the project's ***plain - its .plain files and the templates of its own they import - and the
 * resources they link, as turri's graph has them, and nothing else: no config, no test scripts, nothing turri keeps
 * for itself. On a turri without the graph, the .plain files alone; without linked resources in it, no resources.
 */
function shownInTree() {
  const files = new Set(everyPlainFile(projectDir));
  const ours = (file) => file !== null && file !== undefined && file.startsWith(projectDir + sep) && !relative(projectDir, file).split(sep).includes(turri.MODULES_DIR);
  if (turri.plainGraph !== undefined) {
    const graph = turri.plainGraph(projectDir);
    for (const module of graph.modules) if (ours(module.file) && existsSync(module.file)) files.add(module.file);
    for (const item of graph.items) for (const resource of item.resources ?? []) if (ours(resource.file) && existsSync(resource.file)) files.add(resource.file);
  }
  return files;
}

/**
 * One folder of the project, folders first: the tree lists a folder when it is opened - only what it shows of it, and
 * the folders on the way to that. Null for one not there (any more).
 */
function listFiles({ dir }) {
  const at = inProject(dir ?? projectDir);
  if (!existsSync(at) || !statSync(at).isDirectory()) return null;
  const shown = [...shownInTree()];
  const wanted = (path, isDir) => (isDir ? shown.some((file) => file.startsWith(path + sep)) : shown.includes(path));
  const entries = readdirSync(at, { withFileTypes: true })
    .filter((entry) => !UNLISTED.has(entry.name) && (entry.isDirectory() || entry.isFile()) && wanted(join(at, entry.name), entry.isDirectory()))
    .map((entry) => ({ name: entry.name, path: join(at, entry.name), dir: entry.isDirectory() }));
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

/** Every file the tree shows, relative to the project and sorted: what tab completes in the chat. */
function treeFiles() {
  return [...shownInTree()].map((file) => relative(projectDir, file).split(sep).join("/")).sort((a, b) => a.localeCompare(b));
}

/** A file's text - or, for one that is not text or too large to read here, why not. */
function readFile({ file }) {
  const full = inProject(file);
  const { size } = statSync(full);
  if (size > READABLE_SIZE) return { file: full, text: null, reason: "large", size };
  const bytes = readFileSync(full);
  if (bytes.subarray(0, 8000).includes(0)) return { file: full, text: null, reason: "binary", size };
  return { file: full, text: bytes.toString("utf8"), size };
}

function writeFile({ file, text }) {
  writeFileSync(inProject(file), text);
  return true;
}

// ---------- the standard library, and what the ***plain links ----------

// What of ***plain the window has from turri's host entry - the graph, its concepts, the standard library: each left out
// on a turri without it.
// A graph's items give their linked resources where its turri reads them - known from any item, and a project with none
// links none.
const offers = () => ({
  stdlib: turri.stdlibTemplates !== undefined,
  links: turri.plainGraph !== undefined,
  concepts: turri.conceptsOf !== undefined,
  resources: turri.plainGraph !== undefined && turri.plainGraph(projectDir).items[0]?.resources !== undefined,
});

/** The standard library's import names, to tell a link to one of its templates from a module of the project's. */
const stdlibNames = () => new Set(turri.stdlibTemplates?.().map((template) => template.name) ?? []);

/**
 * What a .plain file of the project builds on, and what builds on it, as saved, for the window to go between them: the
 * modules it imports and requires - each with its file, and whether it is the standard library's - and the project's
 * .plain files that require it or import it, by their paths in the project. All of it from turri's graph.
 */
function plainLinks({ file }) {
  const full = inProject(file);
  if (turri.plainGraph === undefined) return null;
  const graph = turri.plainGraph(projectDir);
  const node = graph.modules.find((module) => module.file === full);
  if (node === undefined) return { imports: [], requires: [], requiredBy: [], importedBy: [] };
  const stdlib = stdlibNames();
  const down = (link) => ({ ...link, stdlib: stdlib.has(link.name) });
  const up = (link) => ({ name: relative(projectDir, link.file), file: link.file });
  return { imports: node.imports.map(down), requires: node.requires.map(down), requiredBy: node.requiredBy.map(up), importedBy: node.importedBy.map(up) };
}

/**
 * Every concept the project's ***plain can name, for the chat to offer as it is typed and colour where it is said - as
 * turri reads them (conceptsOf), for each .plain of the project, each once. None on a turri without them.
 */
function concepts() {
  if (turri.conceptsOf === undefined) return [];
  const seen = new Map();
  for (const file of plainFiles(projectDir))
    for (const { concept, definition, module } of turri.conceptsOf(file)) if (!seen.has(concept)) seen.set(concept, { name: concept, about: definition, from: module ?? "***plain" });
  return [...seen.values()];
}

/** The item of a .plain file a line of it is in, from turri's graph - the last to start at or before it - or undefined. */
function itemAt(graph, file, line) {
  let found;
  for (const item of graph.items) if (item.file === file && item.line <= line && (found === undefined || item.line > found.line)) found = item;
  return found;
}

/** An item's first line, in parts - each concept in it one of its own, as turri finds them - for the window to colour. */
function excerpt(text) {
  const line = text.split("\n")[0].trim();
  const parts = [];
  let at = 0;
  for (const { concept, start, end } of turri.findConcepts(line)) {
    if (start > at) parts.push({ text: line.slice(at, start) });
    parts.push({ text: concept, concept: true });
    at = end;
  }
  if (at < line.length) parts.push({ text: line.slice(at) });
  return parts;
}

/**
 * Where a concept is defined, for the window to open it there, from turri's graph: the .plain file and the line its
 * definition starts on, and the module - the standard library's or the project's. Said on a line of a .plain - ⌘-clicked
 * there - the definition that item names, as its module sees it, or, where it defines it, the item and every item that
 * uses it (`uses`), by its file's path in the project or its template's name. Said in the
 * chat, of several, the one in the file open now, then the project's own. `{ plain: true }` for one of ***plain's own;
 * null for one defined nowhere.
 */
function conceptDefinition({ concept, file, line }) {
  if (turri.plainGraph === undefined) return null;
  const graph = turri.plainGraph(projectDir);
  const nodes = graph.concepts.filter((node) => node.concept === concept);
  const items = new Map(graph.items.map((item) => [item.id, item]));
  const stdlib = stdlibNames();
  const where = (item) => ({ file: item.file, line: item.line, module: item.module, stdlib: stdlib.has(item.module) });
  if (file !== undefined && line !== undefined) {
    const item = itemAt(graph, inProject(file), line);
    // ⌘-clicked where it is defined: where it is used, each with its first line.
    if (item?.defines.includes(concept)) {
      const usedBy = graph.concepts.find((node) => node.concept === concept && node.definition === item.id)?.usedBy ?? [];
      const uses = usedBy.filter((id) => id !== item.id && items.has(id)).map((id) => items.get(id));
      return { ...where(item), uses: uses.map((use) => ({ ...where(use), name: stdlib.has(use.module) ? use.module : relative(projectDir, use.file), text: excerpt(use.text) })) };
    }
    const definition = item?.uses.find((use) => use.concept === concept)?.definition;
    if (definition != null && items.has(definition)) return where(items.get(definition));
  }
  const defined = nodes.flatMap((node) => (node.definition !== null && items.has(node.definition) ? [items.get(node.definition)] : []));
  if (defined.length === 0) return nodes.length > 0 ? { plain: true } : null;
  // Said in a test plain file: its scenarios name the concepts of the module they are of, as that module sees them.
  const tests = file !== undefined ? graph.testPlainFiles.find((each) => each.file === inProject(file)) : undefined;
  const from = tests?.item !== undefined && tests.item !== null ? turri.conceptsOf(tests.item.slice(0, tests.item.lastIndexOf(":"))).find((each) => each.concept === concept) : undefined;
  if (from !== undefined) return from.module === null ? { plain: true } : where(defined.find((each) => each.module === from.module) ?? defined[0]);
  const open = looking.file !== null ? resolve(projectDir, looking.file) : null;
  return where(defined.find((each) => each.file === open) ?? defined.find((each) => !stdlib.has(each.module)) ?? defined[0]);
}

/**
 * The file a linked resource of a .plain names - the `index`th link on its `line`, ⌘-clicked there - as turri's graph
 * resolves it: `{ file }`, or `{ missing }` with its target when it is not there. Null on a turri whose graph does not
 * give an item's resources.
 */
function linkedResource({ file, line, index }) {
  if (turri.plainGraph === undefined) return null;
  const graph = turri.plainGraph(projectDir);
  const item = itemAt(graph, inProject(file), line);
  if (item?.resources === undefined) return null;
  const resource = item.resources.filter((each) => each.line === line)[index];
  if (resource === undefined) return null;
  return resource.file !== null ? { file: resource.file } : { missing: resource.target };
}

/** The concept being typed at the end of what is before the caret - `:Us` - and where it starts, as turri reads it; or null. */
function conceptBeingTyped({ text }) {
  const typing = turri.conceptBeingTyped?.(text);
  return typing === undefined ? null : { typed: typing.typed, from: typing.start };
}

/**
 * turri's standard library, to read in the stdlib view: every template as turri lists it - its import name, kind, what
 * it is, what it imports, its conformance template or its stack, and its text - and which of the project's .plain files
 * import each, from turri's graph.
 */
function stdlib() {
  const graph = turri.plainGraph(projectDir);
  const project = graph.modules.filter((module) => !relative(projectDir, module.file).startsWith(".."));
  return turri.stdlibTemplates().map(({ name, kind, description, imports, conformance, text, tests }) => ({
    name,
    kind,
    description,
    imports,
    stack: turri.isStack({ name }),
    ...(conformance !== undefined ? { conformance } : {}),
    ...(tests !== undefined ? { tests } : {}),
    usedBy: project.filter((module) => module.imports.some((link) => link.name === name)).map((module) => ({ file: module.file, rel: relative(projectDir, module.file) })),
    text,
  }));
}

/** The standard library's kinds, in turri's order, each titled as the window shows it. */
const stdlibKinds = () => turri.STDLIB_KINDS.map(({ kind, title }) => ({ kind, title: title.toLowerCase() }));

// ---------- a new project ----------

// ---------- Amazon Bedrock's models ----------

// On Bedrock a new project can run on any pair of pi's catalogue: whose models, where they run, and which two. A turri
// that knows them (piModelCatalogue - after 0.1.9) says each - the makers and their geographies, each geography's models,
// the pair to offer, the AWS region it needs - and writes the config with the pair given. An older one knows only its own
// two makers' pairs: the engine reads pi's catalogue itself, offers the same, and puts the pair picked in the place of
// turri's own in the file turri wrote.

/** Whether the turri running takes any pair of pi's catalogue - initConfig's models - and says what Bedrock serves. */
const KNOWS_CATALOGUE = typeof turri.piModelCatalogue === "function";
let catalogue;
const catalogueNow = async () => (catalogue ??= await turri.piModelCatalogue());

/**
 * Bedrock as the window offers it: each maker - Anthropic's and OpenAI's first - with the geographies its chat models run
 * in, and in each its models, the strongest first, the pair offered, and the AWS region to call it in when it needs one.
 */
async function bedrockOffer() {
  if (!KNOWS_CATALOGUE) return olderBedrockOffer();
  const known = await catalogueNow();
  return turri.bedrockMakers(known).map(({ maker, label, regions }) => ({
    maker,
    label,
    regions: regions.map((region) => ({
      region,
      inRegion: region === turri.BEDROCK_IN_REGION,
      awsRegion: turri.bedrockNeedsAwsRegion(region) ? turri.bedrockAwsRegion(region) : null,
      models: strongestFirst(turri.bedrockModelsIn(known, { maker, region }).map((model) => modelView(model.id, model))),
      pair: turri.bedrockDefaultModels(known, { maker, region }) ?? null,
    })),
  }));
}

/** A model as the window lists it: "Grok 4.7 (Global)" without where it runs, which the geography chosen says. */
function modelView(id, model) {
  return { id: `amazon-bedrock/${id}`, name: model.name.replace(/\s*\([^)]*\)$/, ""), reasoning: model.reasoning === true, cost: (model.cost?.input ?? 0) + (model.cost?.output ?? 0) };
}

/** The strongest - the dearest, and of one price the newest - first. */
const strongestFirst = (models) => models.sort((a, b) => b.cost - a.cost || b.id.localeCompare(a.id, undefined, { numeric: true }));

// What a turri of 0.1.9 and before does not say, said here as the newer one says it.
const GEOGRAPHIES = ["global", "us", "eu", "jp", "au", "apac", "in", "ca", "us-gov"];
const IN_REGION = "in-region";
const AWS_REGION_IN = { global: "us-east-1", us: "us-east-1", eu: "eu-central-1", jp: "ap-northeast-1", au: "ap-southeast-2", apac: "ap-southeast-1", in: "ap-south-1", ca: "ca-central-1", "us-gov": "us-gov-west-1" };
const MAKER_LABELS = { anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", moonshotai: "Moonshot AI", moonshot: "Moonshot", zai: "Z.ai", meta: "Meta", mistral: "Mistral", qwen: "Qwen", deepseek: "DeepSeek", amazon: "Amazon", google: "Google", minimax: "MiniMax", nvidia: "NVIDIA", writer: "Writer" };

async function olderBedrockOffer() {
  const all = (await modelRuntime()).getModels("amazon-bedrock").map((model) => {
    const parts = model.id.split(".");
    const region = GEOGRAPHIES.includes(parts[0]) ? parts.shift() : IN_REGION;
    return { ...modelView(model.id, model), maker: parts[0], region };
  });
  const makers = [...new Set(all.map((model) => model.maker))];
  const first = (maker) => (maker === "anthropic" ? 0 : maker === "openai" ? 1 : 2);
  return makers
    .map((maker) => ({
      maker,
      label: MAKER_LABELS[maker] ?? maker,
      regions: [...GEOGRAPHIES, IN_REGION]
        .filter((region) => all.some((model) => model.maker === maker && model.region === region))
        .map((region) => {
          const models = strongestFirst(all.filter((model) => model.maker === maker && model.region === region));
          return { region, inRegion: region === IN_REGION, awsRegion: ["global", "us", IN_REGION].includes(region) ? null : AWS_REGION_IN[region], models, pair: olderPair(maker, region, models) };
        }),
    }))
    .sort((a, b) => first(a.maker) - first(b.maker) || a.label.localeCompare(b.label));
}

/** turri's own pair where it has one; else the strongest that reasons, and the cheapest costing at least a fifth of it. */
function olderPair(maker, region, models) {
  const turris = turri.BEDROCK_REGIONS[maker]?.includes(region) ? turri.bedrockModels({ maker, region }) : undefined;
  if (turris !== undefined) return turris;
  const talk = models.find((model) => model.reasoning) ?? models[0];
  if (talk === undefined) return null;
  const code = [...models].reverse().find((model) => model.cost >= talk.cost / 5) ?? talk;
  return { harness: talk.id, coding: code.id, strong: talk.id };
}

/** turri's vendors and the two models each gives - and Bedrock's offer - for the window to choose from. */
async function vendors() {
  return {
    vendors: Object.entries(turri.VENDORS).map(([id, preset]) => ({ id, label: preset.label, harness: preset.harness, coding: preset.coding })),
    bedrockDefault: turri.BEDROCK_DEFAULT,
    bedrock: await bedrockOffer(),
    // Whether turri sets AWS_REGION itself for the models' geography, as a turri with bedrockRegionFor does.
    setsRegion: typeof turri.bedrockRegionFor === "function",
  };
}

/** A model id as it stands in the config - not part of a longer one - to put another in its place. */
const modelIn = (id) => new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "g");

/**
 * A new project's config.turri.yaml, as `turri init-config` writes it, with the chosen vendor's models - on Bedrock, the
 * maker, the geography and the two models picked there. A model turri refuses writes nothing, and says why. What turri
 * says of it is kept up to its terminal advice - how to sign in (keys to export, /login) and the commands to run next -
 * which a window has no use for: it signs in in its own sheet.
 */
async function initConfig({ dir, vendor, bedrock, models }) {
  const onBedrock = vendor === "amazon-bedrock";
  let message;
  if (KNOWS_CATALOGUE) {
    const done = await turri.initConfig(dir, { vendor, ...(onBedrock ? { bedrock, ...(models !== undefined ? { models } : {}) } : {}), catalogue: await catalogueNow() });
    if (!done.written) throw new Error(done.message.trim());
    message = done.message;
  } else message = await olderInitConfig({ dir, vendor, bedrock, models: onBedrock ? models : undefined });
  const lines = message.split("\n");
  const advice = lines.findIndex((line) => /^Sign in to /.test(line.trim()) || line.trim() === "Then");
  return { message: (advice === -1 ? lines : lines.slice(0, advice)).join("\n").trim() };
}

/**
 * An older turri's config, for a pair it does not know: it writes its own - for the geography chosen when it has one
 * there - and the pair picked is put in the place of its own, wherever the file names them, its comments too.
 */
async function olderInitConfig({ dir, vendor, bedrock, models }) {
  const turris = bedrock !== undefined && turri.BEDROCK_REGIONS[bedrock.maker]?.includes(bedrock.region) ? bedrock : undefined;
  const { message } = await turri.initConfig(dir, { vendor, ...(turris !== undefined ? { bedrock: turris } : {}) });
  const preset = vendor === "amazon-bedrock" ? turri.bedrockModels(turris ?? turri.BEDROCK_DEFAULT) : turri.VENDORS[vendor];
  if (models === undefined || (models.harness === preset.harness && models.coding === preset.coding)) return message;
  const file = join(dir, "config.turri.yaml");
  // Through placeholders: the two picked may be turri's the other way round.
  const swap = (text) =>
    text
      .replace(modelIn(preset.harness), "\u0000harness")
      .replace(modelIn(preset.strong), "\u0000harness")
      .replace(modelIn(preset.coding), "\u0000coding")
      .replaceAll("\u0000harness", models.harness)
      .replaceAll("\u0000coding", models.coding);
  writeFileSync(file, swap(readFileSync(file, "utf8")));
  return swap(message).replace(/with .+ on Amazon Bedrock \([^)]*\) models/, `with models on Amazon Bedrock (${bedrock?.region ?? "global"})`);
}

/**
 * A chat's question for the person, put in the window; answered through `answer`. `turri`: one of turri's own - ask_user,
 * a skill's interview, a review gate's - which ctrl+c declines; the rest are pi's dialogs, which ctrl+c dismisses. Its
 * `signal` says it is over unanswered - declined, its turn stopped, pi done with it: put away in the window.
 */
function ask(chat, question, { turri: ofTurri = false, signal } = {}) {
  const id = ++nextQuestion;
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(undefined);
    const asked = { id, ...question };
    questions.set(id, { chat, asked, resolve, turri: ofTurri });
    emit("chat:ask", { chat, data: asked });
    signal?.addEventListener("abort", () => putAway(id), { once: true });
  });
}

/** A question over unanswered: its promise settled, and its card taken from the window. */
function putAway(id) {
  const question = questions.get(id);
  if (question === undefined) return;
  questions.delete(id);
  question.resolve(undefined);
  emit("chat:unask", { chat: question.chat, data: { id } });
}

/**
 * ctrl+c at a question, as turri's terminal has it: one of turri's declined - however many in a row, the turn going on
 * - on a turri that can decline one (`unsupported` on one that cannot); one of pi's dialogs dismissed, as pi's terminal
 * closes it.
 */
async function declineQuestion({ id }) {
  const question = questions.get(id);
  if (question === undefined) return "missing";
  if (!question.turri) {
    putAway(id);
    return "dismissed";
  }
  if (!session.canDecline) return "unsupported";
  await session.decline(question.chat);
  // Over, whether or not turri's signal has said so yet.
  putAway(id);
  return "declined";
}

/**
 * One of turri's browser or terminal tools, asked of the window's preview - the main process drives its browser pane
 * and its terminal - and its answer.
 */
const askPane = (pane) => (action, params) => {
  const id = ++nextPaneCall;
  return new Promise((resolve, reject) => {
    paneCalls.set(id, { resolve, reject });
    process.send?.({ [pane]: action, id, params });
  });
};
const browser = askPane("browser");
const terminal = askPane("terminal");

function answer({ id, value }) {
  questions.get(id)?.resolve(value ?? undefined);
  questions.delete(id);
  return true;
}

function summary() {
  const project = turri.readProjectConfig(projectDir);
  const models = turri.projectModels(project);
  return {
    dir: projectDir,
    name: basename(projectDir),
    hasConfig: turri.hasProjectConfig(projectDir),
    stacks: turri.stacksOf(projectDir),
    settings: {
      "harness-model": turri.modelSpec(models.harness) ?? null,
      "coding-model": turri.modelSpec(models.coding) ?? null,
      review: project.review === true,
      "parallel-jobs": project.parallelJobs ?? turri.defaultParallelJobs(),
      // What a codebase that requires no other module starts from: none, and it starts empty.
      "base-folder": project.baseFolder ?? null,
      // As turri has it - TURRI_DEBUG over the file's - where the turri running has a debug mode at all.
      ...(turri.debugMode !== undefined ? { debug: turri.debugMode(projectDir) } : {}),
    },
    offers: { ...offers(), chats: MANY_CHATS, sentinel: SENTINEL },
    specs: plainFiles(projectDir).map((file) => describeSpec(file)),
    testPlainFiles: testPlainFiles(),
    // The modules' test folders, by their paths in the project: a pulse's ***plain diff tells a test plain file by them.
    testDirs: testDirsOf(plainFiles(projectDir)).map((dir) => relative(projectDir, dir)),
  };
}

/**
 * Every module of the project: its .plain files outside plain_modules and the folders nobody writes ***plain in - and
 * outside each module's test folder (turri's testDirOf: test-dir, a stack's own or the project's), whose .plain files
 * are test plain files, not modules.
 */
function plainFiles(dir) {
  const found = everyPlainFile(dir);
  const testDirs = testDirsOf(found);
  return found.filter((file) => !inTestDir(file, testDirs));
}

/** The test folders of these modules, as turri has them (testDirOf) - each module's, its stack's or the project's. */
const testDirsOf = (modules) => [...new Set(modules.map((file) => turri.testDirOf(file)))];
const inTestDir = (file, testDirs) => testDirs.some((testDir) => file.startsWith(`${testDir}${sep}`));

/** Whether a .plain file of the project is a test plain file - in a module's test folder - and not a module. */
const isTestPlainFile = (file) => inTestDir(file, testDirsOf(plainFiles(projectDir)));

/**
 * The project's test plain files, as turri's graph binds them: each the scenarios of one functional spec - its module,
 * func-id and the module's file, with the line of its # <func-id> heading there - or, one out of place or binding to
 * none, what is wrong with it.
 */
function testPlainFiles() {
  const graph = turri.plainGraph(projectDir);
  const fileOf = new Map(graph.modules.map((module) => [module.module, module.file]));
  return graph.testPlainFiles.map(({ file, module, funcId, item, conformance, acceptance, error }) => {
    const at = item?.lastIndexOf(":") ?? -1;
    return {
      file,
      rel: relative(projectDir, file),
      module,
      funcId,
      moduleFile: at > 0 ? item.slice(0, at) : (fileOf.get(module) ?? null),
      line: at > 0 ? Number(item.slice(at + 1)) : null,
      conformance: conformance ?? [],
      acceptance: acceptance ?? [],
      ...(error !== undefined ? { error } : {}),
    };
  });
}

/** A test plain file as the window's ***plain view takes a .plain: whether turri reads it, and what is wrong if not. */
function describeTestPlainFile(file) {
  const found = testPlainFiles().find((each) => each.file === file);
  const error = found === undefined ? "turri reads no test plain file here" : found.error;
  return { file, rel: relative(projectDir, file), ok: error === undefined, module: found?.module ?? "", requires: [], functionalSpecs: [], ...(error !== undefined ? { error } : {}) };
}

/** A .plain file of the project as the window takes it: a module, or a test plain file. */
const describePlain = (file) => (isTestPlainFile(file) ? describeTestPlainFile(file) : describeSpec(file));

function everyPlainFile(dir) {
  const skip = new Set([turri.MODULES_DIR, "node_modules", ".git", ".turri", "dist", "template", "resources"]);
  const found = [];
  const walk = (at, depth) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory() && depth < 3) walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".plain")) found.push(path);
    }
  };
  walk(dir, 0);
  return found.sort();
}

function describeSpec(file) {
  const result = turri.checkPlainFile(file);
  const text = readFileSync(file, "utf8");
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const base = { file, rel: relative(projectDir, file), ok: result.ok, module: result.moduleName ?? basename(file, ".plain"), description, requires: result.requiredModules ?? [] };
  // Not read - and, for the old ***plain syntax, turri's next step: to have it converted.
  if (!result.ok) return { ...base, error: result.error, ...(result.nextStep !== undefined ? { nextStep: result.nextStep } : {}), functionalSpecs: [] };
  // A functional spec is completed when the codebase the chain delivers has it, as the spec has it now.
  let incomplete;
  let conformanceTested = 0;
  // The functional specs whose conformance tests are written and pass, as the ***plain has them now, by func-id.
  let tested = new Set();
  let built = false;
  try {
    for (const chain of turri.functionalityCompletion(file)) {
      const own = chain.modules.find((entry) => entry.module === result.moduleName);
      if (own === undefined) continue;
      incomplete = new Set(own.incomplete);
      built = own.completed > 0;
      conformanceTested = own.conformanceTested;
      tested = new Set(own.tested);
    }
  } catch {
    /* nothing built, or a chain that does not resolve: every spec is still to build */
  }
  // Each functional spec's test plain file and its scenarios, as turri's graph binds them: none, and it is not tested.
  const graphed = new Map(turri.plainGraph(projectDir).items.filter((item) => item.file === file && item.funcId !== undefined).map((item) => [item.funcId, item]));
  // What the test advisor made of each, as it reads now: an entry of another text - its hash not this one's - is none.
  const advised = turri.readAdvisor(projectDir, result.moduleName)?.entries ?? {};
  const advisorOf = (funcId, item) => {
    const entry = advised[funcId];
    if (entry === undefined || item === undefined || entry.hash !== turri.textHash(item.text)) return null;
    return { state: entry.state, ...(entry.report !== undefined ? { report: entry.report } : {}), ...(entry.undelivered === true ? { undelivered: true } : {}), ...(entry.reason !== undefined ? { reason: entry.reason } : {}) };
  };
  const functionalSpecs = [];
  try {
    const [, tree] = turri.plainFileParser(basename(file), turri.resolveTemplateDirs(file), { allowNoFunctionalities: true });
    for (const { funcId, specifications } of turri.iterateFunctionalSpecs(tree, false)) {
      const text = specifications[turri.FUNCTIONAL_REQUIREMENTS]?.at(-1) ?? "";
      const built = incomplete !== undefined ? !incomplete.has(funcId) : false;
      const item = graphed.get(funcId);
      const scenarios = { conformance: item?.scenarios?.conformance ?? [], acceptance: item?.scenarios?.acceptance ?? [] };
      functionalSpecs.push({ funcId, text, built, conformed: built && tested.has(funcId), testPlainFile: item?.testPlainFile ?? null, scenarios, advisor: advisorOf(funcId, item) });
    }
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : String(error), functionalSpecs: [] };
  }
  // Whether its code is regenerated from the spec as it is now: what regenerating what changed would have to do.
  let drifted = false;
  // Its codebase's base folder against what the codebase started from, when they do not agree - changed since, named
  // differently now, or not there: drift's line, in turri's words. Not kept in step, so said, not done. Only once it has
  // code: before, a base folder not there is parse's warning already.
  let baseFolder;
  try {
    const reports = looker.drift(file);
    drifted = reports.some((report) => report.code !== null);
    if (built) baseFolder = reports.find((report) => report.plainFile === file && typeof report.baseFolder === "string")?.baseFolder;
  } catch {
    drifted = true;
  }
  // A step of adding tests skipped - scenarios, but no test reqs or no conformance testing script: turri says which, and
  // writes no conformance tests there until it is taken.
  return { ...base, built, drifted, conformanceTested, functionalSpecs, warnings: result.warnings ?? [], ...(baseFolder !== undefined ? { baseFolder } : {}) };
}

function readSpec({ file }) {
  return { file, text: readFileSync(file, "utf8") };
}

function writeSpec({ file, text }) {
  writeFileSync(file, text);
  const described = describePlain(file);
  // A ***plain that changes while the session's loop looks after its module is work: the loop is told, as a chat's watch
  // does - of the module a test plain file's scenarios are of, for a test plain file.
  const module = isTestPlainFile(file) ? testPlainFiles().find((each) => each.file === file)?.moduleFile : file;
  const loop = loopNow();
  if (described.ok && module && loop !== undefined && loop.status().some((status) => status.plainFile === module)) {
    loop.bringUp(module, { specChange: true }).then(() => emit("status", statusNow())).catch((error) => emit("log", { level: "error", text: String(error) }));
  }
  return described;
}

/**
 * The spec's lines as turri's own ***plain grammar colours them - the same roles the TUI uses. In the front matter,
 * what has no role of its own reads as `meta` and its fences as `bullet`: its modules - imported, required, or a test
 * plain file's - and its concepts keep theirs, and a test plain file's func-id is a `func-ref`, a link to it.
 */
function highlightSpec({ text }) {
  return turri.highlightLines(text.split("\n")).map((tokens) => tokens.map((token) => ({ text: token.text, role: roleOf(token) })));
}

function roleOf({ text, scopes }) {
  const role = turri.roleOf(scopes) ?? null;
  if (!scopes.includes("meta.frontmatter.plain")) return role;
  if (text === "---") return "bullet";
  // A test plain file's: the module its scenarios are of, and the functional spec's func-id - each a link, ⌘-clicked.
  if (role === "id") return "func-ref";
  return role === "keyword" || role === "concept" || role === "module" ? role : "meta";
}

// ---------- the work ----------

function statusNow() {
  const registry = registryNow();
  const loop = loopNow();
  return {
    modules: loop?.status() ?? [],
    jobs: (registry?.list() ?? []).filter((job) => job.replacedBy === undefined).map(jobView),
    planned: (loop?.planned() ?? []).map(jobView),
  };
}

/** A job as the app shows it: everything but its agents' transcript, which the window does not show. */
function jobView(job) {
  const { transcript, tail, details, ...rest } = job;
  return { ...rest, specGaps: details?.specGaps ?? [], failures: failures.get(job.id) ?? [] };
}

const lastSent = new Map();
function jobChanged(job, now = false) {
  // A job reports many times a second while its agent streams: the window gets it at most five times a second.
  const at = Date.now();
  if (!now && at - (lastSent.get(job.id) ?? 0) < 200) return;
  lastSent.set(job.id, at);
  emit("job", jobView(job));
}

// The buttons say what the person would type: the chat's own commands run them, on its one work loop.

/**
 * /regenerate, as the window chose it: what changed, named functional specs again, or from scratch - its whole chain
 * too - and how to cut the work in the person's words. turri reads the words after the module: module:func-ids first
 * are functional specs, "from scratch" and "whole chain" say so, the rest is guidance.
 */
function regenerate({ file, funcIds, scratch, chain, guidance }) {
  const module = basename(file, ".plain");
  const words = [`/regenerate ${relative(projectDir, file)}`];
  if (scratch) words.push(chain ? "from scratch, the whole chain" : "from scratch");
  else if (funcIds?.length) words.push(funcIds.map((funcId) => `${module}:${funcId}`).join(" "));
  // Set off from what comes before it - and never read as a functional spec named, though it starts like one.
  const said = guidance?.trim();
  if (said) words.push(words.length > 1 || /^\S+:\S/.test(said) ? `- ${said}` : said);
  chatOf().send(words.join(" "));
  return true;
}

/**
 * The test advisor asked whether functional specs of a module need testing scenarios - a button's, as turri's host
 * entry has it (evaluateTests): it answers at once with what it started, and each verdict comes to the chat shown.
 */
function evaluateTests({ file, funcIds }) {
  if (session.evaluateTests === undefined) throw new Error("the turri running has no test advisor.");
  if (!Array.isArray(funcIds) || funcIds.length === 0 || funcIds.some((funcId) => typeof funcId !== "string" || funcId === "")) throw new Error("Which functional specs?");
  const module = basename(inProject(file), ".plain");
  return session.evaluateTests(funcIds.map((funcId) => `${module}:${funcId}`));
}

function conform({ file, funcIds }) {
  const module = basename(file, ".plain");
  chatOf().send(funcIds?.length ? `Write and run the conformance tests for ${funcIds.map((funcId) => `${module}:${funcId}`).join(", ")}.` : `Write and run the conformance tests for ${module}.`);
  return true;
}

/**
 * A failed pulse investigated, from its card: a chat of its own - beside the others, shown - asked to find out why it
 * failed, explain it and fix what needs fixing, with what the pulse said of it. On a turri with one chat, that chat.
 */
async function investigate({ id, module, pulse, kind, why }) {
  const chat = session.canOpen ? await openChat() : undefined;
  const which = [module, pulse !== undefined && pulse !== null ? `pulse ${pulse}` : null, kind, id].filter(Boolean).join(" · ");
  const said = typeof why === "string" && why.trim() !== "" ? `\n\nWhy it failed, as the pulse reported it:\n\n${why.trim()}` : "";
  chatOf(chat).send(`Investigate the pulse that failed (${which}): find out why it failed, explain it to me, and fix what needs fixing so it can succeed.${said}`);
  return true;
}

/**
 * The window's view and the file open in it - or, in the preview, its browser or terminal - as the person moves about:
 * told to turri at its next turn.
 */
function look({ view, file, pane }) {
  // A file of the project by its path in it; a module of the standard library by its name, as it is.
  looking = { view, file: file ? (isAbsolute(file) ? relative(projectDir, file) || file : file) : null, pane: pane ?? null };
  return true;
}

/**
 * Something said in a chat. /new - pi's terminal's, which would go to the model as words here - opens a chat beside it,
 * as it does in turri's terminal.
 */
/** The images a message can carry, as the model takes them. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * A message said in a chat - with what is attached to it: its images, for the model to see, and other files by their
 * paths, below what was typed, for turri to read with its tools.
 */
async function sendChat({ chat, text, images = [], files = [] }) {
  if (/^\/new\s*$/.test(text.trim()) && session.canOpen) return (await openChat(), true);
  const seen = images.filter((image) => IMAGE_TYPES.has(image?.mimeType) && typeof image.data === "string").map(({ mimeType, data }) => ({ type: "image", mimeType, data }));
  const named = files.filter((file) => typeof file === "string" && isAbsolute(file));
  const said = named.length === 0 ? text : [text, named.map((file) => `Attached file: ${file}`).join("\n")].filter(Boolean).join("\n\n");
  chatOf(chat).send(said, seen);
  return true;
}

function abortChat({ chat }) {
  void chatOf(chat).abort();
  return true;
}

function commands() {
  return chatOf().commands();
}

/** Whether the turri running gives every setting of config.turri.yaml (after 0.1.12): else the window has summary's few. */
const KNOWS_SETTINGS = typeof turri.configSettings === "function";

/** A setting's value as the window shows it and /turri-config takes it back: a list by commas, the rest as written. */
const typedValue = (value) => (Array.isArray(value) ? value.join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/**
 * Every setting of the project's config.turri.yaml, as /turri-config knows it - what it does and takes, what it is
 * unset, when a change takes effect, what wins over it - with what the file has now, null for unset. Null from a turri
 * that does not say them.
 */
function projectSettings() {
  if (!KNOWS_SETTINGS) return null;
  const text = turri.readConfigText(projectDir);
  return turri.configSettings().map((setting) => {
    const value = turri.currentValue(text, setting.key);
    return {
      key: setting.key,
      about: setting.about,
      kind: setting.kind,
      unset: setting.unset,
      effect: turri.EFFECT_TEXT[setting.effect],
      options: setting.options ?? [],
      value: value === undefined || value === null ? null : typedValue(value),
      over: turri.overriddenBy(projectDir, text, setting),
    };
  });
}

/**
 * What /turri-config offers for a setting's value, as typing it in the chat would - turri's own choices, never the
 * window's: `harness-model ` the models reachable here, `harness-model <model>:` how hard it can think, `review ` true or
 * false. Unset is left out: the window offers it in its own way.
 */
async function configChoices({ typed }) {
  if (session === undefined) return [];
  const items = await chatOf().completions("turri-config", typed);
  return items.map((item) => item.value.slice(item.value.indexOf(" ") + 1)).filter((value) => value !== "unset");
}

/**
 * A chat as the window draws it: what was said in it and what waits to be heard, its model, how full it is, what it asks
 * now, and the sentinel's notices open in it.
 */
function chatHistory({ chat }) {
  const shown = chatOf(chat);
  const asking = [...questions.values()].filter((question) => question.chat === shown.id).map((question) => question.asked);
  const open = session.notices().filter((notice) => notice.chat === shown.id);
  return { messages: shown.history(), queued: shown.queued(), model: shown.model(), stats: shown.stats(), questions: asking, notices: open };
}

/** The sentinel's notices open now, each in the chat it names. */
function notices() {
  return session.notices();
}

/**
 * A notice answered from its card: one of its actions (`{ action }`, by its index), the person's own words (`{ steer }`)
 * - the chat it is in started on it - or dismissed. turri's `done`, `dismissed`, `over` or `missing`.
 */
async function answerNotice({ id, answer }) {
  if (!SENTINEL) throw new Error("This turri has no sentinel.");
  return session.answerNotice(id, answer);
}

/** The chats, in their order: each its id, title, what it is doing and whether it is the one shown. */
function chats() {
  return session.chats();
}

/**
 * turri's session, started with its first chat. The work loop's plan can change with no word of it - planned again while
 * a pulse runs, on a ***plain edited from a chat - so the window is sent it again as each chat's tools end, and as it
 * settles: regenerate, say, ends once the plan is made.
 */
async function startChats() {
  const harnessModel = turri.modelSpec(turri.projectModels(turri.readProjectConfig(projectDir)).harness);
  session = await startSession({
    cwd: projectDir,
    harnessModel,
    host,
    emit,
    ask,
    browser,
    terminal,
    whereNow: () => looking,
    onStep: () => loopNow() !== undefined && emit("status", statusNow()),
    onChats: (now) => {
      // A chat closed: what it was asking is put away.
      for (const [id, question] of questions) {
        if (now.some((chat) => chat.id === question.chat)) continue;
        question.resolve(undefined);
        questions.delete(id);
      }
      emit("chats", now);
    },
  });
}

/** A fresh chat beside the others, shown - as /chat new is in turri's terminal: its id. */
async function openChat() {
  return session.open();
}

/**
 * A chat closed: its turn stopped and its conversation deleted - its pulses run on. The person's last one is kept; the
 * sentinel's closes whenever, and opens again with the next pulse that finishes.
 */
async function closeChat({ chat }) {
  // The person's chats: those with no role - the sentinel's is `sentinel`.
  const theirs = session.chats().filter((each) => each.role === undefined);
  if (theirs.length <= 1 && theirs.some((each) => each.id === chat)) throw new Error("This is the only chat.");
  await session.close(chat);
  return true;
}

/**
 * ctrl+c in a chat, as turri's terminal has it: what the chat is doing stopped, the others left as they are. One doing
 * nothing has its draft cleared, when there is one - the window's own, so the window clears it (`cleared`) - and with
 * none, turri's session ends, every chat with it, and the window closes with it (`ended`). A second press straight
 * after one that stopped something is `ignored`.
 */
async function interruptChat({ chat, draft }) {
  const shown = chatOf(chat);
  if (draft === true && !busy(shown.session)) return "cleared";
  const did = await session.interrupt(shown.id);
  if (did === "stopped") shown.restore();
  if (did === "ended") emit("ended", null);
  return did;
}

/** The chat the person looks at now: a pulse a closed chat asked for is told there when it ends. */
function focusChat({ chat }) {
  session.focus(chat);
  return true;
}

/** What regenerating would do, planned on a loop of its own that starts nothing - `turri glimpse`. */
async function glimpse({ file }) {
  const project = turri.readProjectConfig(projectDir);
  const models = turri.projectModels(project);
  const planner = turri.modelSpec(models.harness);
  const dry = turri.createWorkLoop({
    registry: turri.createJobRegistry(),
    cwd: projectDir,
    dryRun: true,
    modelFor: () => turri.modelSpec(models.coding),
    ...(planner !== undefined ? { plannerModel: planner } : {}),
  });
  const statuses = await dry.bringUp(file);
  const firsts = [];
  for (const first of dry.firsts()) {
    firsts.push({ module: first.module, title: first.planned.title, reason: first.planned.reason, track: first.planned.track, prompt: first.planned.track === "code" ? ((await turri.promptOf(first)) ?? null) : null });
  }
  return { statuses, firsts, drift: dry.drift(file) };
}

/**
 * Whether this machine - and the project open, or the one named (`dir`: one just made that would not open) - is ready
 * for turri: `turri doctor`'s checks, printing nothing. They look in this engine's own environment, the PATH turri runs
 * with here, which is not always the person's shell's. Asking the project's models costs money, so only when asked.
 * null from a turri without doctor (0.1.9 and before).
 */
async function doctor({ models = false, dir = projectDir }) {
  if (typeof turri.doctor !== "function") return null;
  return turri.doctor({ dir, models: models === true && dir !== undefined, env: process.env });
}

// ---------- the wire ----------

const methods = { ...auth, chats, openChat, closeChat, focusChat, interruptChat, declineQuestion, notices, answerNotice, look, open, vendors, initConfig, summary, projectSettings, configChoices, listFiles, treeFiles, readFile, writeFile, stdlib, stdlibKinds, plainLinks, concepts, conceptDefinition, linkedResource, conceptBeingTyped, readSpec, writeSpec, highlightSpec, status: statusNow, regenerate, conform, evaluateTests, investigate, glimpse, earlierPulses, sendChat, abortChat, chatHistory, commands, answer, doctor };

// What the window may ask before a project is open: to open one, to start a new one, whether the machine is ready, or to
// sign in to the model providers.
const BEFORE_A_PROJECT = new Set(["open", "vendors", "initConfig", "doctor", ...Object.keys(auth)]);

// The app gone - quit, crashed, killed - the engine goes with it: never a chat left running with no window.
process.on("disconnect", () => {
  stopHearing();
  // What turri started - a release, say - stopped with it, as long as that takes a moment.
  const gone = setTimeout(() => process.exit(0), 2000);
  Promise.resolve(session?.dispose())
    .catch(() => {})
    .finally(() => {
      clearTimeout(gone);
      process.exit(0);
    });
});

process.on("message", async ({ id, method, params, reply, result, error }) => {
  if (reply !== undefined) {
    const call = paneCalls.get(reply);
    paneCalls.delete(reply);
    if (error !== undefined) call?.reject(new Error(error));
    else call?.resolve(result);
    return;
  }
  try {
    const handler = methods[method];
    if (handler === undefined) throw new Error(`No such engine method: ${method}`);
    if (!BEFORE_A_PROJECT.has(method) && projectDir === undefined) throw new Error("No project is open.");
    const result = await handler(params ?? {});
    process.send?.({ id, result });
  } catch (error) {
    process.send?.({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

emit("ready", { node: process.version, turri: turriFrom });
