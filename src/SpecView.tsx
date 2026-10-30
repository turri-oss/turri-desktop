import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { Advisor, FunctionalSpec, Job, Spec, TestPlainFile } from "./types.ts";
import { Icon, PlainMark, PlainName, Spinner, StartedFrom, withPlain } from "./ui.tsx";
import { type Point, pointNow, relocate } from "./PulseSpec.tsx";
import { followAt, PlainLinks, useModHeld, usePlainLinks, type Followed, type OpenLink } from "./PlainLinks.tsx";
import { keys, withMod } from "./platform.ts";

type Token = { text: string; role: string | null };
type State = "conformed" | "built" | "now" | "todo";
/** A line of a functional spec: its func-id, whether it is its heading, and which line that is. */
type SpecLine = { funcId: string; first: boolean; line: number };

/**
 * The lines of each functional spec in the text, by its func-id, as turri's own grammar colours them: its `# <func-id>`
 * heading - the `id` role - and its body below it, up to the next heading or section, its blank lines left unmarked.
 * The colours are a moment behind the text: while they catch up, a line keeps the role it had.
 */
function functionalSpecLines(all: string[], colours: Token[][]): Map<number, SpecLine> {
  const found = new Map<number, SpecLine>();
  let heading: { funcId: string; line: number } | null = null;
  all.forEach((line, index) => {
    const roles = colours[index]?.map((token) => token.role) ?? [];
    if (roles.includes("section")) heading = null;
    else if (roles.includes("id")) {
      heading = { funcId: line.replace(/^#+/, "").trim(), line: index };
      found.set(index, { funcId: heading.funcId, first: true, line: index });
    } else if (heading !== null && line.trim() !== "") found.set(index, { funcId: heading.funcId, first: false, line: heading.line });
  });
  return found;
}

/**
 * How far each functional spec runs, by its heading's line: its last line, and its body's first - the last a collapsed
 * one shows. One with more below that can be collapsed, hiding up to its last line.
 */
function extentOf(specLines: Map<number, SpecLine>) {
  const lastOf = new Map<number, number>();
  const bodyOf = new Map<number, number>();
  for (const [index, mark] of specLines) {
    lastOf.set(mark.line, Math.max(lastOf.get(mark.line) ?? index, index));
    if (!mark.first && !bodyOf.has(mark.line)) bodyOf.set(mark.line, index);
  }
  const foldable = [...lastOf].filter(([first, last]) => last > (bodyOf.get(first) ?? last));
  return { lastOf, bodyOf, foldable };
}

/** Where each line starts in the text, from 0. */
function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

/** The last index in `sorted` at or below `value`. */
function atOrBelow(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (sorted[mid]! <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Whether functional specs open collapsed: they do, unless Expand all was the last choice - kept between launches. */
const COLLAPSED_KEY = "turri-app.specs-collapsed";
function savedCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== "0";
  } catch {
    return true;
  }
}

const STATE_LABEL: Record<State, string> = { conformed: "built and conformance tested", built: "built", now: "building now", todo: "to build" };

/**
 * The functional specs of a module the running work builds now, by func-id: those its pulse covers, as its cases say -
 * added, changed, regenerated again - or the one a conformance run of one functional spec builds.
 */
export function buildingIn(job: Job | undefined, module: string): Set<string> {
  if (job === undefined) return new Set();
  const covered = [...(job.cases?.add ?? []), ...(job.cases?.patch ?? []), ...(job.cases?.again ?? []), ...(job.building?.spec ? [job.building.spec] : [])];
  return new Set(covered.filter((each) => each.module === module).map((each) => each.funcId));
}

/**
 * The lines of this file the running work renders now, from 0: every line of the functional specs it builds, by their
 * func-ids, wherever they are now - and what else its ***plain diff adds here, a definition or a req: its added lines,
 * placed in the files as they were when it started and found where they are now, as the ***plain is edited while it
 * runs. One whose text is not in the file any more is left out.
 */
function renderingLines(job: Job | undefined, spec: Spec, text: string, specLines: Map<number, SpecLine>): Set<number> {
  const found = new Set<number>();
  if (job === undefined) return found;
  const building = buildingIn(job, spec.module);
  for (const [index, mark] of specLines) if (building.has(mark.funcId)) found.add(index);
  const lines = text.split("\n").map((line) => line.trimEnd());
  if (job.diff !== undefined && job.diffWhere !== undefined) {
    const diffLines = job.diff.split("\n");
    const placed: Array<{ line: number; text: string }> = [];
    for (const [index, where] of Object.entries(job.diffWhere)) {
      const line = diffLines[Number(index)];
      if (where.file !== spec.rel || line === undefined) continue;
      // Found by its text as the file has it - a link as a link, where the diff has it as turri reads it - or, from a
      // turri that does not say it, the diff's own.
      const text = where.written ?? line.slice(1).trimEnd();
      if (!line.startsWith("+")) continue;
      placed.push({ line: where.line, text });
    }
    placed.sort((a, b) => a.line - b.line);
    const now = relocate(lines, placed.map((each) => each.line), placed.map((each) => each.text));
    now.forEach((line, at) => lines[line - 1] === placed[at]!.text && found.add(line - 1));
  }
  return found;
}

/**
 * The spec as text, coloured by turri's own ***plain grammar, with each functional spec's state in the gutter beside
 * it: built, being built now, or still to build. The text is said once.
 */
export function SpecView(props: {
  spec: Spec;
  /**
   * A test plain file shown, not a module: a functional spec's scenarios - `spec` its file - with the functional spec
   * they are of, opened in its module by `onShowSpec`. Its # <scenario-id> headings are scenarios, so none is marked.
   */
  tests?: TestPlainFile;
  onShowSpec?: () => void;
  /** Its module opened - at its top. */
  onShowModule?: () => void;
  /** A functional spec's test plain file opened, at a line of it - a scenario's heading - from 1. */
  onOpenTests: (file: string, line: number) => void;
  running?: Job;
  /** The base folder its codebase started from, and how many of its files the code has still. */
  base?: { folder: string; files: number };
  /**
   * Lines to bring into view and light for a moment, from 1: a pulse's part of the spec, shown from the work - with their
   * text, to find them by where the ***plain has changed since the pulse ran, and the point clicked in it, for the caret
   * - or a concept's definition.
   */
  reveal?: { lines: number[]; texts?: string[]; point?: Point; at: number };
  onSaved: (spec: Spec) => void;
  onDirty: (dirty: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<void>) | null>;
  onRegenerate: (funcIds?: string[]) => void;
  onConform: (funcIds?: string[]) => void;
  /** The test advisor asked whether a functional spec with no scenarios needs them - and they written, asked of the chat. */
  onEvaluate: (funcId: string) => void;
  onWriteScenarios: (funcId: string) => void;
  /** A module it imports or requires, or a .plain that requires or imports it: the stdlib view's, or the project's file. */
  onOpen: OpenLink;
  /** A module, concept or linked resource ⌘-clicked in it: to open what it names. */
  onFollow: (followed: Followed, point: { x: number; y: number }) => void;
  say: (text: string, tone?: "info" | "error") => void;
}) {
  const { spec, running } = props;
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<Token[][]>([]);
  const [saving, setSaving] = useState(false);
  // The file as it is on disk now, when it changed there under edits not yet saved: for the person to take or leave.
  const [onDisk, setOnDisk] = useState<string | null>(null);
  // The functional specs collapsed, by their heading's line, each with the last line it hid when it was collapsed: a
  // functional spec's body is free text, so a line typed below one is of it - and stays in sight, not hidden as it is typed.
  const [folded, setFolded] = useState<Map<number, number>>(new Map());
  // Where the caret is to be, in the whole text, once a spec opens or closes under it.
  const caretRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const now = useRef({ text, saved });
  now.current = { text, saved };
  const links = usePlainLinks(spec.file);
  // A test plain file's links: the module its scenarios are of - its front matter's module: - and nothing else.
  const following = props.tests !== undefined ? { imports: [], requires: props.tests.module !== undefined ? [{ name: props.tests.module, file: props.tests.moduleFile }] : [], requiredBy: [], importedBy: [] } : links;
  const linking = useModHeld();

  useEffect(() => {
    void window.turri.call<{ text: string }>("readSpec", { file: spec.file }).then(({ text }) => {
      setText(text);
      setSaved(text);
    });
  }, [spec.file]);

  // Changed on disk - turri edited it from the chat, say: taken at once, unless there are edits it would undo.
  useEffect(
    () =>
      window.turri.on("engine:spec", ({ file, text: disk }: { file: string; text: string }) => {
        if (file !== spec.file || disk === now.current.saved) return;
        if (now.current.text === now.current.saved || now.current.text === disk) {
          setText(disk);
          setSaved(disk);
          setOnDisk(null);
        } else setOnDisk(disk);
      }),
    [spec.file],
  );

  // Coloured as turri's grammar has it, a moment after typing stops.
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => void window.turri.call<Token[][]>("highlightSpec", { text }).then(setLines), 80);
    return () => clearTimeout(timer);
  }, [text]);
  // Its functional specs collapsed as it opens, unless Expand all was the last choice - once its colours say where they
  // are, and only while nothing has been typed: a fold coming then would hide what is being written.
  const foldedOnOpen = useRef(false);
  useEffect(() => {
    if (foldedOnOpen.current || text === null || lines.length === 0) return;
    foldedOnOpen.current = true;
    const all = text.split("\n");
    const current = text === saved && lines.length === all.length && lines.every((tokens, index) => tokens.map((token) => token.text).join("") === all[index]);
    if (current && savedCollapsed()) setFolded(new Map(extentOf(functionalSpecLines(all, lines)).foldable));
  }, [lines]);

  const dirty = text !== null && text !== saved;
  useEffect(() => props.onDirty(dirty), [dirty]);

  const save = async () => {
    if (text === null || !dirty) return;
    setSaving(true);
    try {
      const next = await window.turri.call<Spec>("writeSpec", { file: spec.file, text });
      setSaved(text);
      setOnDisk(null);
      // Not parsing, it is a problem of the project's - the status panel opens on it.
      props.onSaved(next);
    } finally {
      setSaving(false);
    }
  };
  props.saveRef.current = save;

  // A functional spec is known by its func-id, edited or not: one the saved ***plain does not have is new, still to build.
  const entryFor = (funcId: string) => spec.functionalSpecs.find((entry) => entry.funcId === funcId);
  const stateOf = (funcId: string): State => {
    if (renderingFuncIds.has(funcId)) return "now";
    const entry = entryFor(funcId);
    if (entry === undefined) return "todo";
    return entry.conformed ? "conformed" : entry.built ? "built" : "todo";
  };
  // The functional spec the pointer rests on, for a moment: its state, said beside it.
  const [hover, setHover] = useState<{ funcId: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leave = () => {
    clearTimeout(hoverTimer.current);
    setHover(null);
  };
  /**
   * The functional spec under the pointer - its text or its mark - after a pause. The coloured lines take no pointer -
   * the textarea over them has it - so the line is the one whose rows the pointer's height is in.
   */
  const pointAt = (x: number, y: number) => {
    const rows = editorRef.current?.querySelectorAll<HTMLElement>(".editor-colours > div") ?? [];
    const row = [...rows].find((element) => {
      const box = element.getBoundingClientRect();
      return y >= box.top && y < box.bottom && x >= box.left - 60 && x <= box.right;
    });
    const mark = row ? specLines.get(Number(row.dataset.line)) : undefined;
    if (mark === undefined) return leave();
    if (hover?.funcId === mark.funcId) return;
    clearTimeout(hoverTimer.current);
    setHover(null);
    const box = row!.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHover({ funcId: mark.funcId, x, y: box.bottom }), 350);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  /**
   * A functional spec's mark, clicked: its menu, under it - regenerate that functional spec, and only it, or conform it,
   * its conformance tests written, which wait for its code.
   */
  const [markMenu, setMarkMenu] = useState<{ funcId: string; x: number; y: number } | null>(null);
  // What the pointer is on in that menu: the functional spec it would act on lit in the text, in that one's colour.
  const [pointed, setPointed] = useState<"regenerate" | "conform" | null>(null);
  const markerMenu = (funcId: string, mark: HTMLElement) => {
    leave();
    const box = mark.getBoundingClientRect();
    setMarkMenu({ funcId, x: box.left, y: box.bottom + 4 });
  };

  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const conformedCount = spec.functionalSpecs.filter((entry) => entry.conformed).length;
  // What is tested is counted over the functional specs with scenarios, as turri counts it: the others are not tested.
  const testable = spec.functionalSpecs.filter((entry) => scenarioCount(entry) > 0).length;
  const all = text?.split("\n") ?? [];
  const specLines = spec.ok && props.tests === undefined ? functionalSpecLines(all, lines) : new Map<number, SpecLine>();
  const { lastOf, bodyOf, foldable: foldables } = extentOf(specLines);
  const foldable = foldables.map(([first]) => first);
  const hiddenBy = new Map<number, number>();
  // A collapsed functional spec's heading by the line it shows last.
  const peekOf = new Map<number, number>();
  for (const [first, hid] of folded) {
    const peek = bodyOf.get(first);
    const last = Math.min(lastOf.get(first) ?? first, hid);
    if (peek === undefined || last <= peek) continue;
    peekOf.set(peek, first);
    for (let index = peek + 1; index <= last; index++) hiddenBy.set(index, first);
  }
  const shown = all.flatMap((_, index) => (hiddenBy.has(index) ? [] : [index]));
  // The textarea holds what is shown; an edit to it is made to the whole text, by where the shown lines are in it.
  const visible = shown.map((index) => all[index]).join("\n");
  const fullStarts = lineStarts(all);
  const shownStarts = lineStarts(shown.map((index) => all[index]!));
  const toFull = (at: number) => {
    const row = atOrBelow(shownStarts, at);
    return fullStarts[shown[row]!]! + at - shownStarts[row]!;
  };
  const toShown = (at: number) => {
    const line = atOrBelow(fullStarts, at);
    const first = hiddenBy.get(line);
    if (first !== undefined) return shownStarts[shown.indexOf(bodyOf.get(first)!)]! + all[bodyOf.get(first)!]!.length;
    return shownStarts[shown.indexOf(line)]! + at - fullStarts[line]!;
  };
  const lineAt = (at: number) => atOrBelow(fullStarts, at);
  /** The collapsed functional spec a shown line is of - its heading or its body's first line - by its heading's line. */
  const collapsedAt = (line: number): number | undefined => ([...peekOf.values()].includes(line) ? line : peekOf.get(line));
  const allFolded = foldable.length > 0 && foldable.every((first) => folded.has(first));

  const toggle = (first: number) => {
    const area = areaRef.current;
    if (area !== null && document.activeElement === area) caretRef.current = toFull(area.selectionStart);
    setFolded((now) => {
      const next = new Map(now);
      if (next.has(first)) next.delete(first);
      else next.set(first, lastOf.get(first) ?? first);
      return next;
    });
  };
  const foldAll = (fold: boolean) => {
    setFolded(new Map(fold ? foldables : []));
    try {
      localStorage.setItem(COLLAPSED_KEY, fold ? "1" : "0");
    } catch {
      /* not kept: specs open collapsed next time */
    }
  };
  // The caret kept in place as a spec opens or closes: the textarea's text changed under it.
  useLayoutEffect(() => {
    if (caretRef.current === null || areaRef.current === null) return;
    const at = toShown(caretRef.current);
    caretRef.current = null;
    areaRef.current.setSelectionRange(at, at);
  });

  /** The textarea's text, edited: the change, found between what was shown and what is, made to the whole text. */
  const edit = (next: string) => {
    if (text === null) return;
    let prefix = 0;
    while (prefix < visible.length && prefix < next.length && visible[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (suffix < visible.length - prefix && suffix < next.length - prefix && visible[visible.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
    const from = toFull(prefix);
    const to = toFull(visible.length - suffix);
    const inserted = next.slice(prefix, next.length - suffix);
    // An edit that would take hidden lines with it, or break a line a collapsed functional spec shows, opens it instead
    // of being made: the person sees what they would change.
    const reached = new Set([...hiddenBy].filter(([index]) => fullStarts[index]! > from && fullStarts[index]! < to).map(([, first]) => first));
    const line = lineAt(from);
    const over = collapsedAt(line);
    if (over !== undefined && (inserted.includes("\n") || text.slice(from, to).includes("\n"))) reached.add(over);
    if (reached.size > 0) {
      caretRef.current = from;
      setFolded((now) => new Map([...now].filter(([first]) => !reached.has(first))));
      return;
    }
    const newlines = (part: string) => part.split("\n").length - 1;
    const moved = newlines(inserted) - newlines(text.slice(from, to));
    // The collapsed functional specs below the edit move down or up with it.
    if (moved !== 0) setFolded((now) => new Map([...now].map(([first, hid]) => (first > line ? [first + moved, hid + moved] : [first, hid]))));
    setText(text.slice(0, from) + inserted + text.slice(to));
  };
  const rendering = text !== null ? renderingLines(running, spec, text, specLines) : new Set<number>();
  const firstRendering = rendering.size > 0 ? Math.min(...rendering) : undefined;
  // A functional spec any of whose lines the running work renders is being built now.
  const renderingFuncIds = new Set([...buildingIn(running, spec.module), ...[...rendering].flatMap((index) => specLines.get(index)?.funcId ?? [])]);

  const showLine = (index: number) => {
    const line = editorRef.current?.querySelector<HTMLElement>(`.editor-colours > div[data-line="${hiddenBy.get(index) ?? index}"]`);
    if (line && editorRef.current) editorRef.current.scrollTo({ top: Math.max(0, line.offsetTop - editorRef.current.clientHeight / 3), behavior: "smooth" });
  };
  // What a pulse renders is brought into view as it starts - unless the person is typing in the spec.
  useEffect(() => {
    if (firstRendering !== undefined && document.activeElement !== areaRef.current) showLine(firstRendering);
  }, [running?.id, firstRendering]);
  /** The caret at the start of line `index`, from 0, the editor focused there - the functional spec folded over it opened. */
  const putCaret = (index: number) => {
    const first = hiddenBy.get(index);
    if (first !== undefined)
      setFolded((now) => {
        const next = new Map(now);
        next.delete(first);
        return next;
      });
    caretRef.current = fullStarts[index] ?? 0;
    areaRef.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const line = editorRef.current?.querySelector<HTMLElement>(`.editor-colours > div[data-line="${index}"]`);
      if (line && editorRef.current) editorRef.current.scrollTo({ top: Math.max(0, line.offsetTop - editorRef.current.clientHeight / 3), behavior: "smooth" });
    });
  };
  // A pulse's part, shown from the work: in view once the text is here, and lit for a few seconds - and, clicked at a
  // point, the caret there, where that point is now.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (props.reveal === undefined || text === null || props.reveal.lines.length === 0) return;
    const all = text.split("\n");
    const { lines: then, texts, point } = props.reveal;
    const numbers = texts !== undefined ? relocate(all, then, texts) : then;
    const lines = new Set(numbers.map((line) => line - 1));
    setRevealed(lines);
    // Shown whole: a collapsed functional spec any of them is hidden in is opened.
    const opened = new Set([...lines].flatMap((line) => hiddenBy.get(line) ?? []));
    if (opened.size > 0) setFolded((now) => new Map([...now].filter(([first]) => !opened.has(first))));
    if (point !== undefined && texts !== undefined) putCaret(pointNow(all, then, texts, point) - 1);
    else requestAnimationFrame(() => showLine(Math.min(...lines)));
    const timer = setTimeout(() => setRevealed(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [props.reveal?.at, text === null]);

  const hovered = hover !== null ? { ...hover, state: stateOf(hover.funcId), entry: entryFor(hover.funcId) } : null;

  return (
    // What runs now, in its kind's colour - regenerating pink, conformance testing cyan - wherever the view shows it.
    <div className="spec-view" data-working={running?.kind === "conformance" ? "conformance" : "regenerate"}>
      {markMenu && (
        <MarkMenu
          {...markMenu}
          entry={entryFor(markMenu.funcId)}
          onRegenerate={() => props.onRegenerate([markMenu.funcId])}
          onConform={() => props.onConform([markMenu.funcId])}
          onOpenTests={(file, line) => props.onOpenTests(file, line)}
          onEvaluate={() => props.onEvaluate(markMenu.funcId)}
          onWriteScenarios={() => props.onWriteScenarios(markMenu.funcId)}
          onPoint={setPointed}
          onClose={() => {
            setMarkMenu(null);
            setPointed(null);
          }}
        />
      )}
      {hovered && <SpecStatePop {...hovered} running={running} isNew={dirty && hovered.entry === undefined} />}
      <div className="editor-pane">
        <div className="pane-header">
          <span className="pane-title" title={spec.file}>
            <PlainMark /> {spec.rel}
          </span>
          <span className="pane-header-right">
            {props.tests?.funcId !== undefined && (
              <span className="tests-of">
                <Icon name="test" size={12} /> the scenarios of{" "}
                <button className="link" onClick={props.onShowModule} title="open the module">
                  {props.tests.module}
                </button>
                :
                <button className="link" onClick={props.onShowSpec} title="open the functional spec in its module">
                  {props.tests.funcId}
                </button>{" "}
                <span className="muted">·</span>
              </span>
            )}
            {/* The base folder its codebase started from, once it has: what it builds on. */}
            {props.base && (
              <>
                <StartedFrom base={props.base} /> <span className="muted">·</span>
              </>
            )}
            {spec.ok && total > 0 && (
              <span className="built-count" title="functional specs whose code is regenerated from the ***plain">
                <Icon name="check" size={12} /> {built} of {total} regenerated <span className="muted">·</span>
              </span>
            )}
            {spec.ok && testable > 0 && (
              <span className="conformed-count" title="of the functional specs with scenarios, those built with their conformance tests written and passing">
                <Icon name="checks" size={12} /> {conformedCount} of {testable} conformed ·
              </span>
            )}
            {foldable.length > 0 && (
              <>
                <button className="link fold-all" onClick={() => foldAll(!allFolded)} title={allFolded ? "show every functional spec whole" : "show only each functional spec's heading and first line"}>
                  {allFolded ? "expand all" : "collapse all"}
                </button>
                <span className="muted">·</span>
              </>
            )}
            {dirty ? (
              <button className="button small" onClick={() => void save()} disabled={saving}>
                {saving ? <Spinner /> : null} save <kbd>{keys("S")}</kbd>
              </button>
            ) : (
              <span className="muted">saved</span>
            )}
          </span>
        </div>
        {spec.ok && total > 0 && (
          <div className="progress">
            <div style={{ width: `${(built / total) * 100}%` }} />
          </div>
        )}
        <PlainLinks links={links} onOpen={props.onOpen} />
        {onDisk !== null && (
          <div className="disk-banner">
            <Icon name="warn" />
            <span>{spec.rel} changed on disk while you were editing it.</span>
            <button
              className="button small"
              onClick={() => {
                setText(onDisk);
                setSaved(onDisk);
                setOnDisk(null);
              }}
            >
              load the new version
            </button>
          </div>
        )}
        {text === null ? (
          <div className="center">
            <Spinner />
          </div>
        ) : (
          // One scrolling box holds both layers, so they are always the same width and wrap alike: the coloured text
          // in the flow, giving the height, and the textarea laid exactly over it. A line is drawn as typed at once,
          // and coloured once its colours, a moment behind, are for the same text. The gutter, left of both, is drawn
          // by the coloured lines, so each functional spec's mark stays beside its lines however they wrap.
          <div
            className={`editor ${linking ? "linking" : ""}`}
            ref={editorRef}
            onMouseMove={(event) => pointAt(event.clientX, event.clientY)}
            onMouseLeave={leave}
            onScroll={leave}
            onKeyDown={leave}
          >
            <div className="editor-sheet">
            <pre className="editor-colours" aria-hidden>
              {shown.map((index) => {
                const line = all[index]!;
                const tokens = lines[index];
                const coloured = tokens !== undefined && tokens.map((token) => token.text).join("") === line;
                const mark = specLines.get(index);
                const state = mark && stateOf(mark.funcId);
                const canFold = mark?.first === true && foldable.includes(index);
                const isFolded = canFold && folded.has(index);
                // The line a collapsed functional spec's hidden lines are under, and how many they are.
                const peeked = peekOf.get(index);
                const hidden = peeked !== undefined ? lastOf.get(peeked)! - index : 0;
                // A collapsed spec is lit while the work renders any of its lines.
                // The work's lines in its colour; the lines a click opened on in the highlighter's - each on a folded
                // functional spec's line when it hides them.
                const lit = rendering.has(index) || (isFolded && [...rendering].some((at) => hiddenBy.get(at) === index));
                const shown = revealed.has(index) || (isFolded && [...revealed].some((at) => hiddenBy.get(at) === index));
                const aimed = pointed !== null && mark !== undefined && mark.funcId === markMenu?.funcId ? `pointed ${pointed}` : "";
                return (
                  <div key={index} data-line={index} className={[lit ? "rendering" : "", shown ? "revealed" : "", isFolded ? "folded" : "", aimed].join(" ").trim() || undefined}>
                    {mark && state && (
                      <span className={`gutter ${state}`}>
                        {canFold && (
                          <button
                            className={`fold ${isFolded ? "" : "open"}`}
                            title={isFolded ? `show all of functional spec ${mark.funcId}` : `show only the heading and first line of functional spec ${mark.funcId}`}
                            aria-label={isFolded ? `expand functional spec ${mark.funcId}` : `collapse functional spec ${mark.funcId}`}
                            aria-expanded={!isFolded}
                            onClick={() => toggle(index)}
                          >
                            <Icon name="chevron" size={12} />
                          </button>
                        )}
                        {mark.first && (
                          <button
                            className="mark"
                            aria-label={`functional spec ${mark.funcId}, ${STATE_LABEL[state]}`}
                            onClick={(event) => markerMenu(mark.funcId, event.currentTarget)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              markerMenu(mark.funcId, event.currentTarget);
                            }}
                          >
                            {state === "now" ? <Spinner /> : state === "conformed" ? <Icon name="checks" size={12} /> : state === "built" ? <Icon name="check" size={12} /> : null}
                          </button>
                        )}
                      </span>
                    )}
                    {line === "" ? "\u200b" : coloured ? tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text)) : line}
                    {mark?.first && <ScenarioChip entry={entryFor(mark.funcId)} onOpen={props.onOpenTests} />}
                    {peeked !== undefined && mark && (
                      // Out of the flow, so it never changes where the line wraps: the two layers stay alike.
                      <button className="fold-more" onClick={() => toggle(peeked)} title={`show all of functional spec ${mark.funcId}`}>
                        +{hidden} line{hidden === 1 ? "" : "s"}
                      </button>
                    )}
                  </div>
                );
              })}
            </pre>
            <textarea
              ref={areaRef}
              spellCheck={false}
              value={visible}
              onChange={(event) => edit(event.target.value)}
              // A click on a line a collapsed functional spec shows opens it, the caret where it was clicked; ⌘-click on a
              // module it imports or requires opens that.
              onMouseUp={(event) => {
                const area = event.currentTarget;
                if (area.selectionStart !== area.selectionEnd) return;
                const at = toFull(area.selectionStart);
                const line = lineAt(at);
                const followed = withMod(event) ? followAt(following, lines[line], at - fullStarts[line]!, line + 1) : null;
                if (followed !== null) return props.onFollow(followed, { x: event.clientX, y: event.clientY });
                const over = collapsedAt(lineAt(at));
                if (over !== undefined) {
                  caretRef.current = at;
                  toggle(over);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "s" && withMod(event)) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  const area = event.currentTarget;
                  const { selectionStart, selectionEnd } = area;
                  edit(area.value.slice(0, selectionStart) + "  " + area.value.slice(selectionEnd));
                  requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2));
                }
              }}
            />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A functional spec's state, beside it as the pointer rests on it: what is being done with it now - regenerated, or its
 * conformance tests written and run, and at what stage - or what has been done: regenerated, conformance tested, or
 * neither yet.
 */
/**
 * What a functional spec's mark offers: regenerate it, or conform it once it is built and has scenarios - that
 * functional spec alone - and open its scenarios, when it has a test plain file. Regenerate and conform are lit as they
 * are pointed at, or reached with the arrow keys, in their kind's colour - and the functional spec with them. Escape, a
 * click elsewhere or the window left closes it.
 */
function MarkMenu(props: {
  x: number;
  y: number;
  entry: FunctionalSpec | undefined;
  onRegenerate: () => void;
  onConform: () => void;
  onOpenTests: (file: string, line: number) => void;
  onEvaluate: () => void;
  onWriteScenarios: () => void;
  onPoint: (item: "regenerate" | "conform" | null) => void;
  onClose: () => void;
}) {
  const built = props.entry?.built === true;
  const tested = scenarioCount(props.entry) > 0;
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", onClose);
    };
  }, []);
  // Up and down go along what can be chosen, round from the ends.
  const move = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    next?.focus();
    if (next) props.onPoint(next.classList.contains("conform") ? "conform" : next.classList.contains("regenerate") ? "regenerate" : null);
  };
  const aim = (item: "regenerate" | "conform") => ({
    onMouseEnter: () => props.onPoint(item),
    onMouseLeave: () => props.onPoint(null),
  });
  const choose = (then: () => void) => () => {
    onClose();
    then();
  };
  return (
    <div ref={ref} className="mark-menu" role="menu" style={{ left: props.x, top: props.y }} onKeyDown={move}>
      <button role="menuitem" className="regenerate" onClick={choose(props.onRegenerate)} {...aim("regenerate")}>
        regenerate
      </button>
      <button role="menuitem" className="conform" disabled={!built || !tested} onClick={choose(props.onConform)} {...aim("conform")}>
        conform{!tested ? <span className="muted"> - it has no scenarios</span> : !built && <span className="muted"> - once it is built</span>}
      </button>
      {props.entry?.testPlainFile && (
        <button role="menuitem" className="open-tests" onClick={choose(() => props.onOpenTests(props.entry!.testPlainFile!, firstScenarioLine(props.entry!)))}>
          open its scenarios
        </button>
      )}
      {props.entry !== undefined && !tested && (
        <>
          <button role="menuitem" className="evaluate" disabled={props.entry.advisor?.state === "pending"} onClick={choose(props.onEvaluate)}>
            evaluate testing scenarios{props.entry.advisor?.state === "pending" && <span className="muted"> - being evaluated</span>}
          </button>
          <button role="menuitem" className="write-scenarios" onClick={choose(props.onWriteScenarios)}>
            write testing scenarios
          </button>
        </>
      )}
    </div>
  );
}

