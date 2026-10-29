import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./types.ts";
import type { Concept, Job, Pane, PastRun, Project, Renamed, Spec, Status, StdlibModule, View } from "./types.ts";
import { Welcome } from "./Welcome.tsx";
import { buildingIn, SpecView } from "./SpecView.tsx";
import { newestJobs, newestRuns, sentinelByPulse, WorkView } from "./WorkView.tsx";
import { PlanSheet, type Plan } from "./PlanSheet.tsx";
import { type Point, type PulseLines, pulseLinesOf } from "./PulseSpec.tsx";
import { DoctorSheet, problems, toSeeTo } from "./DoctorSheet.tsx";
import { AuthSheet } from "./AuthSheet.tsx";
import { AboutSheet, type AboutTab } from "./AboutSheet.tsx";
import { SettingsSheet } from "./SettingsSheet.tsx";
import { ChooseFolder, ProjectSettingsSheet } from "./ProjectSettings.tsx";
import { GettingStartedSheet } from "./GettingStarted.tsx";
import type { Check } from "../electron/preload.ts";
import { RegenerateSheet, type Regeneration } from "./RegenerateSheet.tsx";
import { NewProject } from "./NewProject.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { FileTree } from "./FileTree.tsx";
import { FileView } from "./FileView.tsx";
import { PreviewView } from "./PreviewView.tsx";
import { StdlibView } from "./StdlibView.tsx";
import { DiveScreen } from "./DiveScreen.tsx";
import { ConceptUses, type Followed, type Link, type Place, type Use } from "./PlainLinks.tsx";
import { Empty, Icon, Jellyfish, PlainName, Spinner, TurriVersionLine, withPlain } from "./ui.tsx";
import { Chat, pulseLine } from "./Chat.tsx";
import { StatusPanel, type Notification, type Problem } from "./StatusPanel.tsx";
import { type Tone, useChats } from "./chats.ts";
import { keys, withMod } from "./platform.ts";

/** The views, as the toolbar has them, left to right: ctrl+tab goes along them. regen is the dive's. */
const VIEWS: View[] = ["spec", "preview"];

const EMPTY_STATUS: Status = { modules: [], jobs: [], planned: [] };
const NO_TOOLS = new Map<string, boolean>();

