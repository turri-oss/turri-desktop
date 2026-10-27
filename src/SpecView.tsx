import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { Job, Spec } from "./types.ts";
import { Icon, PlainMark, PlainName, Spinner, withPlain } from "./ui.tsx";
import { type Point, pointNow, relocate } from "./PulseSpec.tsx";
import { followAt, PlainLinks, useModHeld, usePlainLinks, type Followed, type OpenLink } from "./PlainLinks.tsx";
import { keys, withMod } from "./platform.ts";

type Token = { text: string; role: string | null };
type State = "conformed" | "built" | "now" | "todo";
/** A line of a functional spec: its id, whether it is the spec's first, and which line that is. */
type SpecLine = { frid: string; first: boolean; line: number };

/**
 * The lines of each functional spec in the text, by its id: turri numbers them 1 to n, one for each top-level bullet
 * under ***functional specs***, and a spec runs on over the indented lines below its bullet.
 */
function functionalSpecLines(text: string): Map<number, SpecLine> {
  const found = new Map<number, SpecLine>();
  let inSection = false;
  let count = 0;
  let current: string | null = null;
  let start = 0;
  text.split("\n").forEach((line, index) => {
    const heading = /^\*\*\*(.+)\*\*\*\s*$/.exec(line);
    if (heading) {
      inSection = heading[1]!.trim().toLowerCase() === "functional specs";
      current = null;
    } else if (!inSection || line.trim() === "") {
      return;
    } else if (/^-(\s|$)/.test(line)) {
      current = String(++count);
      start = index;
      found.set(index, { frid: current, first: true, line: index });
    } else if (current !== null && /^\s/.test(line)) {
      found.set(index, { frid: current, first: false, line: start });
    } else {
      current = null;
    }
  });
  return found;
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
 * The lines of this file the running work renders now, from 0: a code pulse's are what its spec change adds here - its
 * diff's added lines, placed in the files as they were when it started - and the functional specs it carries unchanged,
 * as context: a functional spec regenerated again is in its diff so, its text the same. They are found where they are
 * now, as the ***plain is edited while it runs - a functional spec added above them moves them - and one whose text is
 * not in the file any more is left out. A conformance run's are the functional spec it builds: the one with its text,
 * or else its number.
 */
function renderingLines(job: Job | undefined, spec: Spec, text: string, specLines: Map<number, SpecLine>): Set<number> {
  const found = new Set<number>();
  if (job === undefined) return found;
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
      // Carried unchanged: a line of a functional spec, as context - by its text, as the file may have moved since.
      const again = line.startsWith(" ") && [...specLines.keys()].some((at) => lines[at] === text);
      if (!line.startsWith("+") && !again) continue;
      placed.push({ line: where.line, text });
    }
    placed.sort((a, b) => a.line - b.line);
    const now = relocate(lines, placed.map((each) => each.line), placed.map((each) => each.text));
    now.forEach((line, at) => lines[line - 1] === placed[at]!.text && found.add(line - 1));
  }
  const building = /^(\S+) functionality (\d+) of/.exec(job.building?.label ?? "");
  if (building && building[1] === spec.module) {
    // By its text where the ***plain has it, as a functional spec added before it numbers it anew; else by its number.
    const first = job.building?.text?.split("\n")[0]?.trimEnd();
    const frid = [...specLines].find(([index, mark]) => mark.first && first !== undefined && first !== "" && lines[index] === first)?.[1].frid ?? building[2];
    for (const [index, mark] of specLines) if (mark.frid === frid) found.add(index);
  }
  return found;
}

/**
 * The spec as text, coloured by turri's own ***plain grammar, with each functional spec's state in the gutter beside
 * it: built, being built now, or still to build. The text is said once.
 */
