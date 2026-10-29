import { useEffect, useState } from "react";
import type { Job, JobCases, Spec, TestPlainFile } from "./types.ts";
import { Fold, type Folded, Icon, PlainMark } from "./ui.tsx";

/** A pulse's lines when it ran, each by its number in the file and its text. */
export type PulseLines = Array<{ line: number; text: string }>;
/**
 * Where a click on a pulse's ***plain puts the caret in the ***plain view: the line clicked, as numbered when the pulse
 * ran, and the nearest line of text to it - itself, unless it is blank or was taken out - to find where it is now.
 */
export interface Point {
  line: number;
  anchor: { line: number; text: string };
}
/**
 * A pulse's lines opened where their file is shown, lit - and the caret where it was clicked, if it was: a module in the
 * ***plain view, a template of the project's as its file, the standard library's in stdlib. `file` is as turri's diff
 * names it: its path in the project, or `stdlib/...`.
 */
export type ShowInSpec = (file: string, lines: PulseLines, point?: Point) => void;
/**
 * The project's test plain files, for a pulse's ***plain to tell them from its modules': its test folders, by their
 * paths in the project - a file deleted since is still in one - and the files there now, each with what it is of.
 */
export type PlainTests = { dirs: string[]; files: TestPlainFile[] };
const inTests = (tests: PlainTests | undefined, rel: string) => tests?.dirs.some((dir) => rel.startsWith(`${dir}/`)) === true;
/** The text of a file a pulse's ***plain comes from, as `ShowInSpec` names it, as it is now - null if it is not there. */
export type ReadPlain = (file: string) => Promise<string | null>;

type Token = { text: string; role: string | null };
/** A line of a pulse's ***plain: its text as the diff has it, and - placed - its line and its text as its file has it. */
type Line = { kind: "context" | "add" | "del" | "gap"; text: string; line?: number; written?: string; again?: boolean };
type File = { file: string; lines: Line[] };

/** A section's header in ***plain: `***functional specs***`. */
const SECTION = /^\*\*\*.*\*\*\*$/;

/**
 * An item a module's diff carries with its text unchanged - a functional spec regenerated again, or one whose linked
 * file changed: turri's diff of a module has no other context than the sections' headers. Whether it is what the pulse
 * builds is its cases' to say. A test plain file's diff is git's, its context only context.
 */
const carried = (line: Line) => line.kind === "context" && !SECTION.test(line.text.trim()) && line.text.trim() !== "";

/**
 * A pulse's spec change, file by file. turri's diff is of the ***plain the pulse renders - its module's own and what it
 * takes from the modules it requires and the standard library - under its module's file; where each line of it is,
 * `where` says, file by file. Each file's lines are kept together, in the diff's order, each run of them under its
 * section's header, a gap between runs. A line `where` does not place stays in the file of the line it is among - a
 * section's header, with the line it heads.
 */
