import type { TurriApi } from "../electron/preload.ts";

declare global {
  interface Window {
    turri: TurriApi;
  }
}

export interface FunctionalSpec {
  /** Its name in its module - `# <func-id>`; outside it, `module:func-id`. */
  funcId: string;
  /** Its body, under its heading. */
  text: string;
  built: boolean;
  /** Built, and its conformance tests written and passing - as the spec has it now. */
  conformed: boolean;
  /** Its test plain file - none, and it is not tested - and the scenarios in it. */
  testPlainFile: string | null;
  scenarios: { conformance: Scenario[]; acceptance: Scenario[] };
  /** What the test advisor made of it, as it reads now - none when it has not looked at this text. */
  advisor: Advisor | null;
}

/**
 * The test advisor on a functional spec: being evaluated (`pending`), a verdict - it needs testing scenarios or it does
 * not - or `failed`, with why. A yes holds what it found: the questions that were a yes, with their evidence, and the
 * inputs the scenarios are to cover; `undelivered` while no chat has had it yet.
 */
export interface Advisor {
  state: "pending" | "yes" | "no" | "failed";
  report?: {
    verdict: "yes" | "no";
    questions: Array<{ question: "silent-failure" | "divergence" | "revisited" | "cost"; evidence: string }>;
    inputs: Array<{ input: string; agreed: string } | { input: string; readings: string[] }>;
  };
  undelivered?: boolean;
  reason?: string;
}

export interface Spec {
  file: string;
  rel: string;
  ok: boolean;
  module: string;
  description?: string;
  requires: string[];
  error?: string;
  /** What to do about `error`, as turri says it: a module in the old ***plain syntax converted. */
  nextStep?: string;
  /** A step of adding tests it skipped, and the next step, as turri says it: its conformance tests wait on it. */
  warnings?: string[];
  built?: boolean;
  drifted?: boolean;
  /** How its codebase's base folder stands against what the codebase started from, when they do not agree: drift's line. */
  baseFolder?: string;
  conformanceTested?: number;
  /** Whether its functional specs are conformance tested - conformance-tests:, its stack's over the project's. Off, their scenarios are kept and not tested. */
  conformanceTests?: boolean;
  functionalSpecs: FunctionalSpec[];
}

/** A scenario of a functional spec's: its `# <scenario-id>` heading's id, its text, and the heading's line, from 1. */
export interface Scenario {
  id: string;
  text: string;
  line: number;
}

/**
 * A test plain file: the conformance and acceptance scenarios of one functional spec, bound to it by its module and
 * func-id - the module's file, and its heading's line there (from 1). One out of place, or binding to none, has `error`.
 */
export interface TestPlainFile {
  file: string;
  rel: string;
  module?: string;
  funcId?: string;
  moduleFile: string | null;
  line: number | null;
  conformance: Scenario[];
  acceptance: Scenario[];
  error?: string;
}