/** The chat's width: dragged by its edge, kept between launches, never so wide the spec has no room. */
const CHAT_WIDTH = 400;
const CHAT_MIN = 300;
const CHAT_KEY = "turri-app.chat-width";
/** The files' width: dragged by their edge as the chat's is, kept between launches. */
const FILES_WIDTH = 260;
const FILES_MIN = 180;
const FILES_KEY = "turri-app.files-width";
/** The room the ***plain keeps between the files and the chat, however wide either is dragged. */
const SPEC_MIN = 480;
/** The chat's width, beside files `files` wide - 0 when they are hidden. */
function clampChat(width: number, files: number) {
  return Math.round(Math.max(CHAT_MIN, Math.min(width, window.innerWidth - files - SPEC_MIN)));
}
/** The files' width, beside a chat `chat` wide - 0 when it is hidden. */
function clampFiles(width: number, chat: number) {
  return Math.round(Math.max(FILES_MIN, Math.min(width, window.innerWidth - chat - SPEC_MIN)));
}
function savedFilesWidth() {
  try {
    const saved = Number(localStorage.getItem(FILES_KEY));
    return saved > 0 ? saved : FILES_WIDTH;
  } catch {
    return FILES_WIDTH;
  }
}
const SIDEBAR_KEY = "turri-app.sidebar";
/** Whether the files' sidebar is shown: hidden with ⌘B, and kept hidden next time. */
function savedSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "hidden";
  } catch {
    return true;
  }
}
function savedChatWidth() {
  try {
    const saved = Number(localStorage.getItem(CHAT_KEY));
    return saved > 0 ? saved : CHAT_WIDTH;
  } catch {
    return CHAT_WIDTH;
  }
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("spec");
  // The preview's browser and terminal in use - neither as a project opens, each once turri uses it or the person opens
  // it - and the one shown.
  const [pane, setPane] = useState<Pane | null>(null);
  const [panes, setPanes] = useState<Pane[]>([]);
  const openPane = useCallback((name: Pane) => {
    setPanes((all) => (all.includes(name) ? all : [...all, name]));
    setPane(name);
  }, []);
  /** turri at work in the preview, with its browser or terminal tools: the pane edged in blue, and said in its bar. */
  const [testing, setTesting] = useState(false);
  // Which of the two turri works in: the preview glows for it - the window never comes to it on its own - and the person,
  // coming to watch, is shown that one.
  const [testingIn, setTestingIn] = useState<Pane | null>(null);
  const usedBy = useCallback((name: Pane) => {
    setPanes((all) => (all.includes(name) ? all : [...all, name]));
    setPane((now) => now ?? name);
    setTestingIn(name);
  }, []);
  /** Come to watch turri test: the preview, on what it works in. */
  const watch = useCallback(() => {
    setDive(false);
    setView("preview");
    if (testingIn !== null) setPane(testingIn);
  }, [testingIn]);
  /** The standard library's template open in the stdlib view: kept as the person goes to another view and back. */
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(EMPTY_STATUS);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  /** Earlier sessions' pulses, from the ledger: read when the project opens and again as each pulse ends. */
  const [earlier, setEarlier] = useState<PastRun[]>([]);
  // What the window was told or found, this project's, for the status panel: kept until dismissed.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const noticed = useRef(0);
  // A pulse opened from its notification - the current render's way to it, for the engine's events to reach.
  const openPulse = useRef<(id: string) => void>(() => {});
  // turri's notices that have ended, put away from the status panel.
  const [putAway, setPutAway] = useState<Set<string>>(new Set());
  // The engine stopped under the window - crashed, say: said until it is started again, with the button that does it.
  const [stopped, setStopped] = useState<"stopped" | "starting" | null>(null);
  const [plan, setPlan] = useState<Plan | "loading" | null>(null);
  // Whether this machine is ready for turri: the sheet of turri doctor's checks, and what they found as the project opened.
  // Open, and whether it asks the models from the start: a project just started does, to see that its models answer -
  // checked out of sight, and opened on what it found only when something wants seeing to.
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorModels, setDoctorModels] = useState(false);
  const [doctorFound, setDoctorFound] = useState<Check[] | undefined>(undefined);
  const [machine, setMachine] = useState<Check[] | null>(null);
  // Signing in to the model providers: the sheet, open on a provider when one was named - /login anthropic.
  const [signIn, setSignIn] = useState<{ provider: string | null } | null>(null);
  // The app's settings (⌘,), About on one of its tabs - privacy, the third-party notices - and Help > Getting Started.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [about, setAbout] = useState<AboutTab | null>(null);
  const [guide, setGuide] = useState(false);
  // Regenerate, chosen how - open with the functional specs it starts on, if any.
  const [choosing, setChoosing] = useState<string[] | null>(null);
  // The dive, in the whole window's place - regen: the dive button in the toolbar, ⌘2, /pulses, a pulse clicked
  // in the chat. Left by its ‹, or by anything that shows the window again - a view, the chat, a ***plain to open.
  const [dive, setDive] = useState(false);
  const diveNow = useRef(false);
  diveNow.current = dive;
  // Lines of a spec to bring into view and light: a pulse's part of it, shown from the work.
  /** The pure renames turri made this session - a func-id or a scenario-id, nothing regenerated - for regen to say. */
  const [renamed, setRenamed] = useState<Renamed[]>([]);
  const [reveal, setReveal] = useState<{ file: string; lines: number[]; texts?: string[]; point?: Point; at: number } | null>(null);
  // Lit once, where it was asked for: gone as the person looks elsewhere - another view, file or template, the dive - so
  // coming back
  // lights nothing again.
  useEffect(() => {
    if (reveal === null) return;
    const there = !dive && (view === "stdlib" ? template === reveal.file : view === "spec" && selected === reveal.file);
    if (!there) setReveal(null);
  }, [view, selected, template, reveal, dive]);
  // A pulse to open in the work view: one the chat says ended, clicked there.
  // The pulse last asked for - marked in regen, and, until regen has brought it into view, to reveal - and the pulses
  // whose cards are open there, and the parts of them (`<id>/<part>`), kept as regen is left and shown again.
  const [focusPulse, setFocusPulse] = useState<{ id: string; at: number; reveal: boolean } | undefined>(undefined);
  const [openPulses, setOpenPulses] = useState<ReadonlySet<string>>(new Set());
  const showPulse = (id: string) => {
    setOpenPulses((now) => new Set(now).add(id));
    setFocusPulse({ id, at: Date.now(), reveal: true });
  };
  // Pulses that failed while regen was not shown, the newest last: the dive button says ! until it is shown, and then
  // opens the newest of them, once, and brings it into view - so a failure is looked at.
  const [unseenFailed, setUnseenFailed] = useState<string[]>([]);
  const knownFailed = useRef(new Set<string>());
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  // The conversation with turri.
  const [chatOpen, setChatOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  /** The open-projects switcher (⇧⌘P), dropped over the window. */
  const [switcher, setSwitcher] = useState(false);
  /** Another project, being opened: the one shown waits under a spinner, as its engine has already stopped. */
  const [switching, setSwitching] = useState<{ dir: string; name: string } | null>(null);
  const [chatWidth, setChatWidth] = useState(savedChatWidth);
  const [filesWidth, setFilesWidth] = useState(savedFilesWidth);
  useEffect(() => {
    try {
      localStorage.setItem(FILES_KEY, String(filesWidth));
    } catch {
      /* not kept: it is 260 again next time */
    }
  }, [filesWidth]);
  const [sidebarChoice, setSidebarChoice] = useState(savedSidebar);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarChoice ? "shown" : "hidden");
    } catch {
      /* not kept: it is shown again next time */
    }
  }, [sidebarChoice]);
  // A project just started opens on the conversation: the chat two thirds of the window, the files hidden - neither
  // kept as the person's own. Each is theirs again once they change it - the chat's edge dragged, the files shown - and
  // both once the project has its first ***plain.
  const [freshChat, setFreshChat] = useState(false);
  const [freshFiles, setFreshFiles] = useState(false);
  const sidebarOpen = sidebarChoice && !freshFiles;
  const toggleSidebar = useCallback(() => {
    if (freshFiles) (setFreshFiles(false), setSidebarChoice(true));
    else setSidebarChoice((open) => !open);
  }, [freshFiles]);
  const [resizing, setResizing] = useState(false);
  // The window resized: the files' and the chat's widths are held to it again.
  const [, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resized = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, String(chatWidth));
    } catch {
      /* not kept: it is 400 again next time */
    }
  }, [chatWidth]);
  const say = useCallback((text: string, tone: Tone = "info", action?: Notification["action"]) => {
    noticed.current += 1;
    const note = { id: noticed.current, text, tone, at: Date.now(), ...(action !== undefined ? { action } : {}) };
    setNotifications((now) => [...now, note]);
  }, []);
  // turri's chats - tabs of the chat, each its own conversation on the project's one work loop - and the one shown. A
  // question asked in any of them brings the chat out.
  const chats = useChats({ onAsk: useCallback(() => setChatOpen(true), []), onNotify: say });
  const shownChat = chats.shown;
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  /** The concepts the project's ***plain can name, for the chat to offer as one is typed: read again as a .plain changes. */
  const [concepts, setConcepts] = useState<Concept[]>([]);
  useEffect(() => {
    if (project === null || !project.offers.concepts) return setConcepts([]);
    const read = () => void window.turri.call<Concept[]>("concepts").then(setConcepts, () => {});
    read();
    const offFiles = window.turri.on("engine:files", ({ paths }: { paths: string[] }) => paths.some((path) => path.endsWith(".plain")) && read());
    const offSpec = window.turri.on("engine:spec", read);
    return () => (offFiles(), offSpec());
  }, [project?.dir]);

  /** The files the tree shows, relative to the project, for tab to complete in the chat: read again as files change. */
  const [treeFiles, setTreeFiles] = useState<string[]>([]);
  useEffect(() => {
    if (project === null) return setTreeFiles([]);
    const read = () => void window.turri.call<string[]>("treeFiles").then(setTreeFiles, () => {});
    read();
    const offFiles = window.turri.on("engine:files", read);
    const offSpec = window.turri.on("engine:spec", read);
    return () => (offFiles(), offSpec());
  }, [project?.dir]);

  // What is selected in the tree: one of the project's specs, or any other file of it.
  const spec = project?.specs.find((entry) => entry.file === selected) ?? null;
  // Whether the ***plain open has changed since its code was built - or is not built yet: only then is there anything
  // for Regenerate What Changed to do. The menu bar is told, to offer it only then.
  const changed = spec !== null && spec.ok && spec.drifted !== false;
  useEffect(() => void window.turri.changed(changed), [changed]);
  // A test plain file: a functional spec's scenarios, in the ***plain view as a module is.
  const tests = project?.testPlainFiles.find((entry) => entry.file === selected) ?? null;
  const file = spec === null && tests === null && project !== null && selected !== null ? selected : null;

  const refreshProject = useCallback(async () => {
    const summary = await window.turri.call<Omit<Project, never>>("summary");
    setProject(summary);
  }, []);

  const opened = useCallback((summary: Project | null) => {
    if (summary === null) return;
    setSwitching(null);
    setStopped(null);
    setGuide(false);
    setRenamed([]);
    setNotifications([]);
    setPutAway(new Set());
    setProject(summary);
    setSelected(summary.specs[0]?.file ?? null);
    setFreshChat(Boolean(summary.setup));
    setFreshFiles(Boolean(summary.setup));
    setTemplate(null);
    setStatus(EMPTY_STATUS);
    setJobs(new Map());
    knownFailed.current = new Set();
    setOpenPulses(new Set());
    setFocusPulse(undefined);
    setUnseenFailed([]);
    setEarlier([]);
    void window.turri.call<PastRun[]>("earlierPulses").then((runs) => setEarlier(newestRuns(runs)));
    setView("spec");
    setPane(null);
    setPanes([]);
    // A project just started opens on what turri said of its config: its models, and how to sign in to them.
    // Its base folder, chosen as it was made: written as the person would type it - /turri-config - once its chats are read,
    // so turri says so there.
    void chats.reset(summary.setup ? [{ role: "note", text: summary.setup, level: "info" }] : []).then(() => {
      if (summary.startFrom !== undefined) void window.turri.call("sendChat", { text: `/turri-config base-folder ${summary.startFrom}` }).catch(() => {});
    });
    // Its models just chosen and its config written: whether this machine is ready for it, and the models answer - said
    // only when something wants seeing to, as a project that is ready needs nothing of you.
    if (summary.setup)
      void window.turri.doctor(true).then(
        (checks) => {
          if (checks === null || problems(checks).length === 0) return;
          setDoctorFound(checks);
          setDoctorModels(true);
          setDoctorOpen(true);
        },
        // The checks would not run: the sheet runs them again, and says why, the models not asked again.
        () => (setDoctorFound(undefined), setDoctorModels(false), setDoctorOpen(true)),
      );
    void window.turri.call<Array<{ name: string; description: string }>>("commands").then(setCommands);
  }, [chats.reset]);

  // What the engine says as the work goes on.
  useEffect(() => {
    const off = [
      window.turri.on("engine:job", (job: Job) => setJobs((all) => new Map(all).set(job.id, job))),
      window.turri.on("engine:status", (next: Status) => {
        setStatus(next);
        setJobs(new Map(next.jobs.map((job) => [job.id, job])));
      }),
      // A pulse's end - said as the chat said it, its module and that it finished, and opened from there.
      window.turri.on("engine:finished", (done: { id: string; status: string; title: string; module?: string; kind?: string }) => {
        const line = pulseLine(done.module, done.kind === "conformance" ? "conformance" : "regenerate", done.status);
        say(line, done.status === "failed" ? "error" : "info", { label: done.status === "succeeded" ? "show" : "see why", run: () => openPulse.current(done.id) });
        void refreshProject();
      }),
      window.turri.on("engine:earlier", (runs: PastRun[]) => setEarlier(newestRuns(runs))),
      window.turri.on("engine:incident", (incident: { job?: string; text: string }) => say(incident.text, "error")),
      // A pure rename turri made: regen says it as one.
      window.turri.on("engine:renamed", (rename: Renamed) => setRenamed((now) => [...now, rename])),
      window.turri.on("engine:exit", () => {
        setStopped("stopped");
        // Its pulses went with it: none is running or waiting any more, whatever they last said.
        setJobs((all) => {
          const now = Date.now();
          const ended = [...all.values()].map((job): Job => (job.status === "running" || job.status === "queued" ? { ...job, status: "stopped", finishedAt: now, error: "The turri engine stopped under this pulse. Open the project again to restart it." } : job));
          return new Map(ended.map((job) => [job.id, job]));
        });
      }),
      window.turri.on("project:opened", opened),
      window.turri.on("project:opening", setSwitching),
      window.turri.on("project:failed", ({ text }: { text: string }) => say(text, "error")),
      // A .plain file changed on disk - turri edited it, say: what it says now, in the sidebar; a new one, listed.
      window.turri.on("engine:spec", ({ spec: next }: { spec: Spec }) =>
        setProject((now) => {
          if (now === null) return now;
          if (!now.specs.some((entry) => entry.file === next.file)) {
            void refreshProject();
            return now;
          }
          return { ...now, specs: now.specs.map((entry) => (entry.file === next.file ? next : entry)) };
        }),
      ),
      // The config changed - /turri-config, say: its settings in the sidebar, and the model the chat runs on now.
      window.turri.on("engine:config", () => void refreshProject()),
      // turri works in the preview with its browser or terminal tools: the preview glows, inviting the person to watch -
      // the window stays where they are, in the dive too.
      window.turri.on("preview:reveal", () => usedBy("browser")),
      window.turri.on("terminal:reveal", () => usedBy("terminal")),
      window.turri.on("preview:testing", (now: boolean) => (setTesting(now), now || setTestingIn(null))),
      // /login typed in the chat: pi's terminal would sign in there, the window does it in its sheet.
      window.turri.on("engine:auth:open", ({ provider }: { provider: string | null }) => setSignIn({ provider })),
      // /pulses typed in the chat: turri's side panel in a terminal, the regen view here.
      window.turri.on("engine:regen:open", () => setDive(true)),
    ];
    return () => off.forEach((stop) => stop());
  }, [opened, refreshProject, say]);

  const regenerate = useCallback(
    async (how?: Regeneration) => {
      if (spec === null) return;
      if (dirty) await saveRef.current?.();
      setChatOpen(true);
      try {
        await window.turri.call("regenerate", {
          file: spec.file,
          funcIds: how?.how === "again" ? how.funcIds : undefined,
          scratch: how?.how === "scratch",
          chain: how?.how === "scratch" && how.chain,
          // Continued: what changed, as turri brings a module up to its spec - with the planner told where it stopped.
          guidance: how?.how === "continue" ? `carry on where it stopped: build the functional specs not built yet - ${how.left.map((funcId) => `${spec.module}:${funcId}`).join(", ")}` : undefined,
        });
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      }
    },
    [spec, dirty, say],
  );

  /** Said to the chat shown, as the person would type it - a next step turri named, from a button: the chat opened on it. */
  const ask = useCallback(
    async (text: string) => {
      setChatOpen(true);
      try {
        await window.turri.call("sendChat", { text });
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      }
    },
    [say],
  );

  /**
   * The project's problems, as turri reads its files: a ***plain or a test plain file that does not parse - with what the
   * chat can do about it - and a module whose conformance tests wait on a step of adding tests. The one open first.
   */
  const plainProblems = useMemo((): Problem[] => {
    if (project === null) return [];
    const found: Problem[] = [
      ...project.specs.flatMap((each): Problem[] => [
        ...(each.ok
          ? []
          : [
              {
                key: `${each.file}\nerror`,
                tone: "error" as const,
                file: each.file,
                rel: each.rel,
                title: (
                  <>
                    the <PlainName /> does not parse
                  </>
                ),
                text: each.nextStep !== undefined ? `${each.error ?? ""} ${each.nextStep}` : (each.error ?? ""),
                ...(each.nextStep !== undefined ? { action: { label: "convert it", run: () => void ask(`Convert ${each.rel} to the new ***plain syntax.`) } } : {}),
              },
            ]),
        // validate's warnings - a step of adding tests skipped, a base folder not there: said, not an error, in turri's
        // words, each under the one heading - what each is about is turri's to say.
        ...(each.warnings ?? []).map((warning) => ({
          key: `${each.file}\n${warning}`,
          tone: "warning" as const,
          file: each.file,
          rel: each.rel,
          title: "turri warns",
          text: warning,
        })),
        // Its base folder not as its codebase started from it - not copied in again: said, as drift says it.
        ...(each.ok && each.baseFolder !== undefined
          ? [{ key: `${each.file}\nbase folder`, tone: "warning" as const, file: each.file, rel: each.rel, title: "its base folder", text: each.baseFolder }]
          : []),
      ]),
      ...project.testPlainFiles
        .filter((each) => each.error !== undefined)
        .map((each) => ({ key: `${each.file}\nerror`, tone: "error" as const, file: each.file, rel: each.rel, title: "turri does not read this test plain file", text: each.error ?? "" })),
    ];
    return [...found.filter((problem) => problem.file === selected), ...found.filter((problem) => problem.file !== selected)];
  }, [project, selected, ask]);

  /**
   * The test advisor asked whether a functional spec needs testing scenarios: it says at once what it took up - each
   * verdict comes to the chat shown, as the advisor's own do.
   */
  const evaluate = useCallback(
    async (of: Spec, funcId: string) => {
      try {
        const outcome = await window.turri.call<{ started: string[]; already: string[]; scenarios: string[]; missing: string[] }>("evaluateTests", { file: of.file, funcIds: [funcId] });
        const said = [
          ...outcome.started.map((name) => `testing scenarios for ${name} are being evaluated - the verdict comes to the chat.`),
          ...outcome.already.map((name) => `${name} is being evaluated already.`),
          ...outcome.scenarios.map((name) => `${name} has scenarios already.`),
          ...outcome.missing,
        ];
        say(said.join(" ") || `nothing was evaluated for ${of.module}:${funcId}.`, outcome.missing.length > 0 ? "error" : "info");
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      }
    },
    [say],
  );

  const conform = useCallback(
    async (funcIds?: string[]) => {
      if (spec === null) return;
      setChatOpen(true);
      try {
        await window.turri.call("conform", { file: spec.file, funcIds });
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      }
    },
    [spec, say],
  );

  /** A chat with turri beside the others, shown - ⌘T, as a browser opens a tab. */
  const newChat = useCallback(() => {
    if (project === null) return;
    setChatOpen(true);
    if (!project.offers.chats) return say("this turri has one chat: a newer one opens more, side by side.");
    window.turri.call("openChat").catch((error) => say(engineSaid(error), "error"));
  }, [project, say]);
  /** A chat closed - ⌘W, as a browser closes a tab: its conversation is gone, its pulses run on. */
  const closeChat = useCallback((id: string) => void window.turri.call("closeChat", { chat: id }).catch((error) => say(engineSaid(error), "error")), [say]);
  const showChat = useCallback((id: string) => void window.turri.call("focusChat", { chat: id }).catch(() => {}), []);
  /** The view to the right of the one shown, or to the left - round from the ends; stdlib, not among them, as the ***plain. */
  const stepView = useCallback((by: 1 | -1) => setView((now) => VIEWS[(Math.max(VIEWS.indexOf(now), 0) + by + VIEWS.length) % VIEWS.length]!), []);
  // ctrl+tab and ctrl+shift+tab, as in a browser: in the chat, the chat after the one shown and the one before; in the
  // views, the view to the right and the one to the left - each round from the ends. Which is where the focus is, or
  // was last clicked.
  const inViews = useRef(false);
  useEffect(() => {
    const where = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("aside.chat")) inViews.current = false;
      else if (target?.closest("main.main")) inViews.current = true;
    };
    document.addEventListener("pointerdown", where, true);
    document.addEventListener("focusin", where, true);
    return () => (document.removeEventListener("pointerdown", where, true), document.removeEventListener("focusin", where, true));
  }, []);
  /** ⌥⌘←: the focus to the chat - its message box, or the question asked in its place - opened if it is hidden. */
  const focusChat = useCallback(() => {
    inViews.current = false;
    setDive(false);
    setChatOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("aside.chat .composer textarea, aside.chat .question-card button, aside.chat .question-card input, aside.chat .question-card textarea")?.focus());
  }, []);
  /**
   * ⌥⌘→: the focus to the view shown - its editor, the regen list, the preview's terminal, or its page: one loaded,
   * else its address.
   */
  const focusViews = useCallback(() => {
    inViews.current = true;
    // The first there of these, in this order - not the first in the page, a header's button.
    const inside = () => {
      const content = document.querySelector("main.main .content");
      for (const what of [".xterm-helper-textarea", ".editor-pane textarea", "textarea", ".work-view", "input", "button"]) {
        const found = content?.querySelector<HTMLElement>(what);
        if (found) return found.focus();
      }
      // Nothing there to focus - an empty view: the views themselves, for ctrl+tab to go on from.
      document.querySelector<HTMLElement>("main.main .content")?.focus();
    };
    if (view !== "preview" || pane !== "browser") return inside();
    void window.turri.preview.state().then((now) => (now.url !== "" && now.error === null ? void window.turri.preview.go("focus") : inside()), inside);
  }, [view, pane]);
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !event.altKey || !withMod(event) || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft") focusChat();
      else focusViews();
    };
    window.addEventListener("keydown", move, true);
    return () => window.removeEventListener("keydown", move, true);
  }, [focusChat, focusViews]);
  useEffect(() => {
    const step = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !event.ctrlKey || event.metaKey || event.altKey) return;
      if (inViews.current || !chatOpen) {
        event.preventDefault();
        return stepView(event.shiftKey ? -1 : 1);
      }
      if (chats.list.length < 2) return;
      event.preventDefault();
      const at = chats.list.findIndex((chat) => chat.id === chats.shownId);
      const next = chats.list[(at + (event.shiftKey ? chats.list.length - 1 : 1)) % chats.list.length]!;
      setChatOpen(true);
      showChat(next.id);
    };
    window.addEventListener("keydown", step, true);
    return () => window.removeEventListener("keydown", step, true);
  }, [chats.list, chats.shownId, showChat, chatOpen, stepView]);

  const glimpse = useCallback(async () => {
    if (spec === null) return;
    if (dirty) await saveRef.current?.();
    setPlan("loading");
    try {
      setPlan({ spec, ...(await window.turri.call<Omit<Plan, "spec">>("glimpse", { file: spec.file })) });
    } catch (error) {
      setPlan(null);
      say(String((error as Error).message ?? error), "error");
    }
  }, [spec, dirty, say]);

  // The native menu's commands.
  useEffect(
    () =>
      window.turri.on("menu", (action: string) => {
        if (action.startsWith("view:")) (setDive(false), setView(action.slice(5) as View));
        // ctrl+tab in the preview's page, which the window does not hear: the views, from the preview.
        else if (action === "view-next" || action === "view-previous") (inViews.current = true, stepView(action === "view-next" ? 1 : -1));
        else if (action === "focus-chat") focusChat();
        else if (action === "dive") setDive((on) => !on);
        else if (action === "regenerate-how" && spec?.ok) setChoosing([]);
        // Regenerate What Changed: only with something changed - the menu offers it only then.
        else if (action === "regenerate" && changed) void regenerate();
        else if (action === "glimpse") void glimpse();
        else if (action === "conform") void conform();
        else if (action === "save") void saveRef.current?.();
        else if (action === "new-project") setCreating(true);
        else if (action === "switch-project") setSwitcher((open) => !open);
        else if (action === "chat") setChatOpen((open) => !open);
        else if (action === "new-chat") newChat();
        else if (action === "close-chat" && chats.shownId !== null) closeChat(chats.shownId);
        else if (action === "sidebar") toggleSidebar();
        // ⌘R, as in a browser: in the preview the page being tried - the terminal is not reloaded - else the window,
        // which is given its project back.
        else if (action === "reload") {
          if (view !== "preview") location.reload();
          else if (pane === "browser") void window.turri.preview.go("reload");
        }
        else if (action === "reveal" && project) void window.turri.reveal(project.dir);
        else if (action === "doctor") (setDoctorModels(false), setDoctorOpen(true));
        else if (action === "sign-in") setSignIn({ provider: null });
        else if (action === "settings") setSettingsOpen(true);
        else if (action === "project-settings") setProjectSettingsOpen(true);
        else if (action === "about" || action === "privacy" || action === "notices") setAbout(action);
        else if (action === "getting-started") setGuide(true);
      }),
    [regenerate, glimpse, conform, project, spec, changed, view, pane, toggleSidebar, newChat, closeChat, chats.shownId, stepView, focusChat],
  );

  // What the person is looking at, for turri to know: the view, and the file open in it - or the preview's browser or
  // terminal - or regen, in the dive.
  useEffect(() => {
    if (project === null) return;
    if (dive) return void window.turri.call("look", { view: "work", file: null, pane: null }).catch(() => {});
    void window.turri.call("look", { view, file: view === "spec" ? selected : view === "stdlib" ? template : null, pane: view === "preview" ? pane : null }).catch(() => {});
  }, [project?.dir, view, selected, pane, template, dive]);

  // The project's first ***plain written: the chat and the files as the person keeps them.
  useEffect(() => {
    if (project !== null && project.specs.length > 0) (setFreshChat(false), setFreshFiles(false));
  }, [project?.specs.length]);
  // A ***plain there, and nothing open - a project that had none when it opened: the first opens, in place of "no
  // ***plain yet".
  useEffect(() => {
    if (project !== null && selected === null && project.specs.length > 0) setSelected(project.specs[0]!.file);
  }, [project?.specs.length, selected]);

  // What the project needs of this machine - its toolchains, what its testing scripts run - checked as it opens, the
  // models not asked: anything missing is said at the foot of the sidebar.
  useEffect(() => {
    setMachine(null);
    if (project === null) return;
    void window.turri.doctor().then(setMachine).catch(() => {});
  }, [project?.dir]);

  // The stdlib view only where the turri running gives the window its standard library: intent otherwise.
  useEffect(() => {
    if (view === "stdlib" && project !== null && !project.offers.stdlib) setView("spec");
  }, [view, project]);

  /**
   * The text of a file a pulse's ***plain comes from, as turri's diff names it: the project's by its path in it, the
   * standard library's (`stdlib/...`) from turri's - the templates read once a project - or null when it is not there.
   */
  const stdlibTexts = useRef<{ dir: string; texts: Promise<Map<string, string>> } | null>(null);
  const readPlain = useCallback(
    async (rel: string): Promise<string | null> => {
      if (project === null) return null;
      if (rel.startsWith("stdlib/")) {
        if (!project.offers.stdlib) return null;
        if (stdlibTexts.current?.dir !== project.dir)
          stdlibTexts.current = { dir: project.dir, texts: window.turri.call<StdlibModule[]>("stdlib").then((all) => new Map(all.map((module) => [`${module.name}.plain`, module.text]))) };
        return (await stdlibTexts.current.texts).get(rel) ?? null;
      }
      return window.turri.call<{ text: string }>("readSpec", { file: `${project.dir}/${rel}` }).then(
        ({ text }) => text,
        () => null,
      );
    },
    [project?.dir, project?.offers.stdlib],
  );

  /** A module a ***plain names, or one that names it: the standard library's in the stdlib view, the project's in intent. */
  /** A place in the ***plain opened, its line in view and lit: a template of the standard library in stdlib, the project's in intent. */
  const showAt = useCallback((where: Place) => {
    const lit = { lines: [where.line], at: Date.now() };
    if (where.stdlib) {
      setTemplate(where.module);
      setReveal({ file: where.module, ...lit });
      setView("stdlib");
    } else {
      setSelected(where.file);
      setReveal({ file: where.file, ...lit });
      setView("spec");
    }
  }, []);

  /** Where a concept ⌘-clicked where it is defined is used - at the point clicked - to go to one. */
  const [uses, setUses] = useState<{ concept: string; uses: Use[]; x: number; y: number } | null>(null);

  /**
   * A concept clicked in the chat, or ⌘-clicked on a line of a .plain - `from` - opened where it is defined, as turri's
   * graph has it: from a line, the definition that line's item names. ⌘-clicked where it is defined, where it is used.
   */
  const showConcept = useCallback(
    async (concept: string, from?: { file: string; line: number; x: number; y: number }) => {
      const where = await window.turri
        .call<(Place & { uses?: Use[] }) | { plain: true } | null>("conceptDefinition", { concept, file: from?.file, line: from?.line })
        .catch(() => null);
      if (where === null) return say(`no ***plain file of the project defines ${concept}.`);
      if ("plain" in where) return say(`${concept} is ***plain's own: no ***plain file defines it.`);
      if (where.uses === undefined) return showAt(where);
      if (where.uses.length === 0) return say(`no ***plain file uses ${concept} yet.`);
      setUses({ concept, uses: where.uses, x: from!.x, y: from!.y });
    },
    [say, showAt],
  );

  const openLink = useCallback((link: Link) => {
    if (link.stdlib) setTemplate(link.name);
    else if (link.file !== null) setSelected(link.file);
    else return;
    setView(link.stdlib ? "stdlib" : "spec");
  }, []);

  /** What is ⌘-clicked in a .plain of the project: the module it names, a concept's definition, a linked resource's file. */
  const follow = useCallback(
    async (file: string, followed: Followed, point: { x: number; y: number }) => {
      if ("module" in followed) return openLink(followed.module);
      if ("concept" in followed) return showConcept(followed.concept, { file, line: followed.line, ...point });
      // A test plain file's func_id: the functional spec its scenarios are of, where its module has it.
      if ("funcRef" in followed) {
        const of = project?.testPlainFiles.find((entry) => entry.file === file);
        if (of?.moduleFile == null || of.line == null) return say(`${of?.module ?? "its module"} has no functional spec ${followed.funcRef}.`);
        return showAt({ file: of.moduleFile, line: of.line, module: of.module ?? "", stdlib: false });
      }
      const resource = await window.turri.call<{ file: string } | { missing: string } | null>("linkedResource", { file, line: followed.line, index: followed.resource }).catch(() => null);
      if (resource === null) return;
      if ("missing" in resource) return say(`${resource.missing} is not in the project.`);
      setSelected(resource.file);
      setView("spec");
    },
    [openLink, showConcept, say, project, showAt],
  );

  const allJobs = useMemo(() => newestJobs(jobs.values()), [jobs]);
  // What the sentinel did of each pulse, for regen: its conversation, cut by pulse, and what it concluded of each.
  const sentinelChat = chats.sentinel;
  const sentinelWork = useMemo(
    () => sentinelByPulse(sentinelChat?.items ?? [], sentinelChat?.streaming ?? null, sentinelChat?.busy === true, chats.concluded),
    [sentinelChat?.items, sentinelChat?.streaming, sentinelChat?.busy, chats.concluded],
  );
  // The pulse running on a module's ***plain: its own, or one at the top of its chain building a functional spec of it.
  const runningFor = (module: string) => allJobs.find((job) => job.status === "running" && (job.module === module || buildingIn(job, module).size > 0));
  const running = allJobs.filter((job) => job.status === "running");
  // turri testing where the person is not looking: the preview's tab glows, inviting them to watch.
  const invited = testing && !(view === "preview" && (testingIn === null || pane === testingIn));

  // A pulse newly failed, regen not shown: the dive button says so.
  useEffect(() => {
    const failed = allJobs.filter((job) => job.status === "failed" && !knownFailed.current.has(job.id)).reverse();
    if (failed.length === 0) return;
    for (const job of failed) knownFailed.current.add(job.id);
    if (!diveNow.current) setUnseenFailed((now) => [...now, ...failed.map((job) => job.id)]);
  }, [allJobs]);
  // Regen shown with failures unseen: the newest opened and brought into view, and the dive button's ! gone.
  useEffect(() => {
    if (!dive || unseenFailed.length === 0) return;
    showPulse(unseenFailed.at(-1)!);
    setUnseenFailed([]);
  }, [dive, unseenFailed]);

  // In the same place whether a project is open or not, so it is not made again when one opens under it.
  const newProject = creating && <NewProject onOpened={opened} onDone={() => setCreating(false)} />;
  const projectSwitcher = switcher && <ProjectSwitcher onClose={() => setSwitcher(false)} />;
  const doctorSheet = doctorOpen && (
    <DoctorSheet
      project={project?.name ?? null}
      askModels={doctorModels}
      initial={doctorFound}
      onClose={() => {
        setDoctorOpen(false);
        setDoctorFound(undefined);
        // What was seen to while it was open shows at once at the foot of the sidebar.
        if (project !== null) void window.turri.doctor().then(setMachine).catch(() => {});
      }}
    />
  );
  const authSheet = signIn !== null && (
    <AuthSheet
      dir={project?.dir}
      initial={signIn.provider}
      onClose={() => {
        setSignIn(null);
        // Signed in: the foot of the sidebar says so at once.
        if (project !== null) void window.turri.doctor().then(setMachine).catch(() => {});
      }}
    />
  );
  const settingsSheet = settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} onPrivacy={() => (setSettingsOpen(false), setAbout("privacy"))} />;
  const projectSettingsSheet = projectSettingsOpen && project !== null && (
    <ProjectSettingsSheet
      dir={project.dir}
      settings={project.settings}
      onClose={() => setProjectSettingsOpen(false)}
      onOpenFile={() => {
        setProjectSettingsOpen(false);
        setSelected(`${project.dir}/config.turri.yaml`);
        setView("spec");
      }}
    />
  );
  const aboutSheet = about !== null && <AboutSheet tab={about} onClose={() => setAbout(null)} />;
  if (project === null)
    return (
      <>
        <Welcome guide={guide} onOpened={opened} onNew={() => setCreating(true)} onDoctor={() => (setDoctorModels(false), setDoctorOpen(true))} onSignIn={() => setSignIn({ provider: null })} />
        {newProject}
        {projectSwitcher}
        {doctorSheet}
        {authSheet}
        {settingsSheet}
        {aboutSheet}
      </>
    );

  /**
   * A pulse's lines opened where they are: the ***plain view - the standard library's in stdlib - on them, lit, found
   * where they are now when the ***plain has changed since the pulse ran, the caret at the point clicked.
   */
  const showInSpec = (rel: string, lines: PulseLines, point?: Point) => {
    const lit = { lines: lines.map((each) => each.line), texts: lines.map((each) => each.text), point, at: Date.now() };
    setDive(false);
    if (rel.startsWith("stdlib/")) {
      const name = rel.replace(/\.plain$/, "");
      setTemplate(name);
      setReveal({ file: name, ...lit });
      return setView("stdlib");
    }
    // The project's: a module in the ***plain view, a template as its file.
    const file = project.specs.find((entry) => entry.rel === rel)?.file ?? `${project.dir}/${rel}`;
    setSelected(file);
    setReveal({ file, ...lit });
    setView("spec");
  };

  /**
   * A pulse opened from where it is said - its notification: one that landed, what it built in the ***plain, lit, as a
   * click on its lines in regen opens it; one that went wrong, or built no ***plain of its own (a conformance run), its
   * card in regen, to see why and what.
   */
  openPulse.current = (id: string) => {
    const past = earlier.flatMap((run) => run.pulses).find((pulse) => pulse.id === id);
    const job = jobs.get(id) ?? (past !== undefined ? { diff: past.diff ?? undefined, diffWhere: past.diffWhere ?? undefined, status: past.status } : undefined);
    if (job === undefined) return say("that pulse ran in an earlier session, and the ledger has nothing of it now.");
    const built = job.status === "succeeded" ? pulseLinesOf(job, { dirs: project.testDirs, files: project.testPlainFiles }) : null;
    if (built !== null && built.lines.length > 0) return showInSpec(built.file, built.lines);
    setDive(true);
    // The pulse asked for, not a failure the tab was marked for.
    setUnseenFailed([]);
    showPulse(id);
  };

  // As wide as dragged, held to the window: the files first, then the chat beside them - the ***plain keeps its room.
  const filesShown = clampFiles(filesWidth, chatOpen ? CHAT_MIN : 0);
  const chatShown = freshChat ? Math.max(CHAT_MIN, Math.round((window.innerWidth * 2) / 3)) : clampChat(chatWidth, sidebarOpen ? filesShown : 0);

  return (
    <>
      <div
        className={`app ${dive ? "away" : ""} ${chatOpen ? "with-chat" : ""} ${sidebarOpen ? "" : "no-sidebar"} ${resizing ? "resizing" : ""}`}
        style={{ "--chat-width": `${chatShown}px`, "--files-width": `${filesShown}px` } as React.CSSProperties}
        inert={switching !== null}
      >

        {chatOpen && (
          // The chat's right edge, against the views: drag it to make the chat wider or thinner, double-click it for the width it starts at.
          <div
            className="chat-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="resize the chat"
            title="drag to resize the chat - double-click to reset"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) (setFreshChat(false), setChatWidth(clampChat(event.clientX, sidebarOpen ? filesShown : 0)));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setResizing(false);
            }}
            onDoubleClick={() => (setFreshChat(false), setChatWidth(CHAT_WIDTH))}
          />
        )}
        {chatOpen && (
          <Chat
            chatId={chats.shownId}
            chats={chats.list}
            asking={chats.asking}
            canOpen={project.offers.chats}
            onNewChat={newChat}
            onShowChat={showChat}
            onCloseChat={closeChat}
            items={shownChat.items}
            queued={shownChat.queued}
            restored={shownChat.restored}
            streaming={shownChat.streaming}
            busy={shownChat.busy}
            working={shownChat.working}
            running={shownChat.tools}
            statuses={shownChat.statuses}
            model={shownChat.model}
            fresh={project.specs.length === 0}
            changed={project.specs.some((entry) => entry.ok && entry.drifted !== false)}
            commands={commands}
            concepts={concepts}
            files={treeFiles}
            onSend={(text, attached = []) =>
              void window.turri.call("sendChat", {
                chat: chats.shownId,
                text,
                images: attached.flatMap((each) => (each.image ? [each.image] : [])),
                files: attached.flatMap((each) => (each.image ? [] : [each.path])),
              })
            }
            onAbort={() => void window.turri.call("abortChat", { chat: chats.shownId })}
            onInterrupt={(draft) => window.turri.call<string>("interruptChat", { chat: chats.shownId, draft })}
            onDecline={(id) =>
              void window.turri.call<string>("declineQuestion", { id }).then((did) => {
                if (did === "unsupported") say("this turri cannot decline a question - a newer one can: answer it, or skip it.");
              })
            }
            onClose={() => setChatOpen(false)}
            question={shownChat.questions[0]}
            progress={shownChat.progress}
            stats={shownChat.stats}
            onShowConcept={(concept) => void showConcept(concept)}
            onShowPulse={(id) => openPulse.current(id)}
            pulseOf={(id) => jobs.get(id) ?? earlier.flatMap((run) => run.pulses).find((pulse) => pulse.id === id)}
            onShowSentinel={(id) => {
              if (!jobs.has(id)) return say("that pulse ran in an earlier session: what the sentinel did of it is not kept.");
              setDive(true);
              setUnseenFailed([]);
              // Its card opened on what the sentinel did.
              setOpenPulses((now) => new Set(now).add(`${id}/sentinel`));
              showPulse(id);
            }}
            onAnswer={(value) => {
              void window.turri.call("answer", { id: shownChat.questions[0]!.id, value });
              chats.answered(chats.shownId!);
            }}
          />
        )}

        <main className={`main ${project?.offers.resources ? "follows-resources" : ""}`}>
          <header className="toolbar">
            {!chatOpen && (
              <button className={`button open-chat ${chats.asking.size > 0 ? "asking" : ""}`} onClick={() => setChatOpen(true)} title={chats.asking.size > 0 ? "turri is asking you something" : `talk to turri (${keys("J")})`}>
                <Jellyfish size={14} swimming={false} /> turri{chats.asking.size > 0 && " · asks"}
              </button>
            )}
            <div className="segmented" role="tablist">
              {VIEWS.map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={view === name}
                  className={`${view === name ? "on" : ""} ${name === "preview" && invited ? "testing" : ""}`}
                  onClick={() => (name === "preview" && invited ? watch() : setView(name))}
                  title={name === "preview" && invited ? "turri is testing - watch it" : undefined}
                >
                  {name === "spec" ? <PlainName /> : name}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              {/* The dive - and ! once a pulse failed, until it is shown. */}
              <button
                className="icon-button dive-open"
                onClick={() => setDive(true)}
                title={unseenFailed.length > 0 ? `${unseenFailed.length === 1 ? "a pulse" : `${unseenFailed.length} pulses`} failed - see why, in the dive (${keys("2")})` : `dive: every pulse, its plan, trace and cost (${keys("2")})`}
                aria-label="dive"
              >
                <Icon name="bolt" />
                {unseenFailed.length > 0 && <span className="tab-failed" aria-label="a pulse failed">!</span>}
              </button>
              <button className="icon-button sidebar-toggle" onClick={toggleSidebar} title={`${sidebarOpen ? "hide" : "show"} the files (${keys("B")})`} aria-label={sidebarOpen ? "hide the files" : "show the files"} aria-pressed={sidebarOpen}>
                <Icon name="sidebar" />
              </button>
            </div>
          </header>

          <section className="content" tabIndex={-1}>
            {/* In the dive, no view: each comes back as it does from another view. */}
            {dive ? null : view === "preview" ? (
              // A sheet over the window would be under the pane: while one is open, the pane steps aside.
              <PreviewView key={project.dir} dir={project.dir} covered={plan !== null || doctorOpen || signIn !== null || creating || choosing !== null || switching !== null || switcher || settingsOpen || projectSettingsOpen || about !== null || guide} pane={pane} panes={panes} onPane={openPane} testing={testing && (testingIn === null || testingIn === pane)} testingIn={testing ? testingIn : null} />
            ) : view === "stdlib" ? (
              <StdlibView
                key={project.dir}
                selected={template}
                reveal={reveal !== null && reveal.file === template ? reveal : undefined}
                onSelect={setTemplate}
                onOpenSpec={(path) => {
                  setSelected(path);
                  setView("spec");
                }}
              />
            ) : file !== null ? (
              <FileView key={file} root={project.dir} file={file} reveal={reveal?.file === file ? reveal : undefined} onDirty={setDirty} saveRef={saveRef} say={say} onOpen={openLink} onFollow={(followed, point) => void follow(file, followed, point)} />
            ) : tests !== null ? (
              <SpecView
                key={tests.file}
                spec={{ file: tests.file, rel: tests.rel, ok: tests.error === undefined, module: tests.module ?? "", requires: [], functionalSpecs: [], ...(tests.error !== undefined ? { error: tests.error } : {}) }}
                tests={tests}
                onShowSpec={() => tests.moduleFile !== null && tests.line !== null && showAt({ file: tests.moduleFile, line: tests.line, module: tests.module ?? "", stdlib: false })}
                onShowModule={() => tests.moduleFile !== null && setSelected(tests.moduleFile)}
                reveal={reveal?.file === tests.file ? reveal : undefined}
                onSaved={() => void refreshProject()}
                onDirty={setDirty}
                saveRef={saveRef}
                onRegenerate={() => {}}
                onConform={() => {}}
                onOpen={openLink}
                onFollow={(followed, point) => void follow(tests.file, followed, point)}
                onOpenTests={(file, line) => showAt({ file, line, module: tests.module ?? "", stdlib: false })}
                onEvaluate={() => {}}
                onWriteScenarios={() => {}}
                say={say}
              />
            ) : spec === null ? (
              project.specs.length === 0 && (
                <Empty icon="doc" title="no ***plain yet">
                  tell turri what you want to build. it writes the first <PlainName /> with you, then builds the code from it.
                  {/* What its code starts from: an existing codebase, files to use - base-folder:, through /turri-config. */}
                  <span className="empty-start">
                    {typeof project.settings["base-folder"] === "string" ? (
                      <>
                        its code starts from <code>{project.settings["base-folder"]}</code> ·{" "}
                      </>
                    ) : (
                      "building on existing code, or files to use - images, fonts? "
                    )}
                    <ChooseFolder
                      root={project.dir}
                      label={typeof project.settings["base-folder"] === "string" ? "another folder…" : "start from a folder…"}
                      onChosen={(path) => void window.turri.call("sendChat", { text: `/turri-config base-folder ${path}` }).catch((error) => say(engineSaid(error), "error"))}
                    />
                  </span>
                </Empty>
              )
            ) : (
              <SpecView
                key={spec.file}
                spec={spec}
                running={runningFor(spec.module)}
                base={status.modules.find((module) => module.plainFile === spec.file || module.module === spec.module)?.base}
                reveal={reveal?.file === spec.file ? reveal : undefined}
                onSaved={(next: Spec) => setProject((now) => now && { ...now, specs: now.specs.map((entry) => (entry.file === next.file ? next : entry)) })}
                onDirty={setDirty}
                saveRef={saveRef}
                onRegenerate={(funcIds) => void regenerate(funcIds?.length ? { how: "again", funcIds } : undefined)}
                onConform={(funcIds) => void conform(funcIds)}
                onOpen={openLink}
                onFollow={(followed, point) => void follow(spec.file, followed, point)}
                onOpenTests={(file, line) => showAt({ file, line, module: spec.module, stdlib: false })}
                onEvaluate={(funcId) => void evaluate(spec, funcId)}
                onWriteScenarios={(funcId) => void ask(`Write testing scenarios for ${spec.module}:${funcId}.`)}
                say={say}
              />
            )}
          </section>
          <StatusPanel
            problems={plainProblems}
            notifications={notifications}
            notices={chats.notices.filter((shown) => !putAway.has(shown.notice.id))}
            onAnswerNotice={({ notice }, answer) =>
              window.turri.call<string>("answerNotice", { id: notice.id, answer }).then(
                (did) => {
                  // Answered already, superseded, or gone with its session: nothing to do, and it is let go.
                  if (did === "over" || did === "missing") {
                    chats.noticeGone(notice.chat, notice.id);
                    say("that notice is over already - nothing was done.");
                  }
                  // Ignore, on one turri says may not be: it stays open, to answer another way.
                  if (did === "refused") say("this notice cannot be ignored - choose what to do, or dismiss it.");
                  return did;
                },
                (error) => {
                  say(engineSaid(error), "error");
                  throw error;
                },
              )
            }
            onPutAway={(id) => setPutAway((now) => new Set(now).add(id))}
            onOpenFile={(path) => {
              setSelected(path);
              setView("spec");
            }}
            onDismiss={(id) => setNotifications((now) => now.filter((note) => note.id !== id))}
            onClear={() => {
              setNotifications([]);
              setPutAway((now) => new Set([...now, ...chats.notices.filter((shown) => shown.ended !== undefined).map((shown) => shown.notice.id)]));
            }}
          />
          {uses !== null && (
            <ConceptUses
              {...uses}
              onGo={(use) => {
                setUses(null);
                showAt(use);
              }}
              onClose={() => setUses(null)}
            />
          )}
        </main>

        {sidebarOpen && (
          // The files' left edge, against the views: drag it to make them wider or thinner, double-click it for the width they start at.
          <div
            className="files-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="resize the files"
            title="drag to resize the files - double-click to reset"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) setFilesWidth(clampFiles(window.innerWidth - event.clientX, chatOpen ? chatShown : 0));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setResizing(false);
            }}
            onDoubleClick={() => setFilesWidth(FILES_WIDTH)}
          />
        )}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="project-name" title={project.dir}>
              <span>{project.name}</span>
            </div>
            <div className="sidebar-section">files</div>
            <FileTree
              root={project.dir}
              specs={project.specs}
              testPlainFiles={project.testPlainFiles}
              selected={selected}
              isRunning={(module) => runningFor(module) !== undefined}
              onSelect={(path) => {
                setSelected(path);
                setView("spec");
              }}
            />
            <div className="sidebar-footer">
              {problems(machine).length > 0 && (
                <button className="link machine-wanting" onClick={() => (setDoctorModels(false), setDoctorOpen(true))} title={problems(machine).map((check) => `${check.name}: ${check.detail}`).join("\n")}>
                  <Icon name="warn" size={12} /> {toSeeTo(problems(machine))}
                </button>
              )}
              <TurriVersionLine />
            </div>
          </aside>
        )}

        {choosing !== null && spec !== null && (
          <RegenerateSheet
            spec={spec}
            initial={choosing}
            onClose={() => setChoosing(null)}
            onRegenerate={(how) => {
              setChoosing(null);
              void regenerate(how);
            }}
          />
        )}
        {plan !== null && plan !== "loading" && <PlanSheet plan={plan} onClose={() => setPlan(null)} onRegenerate={() => (setPlan(null), void regenerate())} />}
        {stopped && project && (
          <div className="toast error engine-stopped" role="alert">
            <Icon name="warn" />
            <span>the turri engine stopped, and what it was running with it.</span>
            <button
              className="button"
              disabled={stopped === "starting"}
              onClick={() => {
                setStopped("starting");
                window.turri.openProject(project.dir).then(
                  (summary) => opened(summary as Project | null),
                  (error) => {
                    setStopped("stopped");
                    say(String((error as Error).message ?? error), "error");
                  },
                );
              }}
            >
              {stopped === "starting" ? "starting…" : "start it again"}
            </button>
          </div>
        )}
      </div>
      {dive && (
        <DiveScreen project={project.name} asking={chats.asking.size > 0} running={running.length > 0} testing={testing} onWatch={watch} onLeave={() => setDive(false)}>
          <WorkView
            status={status}
            jobs={allJobs}
            earlier={earlier}
            specs={project.specs}
            tests={{ dirs: project.testDirs, files: project.testPlainFiles }}
            renamed={renamed}
            opened={openPulses}
            onToggle={(id) =>
              setOpenPulses((now) => {
                const next = new Set(now);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            focus={focusPulse}
            onRevealed={() => setFocusPulse((now) => now && { ...now, reveal: false })}
            sentinel={sentinelWork}
            sentinelRunning={chats.sentinel?.tools ?? NO_TOOLS}
            onInvestigate={(failed) => {
              setDive(false);
              setChatOpen(true);
              window.turri.call("investigate", failed).catch((error) => say(engineSaid(error), "error"));
            }}
            readPlain={readPlain}
            debug={project.settings.debug === true}
            onShowInSpec={showInSpec}
          />
        </DiveScreen>
      )}
      {switching !== null && (
        <div className="switching" role="status">
          <Spinner /> opening {switching.name}…
        </div>
      )}
      {guide && (
        <GettingStartedSheet
          onSignIn={() => setSignIn({ provider: null })}
          onNew={() => (setGuide(false), setCreating(true))}
          onDoctor={() => (setDoctorModels(false), setDoctorOpen(true))}
          onClose={() => setGuide(false)}
        />
      )}
      {newProject}
      {projectSwitcher}
      {doctorSheet}
      {authSheet}
      {settingsSheet}
      {projectSettingsSheet}
      {aboutSheet}
    </>
  );
}

/** What the engine said went wrong, without Electron's wrapping of it. */
function engineSaid(error: unknown) {
  return String((error as Error).message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