function filesOf(diff: string, where: Job["diffWhere"]): File[] {
  // The diff's lines, each with the file it is in - or, a section's header turri did not place, none yet - and the
  // section turri says it is in, when it says. A file's first hunk starts it: in no section, as turri's diffFiles has it.
  const rows: Array<Line & { file?: string; starts?: true; section?: string }> = [];
  let named = "";
  let header = false;
  diff
    .replace(/\n$/, "")
    .split("\n")
    .forEach((raw, index) => {
      if (raw.startsWith("diff --git ")) {
        named = raw.split(" b/").at(-1) ?? "";
        header = true;
        return;
      }
      // A file's header, up to its first hunk: not the spec's. A spec line taken out that starts with --- is a hunk's.
      if (header && !raw.startsWith("@@")) return;
      if (raw.startsWith("@@")) {
        rows.push({ kind: "gap", text: "", ...(header ? { starts: true as const } : {}) });
        header = false;
        return;
      }
      const kind = raw.startsWith("+") ? "add" : raw.startsWith("-") ? "del" : "context";
      const placed = where?.[index];
      const text = raw.slice(1);
      rows.push({
        kind,
        text,
        ...(placed !== undefined ? { line: placed.line, file: placed.file, ...(placed.written !== undefined ? { written: placed.written } : {}), ...(placed.section !== undefined ? { section: placed.section } : {}) } : kind === "context" && SECTION.test(text.trim()) ? {} : { file: named }),
      });
    });
  // What is not placed goes with what follows it - a header with the line it heads - or else what is before it.
  for (let at = rows.length - 1, next: string | undefined; at >= 0; at--) rows[at]!.file === undefined ? (rows[at]!.file = next) : (next = rows[at]!.file);
  for (let at = 0, before = named; at < rows.length; at++) rows[at]!.file === undefined ? (rows[at]!.file = before) : (before = rows[at]!.file!);

  const files = new Map<string, File & { last: number; section?: string }>();
  let section: string | undefined;
  rows.forEach((row, at) => {
    // A new file starts in no section: a test plain file never has the module's. turri's section, where it gives one;
    // else the last section header seen in this file.
    if (row.starts) section = undefined;
    if (row.section !== undefined) section = row.section;
    else if (row.kind === "context" && SECTION.test(row.text.trim())) section = row.text.trim();
    if (row.kind === "gap") return;
    const name = row.file!;
    let file = files.get(name);
    if (file === undefined) files.set(name, (file = { file: name, lines: [], last: -1 }));
    // A run of this file's lines after another file's, or a hunk's gap: apart from its last, and under its section.
    if (file.last !== at - 1 && file.lines.length > 0) file.lines.push({ kind: "gap", text: "" });
    const heads = row.kind === "context" && SECTION.test(row.text.trim());
    if (!heads && section !== undefined && (file.section !== section || file.last !== at - 1) && file.lines.at(-1)?.text.trim() !== section) file.lines.push({ kind: "context", text: section });
    file.lines.push({ kind: row.kind, text: row.text, ...(row.line !== undefined ? { line: row.line } : {}), ...(row.written !== undefined ? { written: row.written } : {}) });
    file.section = section;
    file.last = at;
  });
  // A section's header none of whose lines are this file's - all from another - is left out of it, and the gaps it leaves
  // made one.
  return [...files.values()].map(({ file, lines }) => {
    const kept = lines.filter((line, at) => !(line.kind === "context" && SECTION.test(line.text.trim()) && (lines[at + 1] === undefined || lines[at + 1]!.kind === "gap" || SECTION.test(lines[at + 1]!.text.trim()))));
    return { file, lines: kept.filter((line, at) => line.kind !== "gap" || (at > 0 && at < kept.length - 1 && kept[at - 1]!.kind !== "gap")) };
  });
}

/**
 * What a pulse renders, to open in the ***plain view as a click on its lines in regen does: its module's file - the one
 * with most of what it adds - and those lines, each found by its text as the file has it. None for a pulse with no
 * ***plain change - a conformance run, say.
 */
export function pulseLinesOf(job: Pick<Job, "diff" | "diffWhere">, tests?: PlainTests): { file: string; lines: PulseLines } | null {
  if (!job.diff?.trim()) return null;
  const found = filesOf(job.diff, job.diffWhere).map((file) => {
    // What a module's diff carries unchanged is what it builds too.
    const built = file.lines.filter((line) => line.line !== undefined && (line.kind === "add" || (!inTests(tests, file.file) && carried(line))));
    return { file: file.file, lines: built.map((line) => ({ line: line.line!, text: line.written ?? line.text })) };
  });
  const most = found.reduce<(typeof found)[number] | null>((best, file) => (file.lines.length > (best?.lines.length ?? 0) ? file : best), null);
  return most;
}

/**
 * A pulse's lines - each its number when the pulse ran and its text - where they are in the ***plain now, from 1: an
 * edit since, or another pulse's, moves them. Each run of them - lines that follow one another, a blank between - moves
 * as one, by the offset that finds most of its lines' text there, the smallest of those; a run whose text is not there
 * at all keeps its numbers.
 */
export function relocate(all: string[], lines: number[], texts: string[]): number[] {
  const runs: number[][] = [];
  lines.forEach((line, at) => (at > 0 && line > lines[at - 1]! && line - lines[at - 1]! <= 2 ? runs.at(-1)!.push(at) : runs.push([at])));
  return runs.flatMap((run) => {
    const offsets = new Set<number>();
    for (const at of run) all.forEach((text, index) => text === texts[at] && offsets.add(index - (lines[at]! - 1)));
    let best = { offset: 0, found: 0 };
    for (const offset of offsets) {
      const found = run.filter((at) => all[lines[at]! - 1 + offset] === texts[at]).length;
      if (found > best.found || (found === best.found && Math.abs(offset) < Math.abs(best.offset))) best = { offset, found };
    }
    return run.map((at) => lines[at]! + best.offset);
  });
}