/** How many scenarios a functional spec has, of both kinds: none, and it is not tested. */
const scenarioCount = (entry: FunctionalSpec | undefined) => (entry === undefined ? 0 : entry.scenarios.conformance.length + entry.scenarios.acceptance.length);

/** Where a functional spec's test plain file opens: at its first scenario's heading, or its top. */
function firstScenarioLine(entry: FunctionalSpec): number {
  const lines = [...entry.scenarios.conformance, ...entry.scenarios.acceptance].map((scenario) => scenario.line);
  return lines.length > 0 ? Math.min(...lines) : 1;
}

/**
 * A functional spec's scenarios, at the end of its heading's line - out of the flow, so the two layers wrap alike: how
 * many of each kind, conformance and acceptance, and a click opens its test plain file there. One with none is not
 * tested, and that is no fault of it: nothing - but while the test advisor evaluates whether it needs testing
 * scenarios, and when it found it does, until the chat has written them.
 */
function ScenarioChip({ entry, onOpen }: { entry: FunctionalSpec | undefined; onOpen: (file: string, line: number) => void }) {
  if (entry === undefined) return null;
  if (entry.testPlainFile === null || scenarioCount(entry) === 0) {
    if (entry.advisor?.state === "pending")
      return (
        <span className="advisor-chip pending">
          <Spinner /> evaluating testing scenarios
        </span>
      );
    if (entry.advisor?.state === "yes")
      return (
        <span className="advisor-chip yes">
          <Icon name="test" size={11} /> needs testing scenarios
        </span>
      );
    return null;
  }
  const { conformance, acceptance } = entry.scenarios;
  const count = (n: number, kind: string) => `${n} ${kind} scenario${n === 1 ? "" : "s"}`;
  const said = `${count(conformance.length, "conformance")}, ${count(acceptance.length, "acceptance")} - open its test plain file`;
  return (
    <button className="scenario-chip" title={said} aria-label={`${entry.funcId}: ${said}`} onClick={() => onOpen(entry.testPlainFile!, firstScenarioLine(entry))}>
      <Icon name="test" size={11} /> {conformance.length} · {acceptance.length}
    </button>
  );
}