export function SpecView(props: {
  spec: Spec;
  running?: Job;
  /**
   * Lines to bring into view and light for a moment, from 1: a pulse's part of the spec, shown from the work - with their
   * text, to find them by where the ***plain has changed since the pulse ran, and the point clicked in it, for the caret
   * - or a concept's definition.
   */
  reveal?: { lines: number[]; texts?: string[]; point?: Point; at: number };
  onSaved: (spec: Spec) => void;
  onDirty: (dirty: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<void>) | null>;
  onRegenerate: (frids?: string[]) => void;
  onConform: (frids?: string[]) => void;
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
  // The functional specs collapsed to their first line, by the line that is: the lines under it are not shown.
  const [folded, setFolded] = useState<Set<number>>(new Set());
  // Where the caret is to be, in the whole text, once a spec opens or closes under it.
  const caretRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const now = useRef({ text, saved });
  now.current = { text, saved };
  const links = usePlainLinks(spec.file);
  const linking = useModHeld();

  useEffect(() => {
    void window.turri.call<{ text: string }>("readSpec", { file: spec.file }).then(({ text }) => {
      setText(text);
      setSaved(text);
      if (savedCollapsed()) setFolded(new Set([...functionalSpecLines(text).values()].filter((mark) => mark.first).map((mark) => mark.line)));
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

  const dirty = text !== null && text !== saved;
  useEffect(() => props.onDirty(dirty), [dirty]);

  const save = async () => {
    if (text === null || !dirty) return;
    setSaving(true);
    try {
      const next = await window.turri.call<Spec>("writeSpec", { file: spec.file, text });
      setSaved(text);
      setOnDisk(null);
      props.onSaved(next);
      if (!next.ok) props.say(`saved, but the ***plain does not parse: ${next.error}`, "error");
    } finally {
      setSaving(false);
    }
  };
  props.saveRef.current = save;

  // The functional spec a conformance run builds now, as "<module> functionality <n>".
  const building = running?.building?.label.replace(/ of \d+$/, "");
  // Saved, a functional spec's state is its number's. Edited since, numbers shift as specs are added or moved: a spec is
  // known by its text then, and one whose text is new is still to build.
  const entryFor = (frid: string, line: string) =>
    dirty ? spec.functionalSpecs.find((entry) => entry.text.split("\n")[0]!.trim() === line.replace(/^-\s*/, "").trim()) : spec.functionalSpecs.find((entry) => entry.frid === frid);
  const stateOf = (frid: string, line: string): State => {
    if (renderingFrids.has(frid)) return "now";
    const entry = entryFor(frid, line);
    if (entry === undefined) return "todo";
    if (building !== undefined && building === `${spec.module} functionality ${entry.frid}`) return "now";
    return entry.conformed ? "conformed" : entry.built ? "built" : "todo";
  };
  // The functional spec the pointer rests on, for a moment: its state, said beside it.
  const [hover, setHover] = useState<{ frid: string; line: string; x: number; y: number } | null>(null);
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
    if (hover?.frid === mark.frid) return;
    clearTimeout(hoverTimer.current);
    setHover(null);
    const box = row!.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHover({ frid: mark.frid, line: all[mark.line] ?? "", x, y: box.bottom }), 350);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  /**
   * A functional spec's mark, clicked: its menu, under it - regenerate that functional spec, and only it, or validate it,
   * its conformance tests written, which wait for its code.
   */
  const [markMenu, setMarkMenu] = useState<{ frid: string; x: number; y: number } | null>(null);
  // What the pointer is on in that menu: the functional spec it would act on lit in the text, in that one's colour.
  const [pointed, setPointed] = useState<"regenerate" | "validate" | null>(null);
  const markerMenu = (frid: string, mark: HTMLElement) => {
    leave();
    const box = mark.getBoundingClientRect();
    setMarkMenu({ frid, x: box.left, y: box.bottom + 4 });
  };

  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const conformedCount = spec.functionalSpecs.filter((entry) => entry.conformed).length;
  const specLines = spec.ok && text !== null ? functionalSpecLines(text) : new Map<number, SpecLine>();
  const all = text?.split("\n") ?? [];
  // A functional spec collapses to its first line when it has more than one: what is under it is hidden.
  const lastOf = new Map<number, number>();
  for (const [index, mark] of specLines) lastOf.set(mark.line, Math.max(lastOf.get(mark.line) ?? index, index));
  const foldable = [...lastOf].filter(([first, last]) => last > first).map(([first]) => first);
  const hiddenBy = new Map<number, number>();
  for (const first of folded) for (let index = first + 1; index <= (lastOf.get(first) ?? first); index++) hiddenBy.set(index, first);
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
    if (first !== undefined) return shownStarts[shown.indexOf(first)]! + all[first]!.length;
    return shownStarts[shown.indexOf(line)]! + at - fullStarts[line]!;
  };
  const lineAt = (at: number) => atOrBelow(fullStarts, at);
  const isCollapsed = (line: number) => folded.has(line) && (lastOf.get(line) ?? line) > line;
  const allFolded = foldable.length > 0 && foldable.every((first) => folded.has(first));

  const toggle = (first: number) => {
    const area = areaRef.current;
    if (area !== null && document.activeElement === area) caretRef.current = toFull(area.selectionStart);
    setFolded((now) => {
      const next = new Set(now);
      if (next.has(first)) next.delete(first);
      else next.add(first);
      return next;
    });
  };
  const foldAll = (fold: boolean) => {
    setFolded(new Set(fold ? foldable : []));
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
    // An edit that would take hidden lines with it, or break a collapsed spec's first line, opens that spec instead
    // of being made: the person sees what they would change.
    const reached = new Set([...hiddenBy].filter(([index]) => fullStarts[index]! > from && fullStarts[index]! < to).map(([, first]) => first));
    const line = lineAt(from);
    if (isCollapsed(line) && (inserted.includes("\n") || text.slice(from, to).includes("\n"))) reached.add(line);
    if (reached.size > 0) {
      caretRef.current = from;
      setFolded((now) => new Set([...now].filter((first) => !reached.has(first))));
      return;
    }
    const newlines = (part: string) => part.split("\n").length - 1;
    const moved = newlines(inserted) - newlines(text.slice(from, to));
    // The collapsed specs below the edit move down or up with it.
    if (moved !== 0) setFolded((now) => new Set([...now].map((first) => (first > line ? first + moved : first))));
    setText(text.slice(0, from) + inserted + text.slice(to));
  };
  const rendering = text !== null ? renderingLines(running, spec, text, specLines) : new Set<number>();
  const firstRendering = rendering.size > 0 ? Math.min(...rendering) : undefined;
  // A functional spec any of whose lines the running work renders is being built now.
  const renderingFrids = new Set([...rendering].flatMap((index) => specLines.get(index)?.frid ?? []));

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
        const next = new Set(now);
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
    if (point !== undefined && texts !== undefined) putCaret(pointNow(all, then, texts, point) - 1);
    else requestAnimationFrame(() => showLine(Math.min(...lines)));
    const timer = setTimeout(() => setRevealed(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [props.reveal?.at, text === null]);

  const hovered = hover !== null ? { ...hover, state: stateOf(hover.frid, hover.line), entry: entryFor(hover.frid, hover.line) } : null;

  return (
    // What runs now, in its kind's colour - regenerating pink, conformance testing cyan - wherever the view shows it.
    <div className="spec-view" data-working={running?.kind === "conformance" ? "conformance" : "regenerate"}>
      {markMenu && (
        <MarkMenu
          {...markMenu}
          built={spec.functionalSpecs.find((entry) => entry.frid === markMenu.frid)?.built === true}
          onRegenerate={() => props.onRegenerate([markMenu.frid])}
          onConform={() => props.onConform([markMenu.frid])}
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
            {spec.ok && total > 0 && (
              <span className="built-count" title="functional specs whose code is regenerated from the ***plain">
                <Icon name="check" size={12} /> {built} of {total} regenerated <span className="muted">·</span>
              </span>
            )}
            {spec.ok && conformedCount > 0 && (
              <span className="conformed-count" title="built, and their conformance tests written and passing">
                <Icon name="checks" size={12} /> {conformedCount} conformed ·
              </span>
            )}
            {foldable.length > 0 && (
              <>
                <button className="link fold-all" onClick={() => foldAll(!allFolded)} title={allFolded ? "show every functional spec whole" : "show only the first line of each functional spec"}>
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
        {!spec.ok && (
          <div className="parse-error">
            <Icon name="warn" />
            <div>
              <strong>the <PlainName /> does not parse</strong>
              <p>{spec.error}</p>
            </div>
          </div>
        )}
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
                const state = mark && stateOf(mark.frid, all[mark.line]!);
                const canFold = mark?.first === true && (lastOf.get(index) ?? index) > index;
                const isFolded = canFold && folded.has(index);
                const hidden = isFolded ? (lastOf.get(index) ?? index) - index : 0;
                // A collapsed spec is lit while the work renders any of its lines.
                // The work's lines in its colour; the lines a click opened on in the highlighter's - each on a folded
                // functional spec's line when it hides them.
                const lit = rendering.has(index) || (isFolded && [...rendering].some((at) => hiddenBy.get(at) === index));
                const shown = revealed.has(index) || (isFolded && [...revealed].some((at) => hiddenBy.get(at) === index));
                const aimed = pointed !== null && mark !== undefined && mark.frid === markMenu?.frid ? `pointed ${pointed}` : "";
                return (
                  <div key={index} data-line={index} className={[lit ? "rendering" : "", shown ? "revealed" : "", isFolded ? "folded" : "", aimed].join(" ").trim() || undefined}>
                    {mark && state && (
                      <span className={`gutter ${state}`}>
                        {canFold && (
                          <button
                            className={`fold ${isFolded ? "" : "open"}`}
                            title={isFolded ? `show all of functional spec ${mark.frid}` : `show only the first line of functional spec ${mark.frid}`}
                            aria-label={isFolded ? `expand functional spec ${mark.frid}` : `collapse functional spec ${mark.frid}`}
                            aria-expanded={!isFolded}
                            onClick={() => toggle(index)}
                          >
                            <Icon name="chevron" size={12} />
                          </button>
                        )}
                        {mark.first && (
                          <button
                            className="mark"
                            aria-label={`functional spec ${mark.frid}, ${STATE_LABEL[state]}`}
                            onClick={(event) => markerMenu(mark.frid, event.currentTarget)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              markerMenu(mark.frid, event.currentTarget);
                            }}
                          >
                            {state === "now" ? <Spinner /> : state === "conformed" ? <Icon name="checks" size={12} /> : state === "built" ? <Icon name="check" size={12} /> : null}
                          </button>
                        )}
                      </span>
                    )}
                    {line === "" ? "\u200b" : coloured ? tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text)) : line}
                    {isFolded && (
                      // Out of the flow, so it never changes where the line wraps: the two layers stay alike.
                      <button className="fold-more" onClick={() => toggle(index)} title={`show all of functional spec ${mark.frid}`}>
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
              // A click on a collapsed spec's first line opens it, the caret where it was clicked; ⌘-click on a module it
              // imports or requires opens that.
              onMouseUp={(event) => {
                const area = event.currentTarget;
                if (area.selectionStart !== area.selectionEnd) return;
                const at = toFull(area.selectionStart);
                const line = lineAt(at);
                const followed = withMod(event) ? followAt(links, lines[line], at - fullStarts[line]!, line + 1) : null;
                if (followed !== null) return props.onFollow(followed, { x: event.clientX, y: event.clientY });
                if (isCollapsed(lineAt(at))) {
                  caretRef.current = at;
                  toggle(lineAt(at));
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
 * What a functional spec's mark offers: regenerate it, or validate it once it is built - that functional spec alone.
 * Each is lit as it is pointed at, or reached with the arrow keys, in its kind's colour - and the functional spec with it.
 * Escape, a click elsewhere or the window left closes it.
 */
function MarkMenu(props: {
  x: number;
  y: number;
  built: boolean;
  onRegenerate: () => void;
  onConform: () => void;
  onPoint: (item: "regenerate" | "validate" | null) => void;
  onClose: () => void;
}) {
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
    if (next) props.onPoint(next.classList.contains("validate") ? "validate" : "regenerate");
  };
  const aim = (item: "regenerate" | "validate") => ({
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
      <button role="menuitem" className="validate" disabled={!props.built} onClick={choose(props.onConform)} {...aim("validate")}>
        validate{!props.built && <span className="muted"> - once it is built</span>}
      </button>
    </div>
  );
}

function SpecStatePop(props: { frid: string; x: number; y: number; state: State; running?: Job; isNew: boolean }) {
  const { state, running } = props;
  // Built now: no more than what is being done - validating or regenerating - by the loader.
  const working = state === "now";
  const [title, detail] = props.isNew
    ? ["new - not saved yet", "save the ***plain, then regenerate builds it."]
    : working
      ? [running?.kind === "conformance" ? "validating" : "regenerating", null]
      : state === "conformed"
        ? ["regenerated and validated", "its code is built from the ***plain as it is, and its conformance tests pass."]
        : state === "built"
          ? ["regenerated", "its code is built from the ***plain as it is. it has no passing conformance tests yet."]
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
    </div>
  );
}
