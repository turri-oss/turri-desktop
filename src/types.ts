import type { TurriApi } from "../electron/preload.ts";

declare global {
  interface Window {
    turri: TurriApi;
  }
}

export interface FunctionalSpec {
  frid: string;
  text: string;
  built: boolean;
  /** Built, and its conformance tests written and passing - as the spec has it now. */
  conformed: boolean;
}

export interface Spec {
  file: string;
  rel: string;
  ok: boolean;
  module: string;
  description?: string;
  requires: string[];
  error?: string;
  built?: boolean;
  drifted?: boolean;
  conformanceTested?: number;
  functionalSpecs: FunctionalSpec[];
}

export interface Project {
  dir: string;
  name: string;
  turriHome: string;
  hasConfig: boolean;
  stacks: string[];
  settings: Record<string, string | number | boolean | null>;
  specs: Spec[];
  /** What of ***plain the turri it runs gives the window: the stdlib view, what a ***plain links, its concepts, its linked resources. */
  /** What the turri running gives the window - several chats among it. */
  /** What the turri running gives the window: its standard library, the graph, concepts, several chats, a sentinel. */
  offers: { stdlib: boolean; links: boolean; concepts: boolean; resources: boolean; chats: boolean; sentinel?: boolean };
  /** A project just started: what turri said of the config it wrote for it - its models, and how to sign in. */
  setup?: string;
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
  model?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  sequence: number;
  queuedAt: number;
  startedAt: number;
  finishedAt?: number;
  planning?: { since: number };
  waitingOn: string[];
  stage?: string;
  building?: { label: string; text: string; since?: number };
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
  planned: Array<{ title: string; track: "code" | "conformance"; planning?: true; afterCode?: true }>;
  planNotes?: string[];
  why?: string;
  stack?: string;
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