/** The test advisor's four questions, as a yes to each reads. */
const QUESTION_SAID: Record<NonNullable<Advisor["report"]>["questions"][number]["question"], string> = {
  "silent-failure": "a wrong implementation could look right",
  divergence: "it can be read two ways",
  revisited: "it is likely to be changed or built on",
  cost: "a bug in it would cost much",
};

/**
 * What the test advisor made of a functional spec with no scenarios, in its card: evaluating it, or its verdict - on a
 * yes, the questions that were a yes with their evidence, and how many inputs the scenarios are to cover.
 */
function AdvisorSaid({ advisor }: { advisor: Advisor }) {
  const inputs = advisor.report?.inputs.length ?? 0;
  return (
    <div className={`spec-pop-advisor ${advisor.state}`}>
      {advisor.state === "pending" ? (
        <span>testing scenarios being evaluated, in the background.</span>
      ) : advisor.state === "yes" ? (
        <>
          <span>
            needs testing scenarios{inputs > 0 ? `, covering ${inputs} input${inputs === 1 ? "" : "s"}` : ""} -{" "}
            {advisor.undelivered ? "the chat writes them at turri's next start." : "the chat writes them."}
          </span>
          <ul>
            {advisor.report?.questions.map((answer) => (
              <li key={answer.question}>
                {QUESTION_SAID[answer.question]} <span className="muted">- {answer.evidence}</span>
              </li>
            ))}
          </ul>
        </>
      ) : advisor.state === "no" ? (
        <span>doesn't need testing scenarios.</span>
      ) : (
        <span>
          its testing scenarios could not be evaluated{advisor.reason ? <span className="muted"> - {advisor.reason}</span> : null}.
        </span>
      )}
    </div>
  );
}