/**
 * Where a point clicked in a pulse's ***plain is in the ***plain now, from 1: moved as its nearest line of text moved,
 * with the pulse's lines around it (`relocate`) - so a blank line keeps its place beside the text it was beside, and a
 * line edited away or taken out since is where it was among them.
 */
export function pointNow(all: string[], lines: number[], texts: string[], point: Point): number {
  const pairs = lines.map((line, at) => ({ line, text: texts[at]! }));
  let at = pairs.findIndex((pair) => pair.line === point.anchor.line && pair.text === point.anchor.text);
  if (at < 0) {
    pairs.push(point.anchor);
    pairs.sort((a, b) => a.line - b.line);
    at = pairs.indexOf(point.anchor);
  }
  const now = relocate(all, pairs.map((pair) => pair.line), pairs.map((pair) => pair.text))[at]!;
  return Math.min(Math.max(point.line + now - point.anchor.line, 1), all.length);
}

/** The functional spec a conformance run of one functional spec builds, named as turri names it: `frontend:send-message`. */
function buildingOf(job: Pick<Job, "building">): { name: string; text: string } | null {
  const spec = job.building?.spec;
  return spec !== undefined && job.building?.text ? { name: `${spec.module}:${spec.funcId}`, text: job.building.text } : null;
}

/** Whether a pulse regenerates the spec as it is - a functional spec regenerated again: its spec change changes nothing. */
export function unchangedSpec(job: Job): boolean {
  const lines = job.diff?.split("\n") ?? [];
  return job.kind !== "conformance" && lines.length > 0 && !lines.some((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---")));
}

/**
 * turri's own words for its work - a stage, an activity line, an agent's name, a note - as the window says them. turri
 * speaks of a "spec change", but a pulse runs with no change too - a functional spec regenerated again, conformance
 * tests written for what is built - so the window never says it: a pulse's stage is what it does, regenerating or
 * conformance testing, and elsewhere the words go, or say what happened instead.
 */
export function turriSays(text: string): string {
  return text
    .replace(/\bthe spec changed inside what it regenerates\b/gi, "the ***plain was edited while it ran")
    .replace(/\b(once|whenever|until|when) the spec changes\b/gi, "$1 the ***plain is edited")
    .replace(/\ba spec change does not start it\b/gi, "editing the ***plain does not start it")
    // A codebase up to date: built, or regenerated, from ***plain as it is.
    .replace(/\bfrom the spec as it is\b/gi, "from ***plain as it is")
    .replace(/\s+(for )?(a |the )?spec change\b/gi, "")
    .replace(/\bspec change\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A pulse's stage, as the person is to read it: one that speaks of a spec change says what the pulse does instead. */
export function stageOf(job: Job): string | undefined {
  if (job.stage === undefined) return undefined;
  if (/spec change/i.test(job.stage) && !/spec changed inside/i.test(job.stage)) return job.kind === "conformance" ? "turri is conformance testing" : "turri is regenerating";
  return turriSays(job.stage);
}

/**
 * The ***plain a pulse works on: its spec change, coloured by turri's grammar - the lines it renders lit, as the spec
 * lights them while it runs - or, for a conformance run, the functional spec it builds. A click on a file's lines opens
 * them in the ***plain view, lit there.
 */
export function PulseSpec({ job, specs, tests, onShowInSpec, readPlain, part }: { job: Pick<Job, "diff" | "diffWhere" | "building"> & { kind?: string; status?: string; cases?: JobCases | null }; specs: Spec[]; tests: PlainTests; onShowInSpec: ShowInSpec; readPlain: ReadPlain; part?: (name: string) => Folded }) {
  const files = job.diff?.trim() ? filesOf(job.diff, job.diffWhere) : [];
  const building = buildingOf(job);
  const verb = didTo(job.kind, job.status);
  // None yet - a pulse being planned - or none at all: the card says what the pulse does without it.
  if (files.length === 0 && building === null) return null;
  return (
    <div className="pulse-spec">
      {building && (
        <Fold
          folded={part?.(`functional spec ${building.name}`)}
          title={
            <>
              {verb} <Icon name="test" size={13} /> functional spec {building.name}
            </>
          }
        >
          <Coloured lines={building.text.split("\n").map((text) => ({ kind: "add" as const, text }))} />
        </Fold>
      )}
      {files.map((file) => {
        // A test plain file's scenarios: git's diff of it, and the functional spec they are of.
        const scenarios = inTests(tests, file.file);
        const bound = tests.files.find((entry) => entry.rel === file.file);
        const spec = specs.find((entry) => entry.rel === file.file);
        // Each found in the ***plain by its text as the file has it, where turri says it - what a module's diff carries
        // unchanged among them.
        const lines = file.lines.flatMap((line) => ((line.kind === "add" || (!scenarios && carried(line))) && line.line !== undefined ? [{ line: line.line, text: line.written ?? line.text }] : []));
        return (
          <Fold
            key={file.file}
            folded={part?.(file.file)}
            title={
              <>
                {verb} <PlainMark size={14} /> {file.file}
                {bound?.funcId !== undefined && (
                  <span className="pulse-spec-of">
                    <Icon name="test" size={12} /> the scenarios of {bound.module}:{bound.funcId}
                  </span>
                )}
              </>
            }
          >
            <OpensInPlain read={() => readPlain(file.file)} stamp={spec ?? bound} lines={lines} onShow={(shown, row) => onShowInSpec(file.file, shown, row && pointAt(file.lines, row.at, row.blank))}>
              <Coloured lines={file.lines} built={scenarios || spec === undefined ? undefined : builtOf(job.cases, spec.module)} />
            </OpensInPlain>
          </Fold>
        );
      })}
    </div>
  );
}

/**
 * A pulse's lines that open where their file is shown on a click - while they are still in it: not for a file gone
 * since, or lines edited away, as there would be nothing of the pulse's to light. Looked for again each time a module's
 * ***plain changes (`stamp`). A click that ends a selection leaves them be, so they can be copied.
 */
function OpensInPlain({ read, stamp, lines, onShow, children }: { read: () => Promise<string | null>; stamp: unknown; lines: PulseLines; onShow: (lines: PulseLines, row?: { at: number; blank: boolean }) => void; children: React.ReactNode }) {
  const [there, setThere] = useState(false);
  const key = lines.map((each) => `${each.line}:${each.text}`).join("\n");
  useEffect(() => {
    setThere(false);
    if (lines.length === 0) return;
    let alive = true;
    void read()
      .then((text) => {
        if (text === null) return;
        const all = text.split("\n");
        const now = relocate(all, lines.map((each) => each.line), lines.map((each) => each.text));
        if (alive) setThere(now.some((line, at) => all[line - 1] === lines[at]!.text));
      })
      .catch(() => alive && setThere(false));
    return () => void (alive = false);
  }, [stamp, key]);
  if (!there) return <>{children}</>;
  return (
    <div
      className="opens-in-plain"
      role="link"
      tabIndex={0}
      title="open in the ***plain view, these lines lit where they are now"
      onClick={(event) => {
        if ((window.getSelection()?.toString() ?? "") !== "") return;
        // The row clicked (Coloured's data-at): the caret goes there.
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-at]");
        onShow(lines, row ? { at: Number(row.dataset.at), blank: row.dataset.blank !== undefined } : undefined);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onShow(lines);
      }}
    >
      {children}
    </div>
  );
}

/** What a pulse does to a ***plain file, as its line says: regenerating it, or validating it in a conformance run, and once done regenerated or validated - and, not done, what it was to do. */
function didTo(kind?: string, status?: string): string {
  const conformance = kind === "conformance";
  if (status === "running") return conformance ? "validating" : "regenerating";
  if (status === "succeeded") return conformance ? "validated" : "regenerated";
  return conformance ? "validate" : "regenerate";
}

/**
 * Where a click on row `at` of a pulse's ***plain puts the caret: that row's line when the pulse ran - a blank drawn
 * above a row, the line before it; a line taken out, or a gap, where the nearest line above it was - found by the nearest
 * line of text, outward from the row: its own, unless it is blank. None when the pulse has no line of text numbered.
 */
function pointAt(lines: Line[], at: number, blank: boolean): Point | undefined {
  const numbered = (index: number) => {
    const row = lines[index];
    return row !== undefined && row.line !== undefined && (row.kind === "add" || row.kind === "context") ? row : undefined;
  };
  const texted = (index: number) => {
    const row = numbered(index);
    return row !== undefined && row.text.trim() !== "" ? row : undefined;
  };
  // Outward from the row - a blank, drawn above row `at`, from between the row above and that one.
  const above = blank ? at - 1 : at;
  let anchor: Line | undefined;
  for (let away = 0; away < lines.length && anchor === undefined; away++) anchor = texted(above - away) ?? texted(at + away);
  if (anchor === undefined) return undefined;
  let line = blank ? lines[at]!.line! - 1 : numbered(at)?.line;
  for (let index = at - 1; line === undefined && index >= 0; index--) line = numbered(index)?.line;
  return { line: line ?? anchor.line!, anchor: { line: anchor.line!, text: anchor.written ?? anchor.text } };
}

/**
 * What a pulse builds of a module's functional specs, by func-id, as its cases say: every one it covers - added,
 * changed, regenerated again - and of those, the ones regenerated again. None for a pulse whose cases are not known.
 */
function builtOf(cases: JobCases | null | undefined, module: string): { covered: Set<string>; again: Set<string> } | undefined {
  if (cases == null) return undefined;
  const of = (refs: JobCases[keyof JobCases]) => refs.filter((ref) => ref.module === module).map((ref) => ref.funcId);
  return { covered: new Set([...of(cases.add), ...of(cases.patch), ...of(cases.again)]), again: new Set(of(cases.again)) };
}

/**
 * Lines of ***plain, coloured as the spec is: each with its line in the file, if it has one, and what the pulse does
 * with it. A module's lines carried unchanged are lit as what it builds when their functional spec - the # <func-id>
 * heading above them, as turri's grammar colours it - is one the pulse covers (`built`), marked when it is regenerated
 * again.
 */
function Coloured({ lines, built }: { lines: Line[]; built?: { covered: Set<string>; again: Set<string> } }) {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const text = lines.map((line) => line.text).join("\n");
  useEffect(() => {
    let alive = true;
    void window.turri.call<Token[][]>("highlightSpec", { text }).then((next) => alive && setTokens(next));
    return () => void (alive = false);
  }, [text]);
  // The functional spec each line is of, by the heading above it - once the colours say which lines are headings.
  const specOf: Array<string | null> = [];
  let heading: string | null = null;
  lines.forEach((line, index) => {
    const roles = tokens?.[index]?.map((token) => token.role) ?? [];
    if (roles.includes("section")) heading = null;
    else if (roles.includes("id")) heading = line.text.replace(/^#+/, "").trim();
    specOf.push(heading);
  });
  const shownAs = (line: Line, index: number): Line => {
    const funcId = specOf[index];
    if (built === undefined || !carried(line) || funcId === null || funcId === undefined || !built.covered.has(funcId)) return line;
    return { ...line, kind: "add", again: built.again.has(funcId) };
  };
  // The lines the diff leaves out between two it has: the blank line between two items - turri's diff is of the ***plain's
  // items, not its text - a blank row, and more a gap.
  const skipped = (index: number) => {
    const before = lines.slice(0, index).findLast((line) => line.kind !== "gap");
    const line = lines[index]!;
    return before?.line !== undefined && line.line !== undefined && lines[index - 1]?.kind !== "gap" ? line.line - before.line - 1 : 0;
  };
  return (
    <div className="pulse-spec-lines">
      {lines.map((line, index) => [
        skipped(index) === 1 ? (
          <div key={`${index}-blank`} className="context" data-at={index} data-blank="">
            <span className="pulse-spec-number">{line.line! - 1}</span>
            <span className="pulse-spec-text">{"\u200b"}</span>
          </div>
        ) : skipped(index) > 1 ? (
          <div key={`${index}-gap`} className="gap" data-at={index}>
            ⋯
          </div>
        ) : null,
        line.kind === "gap" ? (
          <div key={index} className="gap" data-at={index}>
            ⋯
          </div>
        ) : (
          <div key={index} className={shownAs(line, index).again ? "add again" : shownAs(line, index).kind} data-at={index} title={shownAs(line, index).again ? "built again - its text unchanged" : undefined}>
            <span className="pulse-spec-number">{line.line ?? ""}</span>
            <span className="pulse-spec-text">
              {line.text === ""
                ? "​"
                : tokens?.[index] && tokens[index]!.map((token) => token.text).join("") === line.text
                  ? tokens[index]!.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text))
                  : line.text}
            </span>
          </div>
        ),
      ])}
    </div>
  );
}
