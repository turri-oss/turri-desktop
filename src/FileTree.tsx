import { useCallback, useEffect, useRef, useState } from "react";
import type { Spec, TestPlainFile } from "./types.ts";
import { Icon, PlainMark, Spinner } from "./ui.tsx";
import { REVEAL } from "./platform.ts";

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
}

const OPEN_KEY = "turri-app.tree-open";

function savedOpen(dir: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${OPEN_KEY}:${dir}`) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function parentOf(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}

/**
 * The project's ***plain, as a tree: the specs with their state beside them, the templates they import and the resources
 * they link - nothing else of the project, the engine lists only these - each folder listed when it is opened, and again
 * when what is in it changes. Which folders are open is kept between launches, project by project.
 */
export function FileTree(props: { root: string; specs: Spec[]; testPlainFiles: TestPlainFile[]; selected: string | null; isRunning: (module: string) => boolean; onSelect: (path: string) => void }) {
  const { root } = props;
  const [listed, setListed] = useState<Map<string, FileEntry[]>>(new Map());
  const [open, setOpen] = useState<Set<string>>(() => savedOpen(root));
  const listedRef = useRef(listed);
  listedRef.current = listed;

  const list = useCallback(async (dir: string) => {
    const entries = await window.turri.call<FileEntry[] | null>("listFiles", { dir }).catch(() => null);
    if (entries) setListed((all) => new Map(all).set(dir, entries));
    else {
      // Gone: a folder deleted while open, or left open in a project since reset, is simply not listed.
      setListed((all) => {
        const next = new Map(all);
        next.delete(dir);
        return next;
      });
    }
  }, []);

  // The project and the folders left open last time.
  useEffect(() => {
    setListed(new Map());
    const opened = savedOpen(root);
    setOpen(opened);
    void list(root);
    for (const dir of opened) void list(dir);
  }, [root, list]);

  useEffect(() => {
    try {
      localStorage.setItem(`${OPEN_KEY}:${root}`, JSON.stringify([...open]));
    } catch {
      /* not kept: the folders start closed next time */
    }
  }, [root, open]);

  // Something changed on disk: the folders it changed in, that are listed, are listed again - every one, when a .plain
  // changed, as what it imports and links may be anywhere.
  useEffect(
    () =>
      window.turri.on("engine:files", ({ paths }: { paths: string[] }) => {
        const plain = paths.some((path) => path.endsWith(".plain"));
        const dirs = new Set(plain ? listedRef.current.keys() : paths.flatMap((path) => [parentOf(path), path]).filter((dir) => listedRef.current.has(dir)));
        for (const dir of dirs) void list(dir);
      }),
    [list],
  );

  const toggle = (dir: string) => {
    const next = new Set(open);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      if (!listed.has(dir)) void list(dir);
    }
    setOpen(next);
  };

  const menu = async (entry: FileEntry) => {
    const chosen = await window.turri.popup([
      ...(entry.dir ? [] : [{ id: "open", label: "open with default app" }]),
      { id: "reveal", label: REVEAL },
      { type: "separator" as const },
      { id: "copy", label: "copy path" },
      { id: "copy-rel", label: "copy relative path" },
    ]);
    if (chosen === "open") void window.turri.openPath(entry.path);
    else if (chosen === "reveal") void window.turri.reveal(entry.path);
    else if (chosen === "copy") void navigator.clipboard.writeText(entry.path);
    else if (chosen === "copy-rel") void navigator.clipboard.writeText(entry.path.slice(root.length + 1));
  };

  const rows = (dir: string, depth: number): React.ReactNode => {
    const entries = listed.get(dir);
    if (entries === undefined) return null;
    if (entries.length === 0) return <div className="tree-empty" style={{ "--depth": depth } as React.CSSProperties}>empty</div>;
    return entries.map((entry) => {
      const spec = entry.dir ? undefined : props.specs.find((candidate) => candidate.file === entry.path);
      const tests = entry.dir ? undefined : props.testPlainFiles.find((candidate) => candidate.file === entry.path);
      const isOpen = entry.dir && open.has(entry.path);
      return (
        <div key={entry.path} role="treeitem" aria-expanded={entry.dir ? isOpen : undefined} aria-selected={entry.path === props.selected}>
          <button
            className={`tree-row ${entry.path === props.selected ? "active" : ""}`}
            style={{ "--depth": depth } as React.CSSProperties}
            title={entry.path.slice(root.length + 1)}
            onClick={() => (entry.dir ? toggle(entry.path) : props.onSelect(entry.path))}
            onContextMenu={(event) => {
              event.preventDefault();
              void menu(entry);
            }}
          >
            {entry.dir ? <span className={`chevron ${isOpen ? "open" : ""}`}><Icon name="chevron" size={12} /></span> : <span className="chevron" />}
            {!entry.dir && entry.name.endsWith(".plain") ? <PlainMark size={14} /> : <Icon name={entry.dir ? "folder" : "file"} size={14} />}
            <span className="tree-name">{entry.name}</span>
            {/* Its state at the right, with how much of it is built: the icon's place is ***plain's mark. */}
            {spec && <SpecState spec={spec} running={props.isRunning(spec.module)} />}
            {spec && <span className="spec-row-count">{spec.ok ? `${spec.functionalSpecs.filter((entry) => entry.built).length}/${spec.functionalSpecs.length}` : "!"}</span>}
            {tests && <TestsState tests={tests} />}
          </button>
          {isOpen && <div role="group">{rows(entry.path, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <nav className="tree" role="tree">
      {listed.has(root) ? rows(root, 0) : <Spinner />}
    </nav>
  );
}

/** A spec's state: up to date and conformance tested, up to date, still to regenerate, not built, being regenerated, or not parsing. */
/**
 * A test plain file's mark, where a module has its state: in the colour of what is conformance tested, the functional
 * spec it holds the scenarios of and how many - or, one turri does not read, what is wrong with it.
 */
function TestsState({ tests }: { tests: TestPlainFile }) {
  if (tests.error !== undefined)
    return (
      <span className="tree-state" title={tests.error}>
        <span className="state-dot error" />
      </span>
    );
  const count = (n: number, kind: string) => `${n} ${kind} scenario${n === 1 ? "" : "s"}`;
  return (
    <span className="tree-state tests" title={`the scenarios of ${tests.module}:${tests.funcId} - ${count(tests.conformance.length, "conformance")}, ${count(tests.acceptance.length, "acceptance")}`}>
      <Icon name="test" size={12} />
    </span>
  );
}

function SpecState({ spec, running }: { spec: Spec; running: boolean }) {
  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const done = total > 0 && built === total && !spec.drifted;
  // Conformance tested as far as it goes: every functional spec with scenarios - one with none is not tested, no fault.
  const testable = spec.functionalSpecs.filter((entry) => entry.scenarios.conformance.length + entry.scenarios.acceptance.length > 0);
  const conformed = done && testable.length > 0 && testable.every((entry) => entry.conformed);
  const state = !spec.ok ? "error" : running ? "running" : conformed ? "conformed" : done ? "done" : built > 0 ? "partial" : "new";
  const label = { error: "does not parse", running: "regenerating", conformed: "up to date and conformance tested", done: "up to date", partial: "to regenerate", new: "not built" }[state];
  return (
    <span className="tree-state" title={label}>
      <span className={`state-dot ${state}`}>{state === "running" ? <Spinner /> : null}</span>
    </span>
  );
}