export interface Project {
  dir: string;
  name: string;
  turriHome: string;
  hasConfig: boolean;
  stacks: string[];
  settings: Record<string, string | number | boolean | null>;
  specs: Spec[];
  testPlainFiles: TestPlainFile[];
  /** The modules' test folders, by their paths in the project. */
  testDirs: string[];
  /** What of ***plain the turri it runs gives the window: the stdlib view, what a ***plain links, its concepts, its linked resources. */
  /** What the turri running gives the window - several chats among it. */
  /** What the turri running gives the window: its standard library, the graph, concepts, several chats, a sentinel. */
  offers: { stdlib: boolean; links: boolean; concepts: boolean; resources: boolean; chats: boolean; sentinel?: boolean };
  /** A project just started: what turri said of the config it wrote for it - its models, and how to sign in. */
  setup?: string;
  /** A project just made: the base folder chosen for it, by its path from the project's folder - written once it opens. */
  startFrom?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface Job {
  id: string;
  kind: string;
  summary: string;
  module?: string;
  pulse?: number;
  title?: string;
  /** The spec change a pulse renders, as a diff of the .plain files. */
  diff?: string;
  /** Where the diff's lines are in the .plain files: by a line's place in the diff, its file and its line there (from 1). */
  /**
   * Where each line of the diff is written: its file and line - and, from a turri that says it, the line as the file has
   * it (`written`), its links as links, where the diff has them as turri reads them.
   */
  diffWhere?: Record<number, { file: string; line: number; section?: string; written?: string }>;
  /**
   * The functional specs a pulse covers, as planned, by what it does to each: new, changed, regenerated again with its
   * text unchanged, taken out - its module's own or a module's below it. None for a job that is not a pulse.
   */
  cases?: JobCases;
  model?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  sequence: number;
  queuedAt: number;
  startedAt: number;
  finishedAt?: number;
  planning?: { since: number };
  waitingOn: string[];
  stage?: string;
  /** The one functional spec a conformance run of one builds now - no pulse the loop plans has one: its `cases` say what it builds. */
  building?: { spec?: { module: string; funcId: string }; label: string; text: string; since?: number };
  activity: string[];
  now?: { label: string; since: number };
  usage: Usage;
  /** Its agents, by label - which turri leaves out for one (its release agent). */
  agents: Array<{ label?: string; model?: string; turns: number; compactions: number; usage: Usage }>;
  report?: string;
  announce?: string;
  error?: string;
  diagnosis?: string;
  environment?: string;
  note?: string;
  specGaps: Array<{ question: string; assumption: string }>;
  /** What failed in it that the work went on past - a healer, the model provider - each once: a mark on its card. */
  failures: Failure[];
}

/** A functional spec of a module, as turri names it outside the module: `module:func-id`. */
export interface SpecRef {
  module: string;
  funcId: string;
}

export interface JobCases {
  add: SpecRef[];
  patch: SpecRef[];
  again: SpecRef[];
  delete: SpecRef[];
}

/** A failure of a pulse's, from the ledger: `mark` is what its card says, `text` the whole of it. */
export interface Failure {
  mark: string;
  text: string;
}

/** A pulse of an earlier session, as the ledger has it: read only, nothing of it live. */
export interface PastPulse {
  id: string;
  run: string;
  kind: string;
  summary: string;
  module: string | null;
  pulse: number | null;
  title: string | null;
  /** How it ended - or that it never did, its run stopped while it ran (unended) or before it started (unstarted). */
  status: "succeeded" | "failed" | "stopped" | "unended" | "unstarted";
  landed: boolean | null;
  stoppedBy: "person" | "turri" | null;
  ms: number | null;
  usage: Usage | null;
  error: string | null;
  failures: Failure[];
  /** When it was queued, as the ledger has it - what its run's pulses are ordered by, the newest first. */
  queued?: string | null;
  /** The ***plain it regenerated, as last steered, and where its lines are - from the ledger, null for a pulse recorded before it kept them. */
  diff?: string | null;
  diffWhere?: Job["diffWhere"] | null;
  /** The functional specs it covered, as it was queued - null for one recorded without them, or not a pulse. */
  cases?: JobCases | null;
}

/** A run of turri's in the project - a session of the app's, a chat in a terminal, a headless regenerate - and its pulses. */
export interface PastRun {
  run: string;
  mode: string | null;
  started: string | null;
  version: string | null;
  pulses: PastPulse[];
}

export interface ModuleStatus {
  module: string;
  plainFile: string;
  running?: { jobId: string; title: string };
  /** Its conformance tests behind while its code is still to build (`afterCode`) name their functional specs, `module:func-id`. */
  planned: Array<{ title: string; cases?: JobCases; track: "code" | "conformance"; planning?: true; afterCode?: true; specs?: string[] }>;
  planNotes?: string[];
  why?: string;
  stack?: string;
  /** Pure renames turri makes once the running pulse ends - a func-id or a scenario-id, nothing else with it. */
  renames?: string[];
  /** The base folder its codebase started from - as base-folder: named it - and how many of its files the code has still. */
  base?: { folder: string; files: number };
}

/** A pure rename turri made: a func-id or a scenario-id, of `spec` (`module:func-id`, as it is named now), nothing regenerated. */
export interface Renamed {
  what: "func-id" | "scenario-id";
  from: string;
  to: string;
  spec: string;
  at: number;
}

export interface Status {
  modules: ModuleStatus[];
  jobs: Job[];
  planned: Job[];
}


export type View = "spec" | "work" | "preview" | "stdlib";

/** A concept the project's ***plain can name - `:User:` - with what its definition says, and where it is defined. */
export interface Concept {
  name: string;
  about: string;
  /** The .plain that defines it, by its path in the project; a template of the standard library; or ***plain itself. */
  from: string;
}

/** A template of turri's standard library, as turri lists it, and which of the project's .plain files import it. */
export interface StdlibModule {
  /** What a ***plain imports it as: `stdlib/backend/java-springboot`. */
  name: string;
  kind: string;
  /** A stack to import - not a kind's `common`, a conformance template or a language's. */
  stack: boolean;
  /** A stack's conformance template, when it has one; a conformance template's stack. */
  conformance?: string;
  tests?: string;
  description: string;
  imports: string[];
  usedBy: Array<{ file: string; rel: string }>;
  text: string;
}
/** What the preview tries the app in: a browser pane, or a terminal. */
export type Pane = "browser" | "terminal";