function SpecStatePop(props: { funcId: string; x: number; y: number; state: State; running?: Job; isNew: boolean; entry?: FunctionalSpec }) {
  const { state, running, entry } = props;
  const tested = scenarioCount(entry) > 0;
  // Built now: no more than what is being done - conforming or regenerating - by the loader.
  const working = state === "now";
  const [title, detail] = props.isNew
    ? ["new - not saved yet", "save the ***plain, then regenerate builds it."]
    : working
      ? [running?.kind === "conformance" ? "conforming" : "regenerating", null]
      : state === "conformed"
        ? ["regenerated and conformed", "its code is built from the ***plain as it is, and its conformance tests pass."]
        : state === "built"
          ? ["regenerated", tested ? "its code is built from the ***plain as it is. its conformance tests do not pass yet." : "its code is built from the ***plain as it is."]
          : ["not regenerated yet", "regenerate builds it - or click its mark to build it alone."];
  // Kept inside the window: below the line, or above it near the bottom.
  const left = Math.min(props.x + 12, window.innerWidth - 340);
  const below = props.y + 120 < window.innerHeight;
  return (
    <div className={`spec-pop ${state}`} style={{ left, ...(below ? { top: props.y + 6 } : { bottom: window.innerHeight - props.y + 30 }) }} role="tooltip">
      <div className="spec-pop-head">
        <span className={`spec-pop-mark ${props.isNew ? "todo" : state}`}>{working ? <Spinner /> : state === "conformed" ? <Icon name="checks" size={12} /> : state === "built" ? <Icon name="check" size={12} /> : null}</span>
        <strong>{title}</strong>
      </div>
      {detail !== null && <div className="spec-pop-detail">{withPlain(detail)}</div>}
      {!props.isNew && !tested && entry?.advisor && <AdvisorSaid advisor={entry.advisor} />}
      {!props.isNew && (
        <div className="spec-pop-scenarios">
          {!tested ? (
            <span className="muted">no scenarios - not tested</span>
          ) : (
            (["conformance", "acceptance"] as const).map(
              (kind) =>
                entry!.scenarios[kind].length > 0 && (
                  <div key={kind}>
                    <span className="muted">{kind}</span>
                    <ul>
                      {entry!.scenarios[kind].map((scenario) => (
                        <li key={scenario.id}>
                          <span className="plain-id">{scenario.id}</span> <span className="muted">{scenario.text.split("\n")[0]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )
          )}
        </div>
      )}
    </div>
  );
}
