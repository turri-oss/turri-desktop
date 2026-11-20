import { Fragment, useState, type ReactNode } from "react";
import type { Launch } from "./types.ts";
import { Icon, Spinner } from "./ui.tsx";
import { Prose } from "./Chat.tsx";

// What turri launches (turri's docs/launch.md), as the window shows it: each codebase's launches one at a time, the
// newest commit winning - after a pulse, under launch-after-pulse, or when a chat asks. The window says only what a
// launch says: the sentinel's notice is what tells the person what to do about one that did not come up, and a chat that
// is told of a launch says it there itself.
//
// Across a project, a launch replaces what the launches of the modules below it in its requires chain started - their
// code is in it - and stops what turri's launches of a module beside it started when that holds what it needs, a port
// say. Either way the launch whose servers were stopped is told again with `replacedBy`, the newer launch's id - which
// may be of another codebase. The newer launch's `stopped` says what it stopped and why - `below`, a module it is built
// on, whose code it holds; `held`, one beside it that held what it needed - which is how the window tells the two apart.

/** turri's launches are numbered as they are asked for: launch-1, launch-2. */
const order = (launch: Launch) => Number(/(\d+)$/.exec(launch.id)?.[1] ?? 0);

/** This session's launches, the oldest first. */
export const inOrder = (launches: Iterable<Launch>) => [...launches].sort((a, b) => a.queuedAt - b.queuedAt || order(a) - order(b));

/** The launch of a codebase asked for last - running, waiting, or the last that ended - none when it was never launched. */
export function newestOf(launches: Launch[], codebase: string): Launch | undefined {
  return inOrder(launches.filter((launch) => launch.codebase === codebase && launch.status !== "superseded")).at(-1);
}

/**
 * The launch `launch` was stopped for because its servers held what that one needed - a port: a launch of a module beside
 * it, not one built on it - as that launch's `stopped` says. None when it was not.
 */
function heldFor(launches: Launch[], launch: Launch): Launch | undefined {
  if (launch.replacedBy === undefined) return undefined;
  const newer = launches.find((each) => each.id === launch.replacedBy);
  return newer?.stopped?.some((each) => each.why === "held" && each.launch === launch.id) ? newer : undefined;
}

/**
 * The launch whose code holds `launch`'s now: itself - or, replaced (`replacedBy`), the newer launch, and so on up while
 * each holds its code: one of its codebase, or of a module built on it. One beside it, which stopped it only for what it
 * held, does not: the walk ends before it.
 */
export function takenBy(launches: Launch[], launch: Launch): Launch {
  let now = launch;
  for (let hops = 0; now.replacedBy !== undefined && hops < launches.length; hops++) {
    const next = launches.find((each) => each.id === now.replacedBy);
    if (next === undefined || heldFor(launches, now) !== undefined) break;
    now = next;
  }
  return now;
}

/** What a codebase's launch is said to be of, in the window's words: the codebase's own, or "bestiary's". */
const whose = (codebase: string) => `${codebase}'${codebase.endsWith("s") ? "" : "s"}`;

/**
 * What a codebase's bar says: its launch running - a newer one may wait behind it - or else the last asked for: one that
 * ended, or one waiting.
 */
function nowOf(launches: Launch[], codebase: string): Launch | undefined {
  return launches.find((launch) => launch.codebase === codebase && launch.status === "running") ?? newestOf(launches, codebase);
}

/**
 * Whether a pulse's own launch is still to come up - running, waiting, or superseded or replaced by one that is: the sentinel checks
 * the pulse once it has. A pulse with none, or whose launch has ended, waits for nothing.
 */
export function pulseLaunchPending(launches: Launch[], pulse: string): boolean {
  let launch = inOrder(launches.filter((each) => "pulse" in each.cause && each.cause.pulse === pulse)).at(-1);
  for (let hops = 0; launch !== undefined && (launch.supersededBy ?? launch.replacedBy) !== undefined && hops < launches.length; hops++) {
    const by: string = (launch.supersededBy ?? launch.replacedBy)!;
    launch = launches.find((each) => each.id === by);
  }
  return launch?.status === "running" || launch?.status === "waiting";
}

/**
 * Whether something of a codebase is being launched now: one running, or one waiting its turn - or the launch of a module
 * built on it that took its launches over, its own newest replaced by it.
 */
export function launching(launches: Launch[], codebase: string): boolean {
  const under = (launch: Launch) => launch.status === "running" || launch.status === "waiting";
  if (launches.some((launch) => launch.codebase === codebase && under(launch))) return true;
  const newest = newestOf(launches, codebase);
  return newest !== undefined && under(takenBy(launches, newest));
}

/**
 * Whether the sentinel can check what is chosen of a codebase - it launches nothing, and tests what is launched: something
 * of it runs, or is being launched. Else why not, in a few words.
 */
export function checkable(launches: Launch[], codebase: string): { ok: true } | { ok: false; why: string } {
  const newest = newestOf(launches, codebase);
  if (newest === undefined || newest.status === "stopped") return { ok: false, why: `nothing of ${codebase} is launched for it to check in - try it first` };
  // Taken over by the launch of a module built on it: judged by that one - and stopped, either, for one beside it.
  const taken = takenBy(launches, newest);
  const its = taken.codebase === codebase ? `${whose(codebase)} launch` : `${whose(taken.codebase)} launch, which took ${whose(codebase)} place,`;
  const held = heldFor(launches, taken);
  if (held !== undefined) return { ok: false, why: `${its} was stopped for ${whose(held.codebase)} launch, which needed what it held - try it again first` };
  if (taken.codebase !== codebase) {
    if (taken.status === "failed") return { ok: false, why: `${its} did not come up - try it again first` };
    if (taken.status === "stopped") return { ok: false, why: `nothing of ${codebase} is launched for it to check in - try it first` };
    return { ok: true };
  }
  if (newest.status === "failed") return { ok: false, why: `${whose(codebase)} last launch did not come up - try it again first` };
  return { ok: true };
}

/** The first line of what a launch said: where it runs, or why it did not come up - the whole of it on hover. */
const firstLine = (text: string | undefined) => (text ?? "").trim().split("\n")[0]?.trim() ?? "";

/**
 * Why a launch did not come up, as it said it, after the window's own "did not come up": its agent often starts with the
 * same words - "greet did not come up: port 8000 is held…", "Not launched: …" - which are left out rather than said twice.
 */
export function whyNotUp(launch: Launch): string {
  const said = firstLine(launch.summary);
  const codebase = launch.codebase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return said.replace(new RegExp(`^(?:(?:the launch of )?${codebase}(?: at \\w+)? did not come up|not launched)\\s*[:.,-]?\\s*`, "i"), "");
}

/** `a`, `a and b`, `a, b and c`. */
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * What turri stopped for a launch, a phrase each launch it stopped - from `stopped`'s fields, never turri's sentences: its
 * processes one by one, their pids and addresses, are in the whole of what it said.
 */
function stoppedPhrases(launch: Launch): Array<{ key: string; said: ReactNode }> {
  const stopped = launch.stopped ?? [];
  const at = (commit: string | undefined) => commit !== undefined && <> at <code>{commit}</code></>;
  const byLaunch = (why: "below" | "held") => {
    const groups = new Map<string, typeof stopped>();
    for (const each of stopped.filter((item) => item.why === why)) {
      const key = `${each.module} ${each.launch ?? ""} ${each.earlier ? "earlier" : ""}`;
      groups.set(key, [...(groups.get(key) ?? []), each]);
    }
    return [...groups.entries()];
  };
  const below = byLaunch("below").map(([key, [first]]) => ({
    key: `below ${key}`,
    said: (
      <>
        stopped {whose(first!.module)} launch{at(first!.commit)} - {launch.codebase} holds its code
      </>
    ),
  }));
  const held = byLaunch("held").map(([key, items]) => {
    const first = items[0]!;
    const what = listOf([...new Set(items.map((item) => item.held ?? "what this launch needed"))]);
    return {
      key: `held ${key}`,
      said: first.earlier ? (
        <>
          stopped what an earlier session's launch of {first.module} left running - it held {what}
        </>
      ) : (
        <>
          stopped {whose(first.module)} launch{at(first.commit)} - it held {what}
        </>
      ),
    };
  });
  const left = [...new Set(stopped.filter((item) => item.why === "left-behind").map((item) => item.module))];
  return [...(left.length > 0 ? [{ key: "left-behind", said: <>stopped what an earlier session left running of {listOf(left)}</> }] : []), ...below, ...held];
}

/** What turri stopped for a launch, in a muted line under the launch's own - nothing when it stopped nothing. */
function Stopped({ launch, className }: { launch: Launch; className: string }) {
  const phrases = stoppedPhrases(launch);
  if (phrases.length === 0) return null;
  return (
    <div className={className} data-codebase={launch.codebase}>
      {phrases.map((phrase, index) => (
        <Fragment key={phrase.key}>
          {index > 0 && " · "}
          {phrase.said}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * What runs, in the preview's bar, for each codebase launched this session: its launch under way - "launching hello at
 * 3f2a1bc…" - or the last one's end: where it runs, why it did not come up, that it was stopped - what its agent said.
 * One out already - its code running, a tests-only pulse's or the chat's asking for what runs - started nothing: what
 * runs is still the last one's, now at its commit. Nothing before the first. What turri stopped for a launch is said in a
 * muted line under it. A codebase whose launch a module built on it took over - its code in that one's - has no line of
 * its own: what runs of it is that module's, whose line says it stopped it. One stopped for a module beside it, which
 * needed what it held, keeps its line, saying so. Each is one line, cut short at the bar's edge: one whose launch said
 * something opens at a click into the whole of it - turri's lines for what it stopped, then its agent's - wrapped, to
 * read and copy, and closes again.
 */
export function LaunchLine({ launches }: { launches: Launch[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (codebase: string) =>
    setOpen((was) => {
      const now = new Set(was);
      if (!now.delete(codebase)) now.add(codebase);
      return now;
    });
  const codebases = [...new Set(inOrder(launches).map((launch) => launch.codebase))];
  // Taken over by the launch of a module built on it: what runs of it is that one's.
  const folded = (launch: Launch) => launch.replacedBy !== undefined && launch.status !== "running" && launch.status !== "waiting" && takenBy(launches, launch).codebase !== launch.codebase;
  const shown = codebases.map((codebase) => nowOf(launches, codebase)).filter((launch): launch is Launch => launch !== undefined && !folded(launch));
  if (shown.length === 0) return null;
  return (
    <div className="preview-launches" role="status" aria-label="what turri launches">
      {shown.map((launch) => {
        const waiting = launches.filter((each) => each.codebase === launch.codebase && each.status === "waiting" && each.id !== launch.id).at(-1);
        const newer = launch.replacedBy !== undefined ? launches.find((each) => each.id === launch.replacedBy) : undefined;
        const held = heldFor(launches, launch);
        const said = firstLine(launch.summary);
        const whole = (launch.text ?? launch.summary)?.trim() ?? "";
        const Row = whole !== "" ? "button" : "span";
        const at = (
          <>
            <strong>{launch.codebase}</strong> at <code>{launch.short}</code>
          </>
        );
        return (
          <Fragment key={launch.codebase}>
            <Row
              className={`preview-launch ${launch.status}${launch.already ? " already" : ""}`}
              data-codebase={launch.codebase}
              title={whole || undefined}
              {...(Row === "button" && { type: "button" as const, "aria-expanded": open.has(launch.codebase), onClick: () => toggle(launch.codebase) })}
            >
              {launch.status === "running" ? (
                <>
                  <Spinner /> launching {at}…{waiting && <span className="muted"> then {waiting.short}</span>}
                </>
              ) : launch.status === "waiting" ? (
                <>
                  <Icon name="clock" size={13} /> {at} waits to launch
                </>
              ) : launch.status === "launched" && held !== undefined ? (
                // Stopped for a module beside it, which needed what it held - a port: nothing of it runs.
                <>
                  <Icon name="stop" size={13} /> {at} was stopped for <strong>{whose(held.codebase)}</strong> launch at <code>{held.short}</code>, which needed what it held - nothing of it runs
                </>
              ) : launch.status === "launched" && launch.replacedBy !== undefined ? (
                // Up, and replaced at once by the newer one waiting, which stops what it started: not what runs.
                <>
                  <Icon name="forward" size={13} /> {at} was replaced by a newer launch{newer && <> at <code>{newer.short}</code></>}
                </>
              ) : launch.status === "launched" && launch.already ? (
                // Out already - its code what runs: nothing launched anew, what runs is still the last one's, now at this commit.
                <>
                  <Icon name="play" size={13} /> <strong>{launch.codebase}</strong> still runs, now at <code>{launch.short}</code> - out already
                  {said && <span className="preview-launch-said"> - {said}</span>}
                </>
              ) : launch.status === "launched" ? (
                <>
                  <Icon name="play" size={13} /> {at} runs
                  {said && <span className="preview-launch-said"> - {said}</span>}
                </>
              ) : launch.status === "failed" ? (
                <>
                  <Icon name="warn" size={13} /> {at} did not come up{whyNotUp(launch) && <span className="preview-launch-said"> - {whyNotUp(launch)}</span>}
                </>
              ) : (
                <>
                  <Icon name="stop" size={13} /> {at} was stopped - nothing of it runs
                </>
              )}
              {Row === "button" && (
                <span className="preview-launch-chevron">
                  <Icon name="chevron" size={12} />
                </span>
              )}
            </Row>
            <Stopped launch={launch} className="preview-launch-stopped" />
            {Row === "button" && open.has(launch.codebase) && (
              <div className="preview-launch-whole" aria-label={`all ${whose(launch.codebase)} launch said`}>
                <Prose text={whole} />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * How a pulse's launch went, under its card's head, once it landed under launch-after-pulse: waiting, launching,
 * launched, did not come up, stopped - or superseded or replaced, a newer launch in its place: its codebase's, or one of a
 * module built on it, each holding its code - or stopped for one of a module beside it, which needed what it held. What
 * turri stopped for it, in a muted line under it.
 */
export function PulseLaunch({ launch, launches }: { launch: Launch; launches: Launch[] }) {
  const said = firstLine(launch.summary);
  const newerId = launch.supersededBy ?? launch.replacedBy;
  const newer = newerId !== undefined ? launches.find((each) => each.id === newerId) : undefined;
  const of = newer !== undefined && newer.codebase !== launch.codebase ? newer.codebase : undefined;
  const by =
    newer !== undefined && "pulse" in newer.cause ? `${newer.cause.title}'s launch${of !== undefined ? ` of ${of}` : ""}` : of !== undefined ? `${whose(of)} launch` : "a newer launch";
  const beside = heldFor(launches, launch) !== undefined;
  return (
    <>
      <div className={`job-launch ${launch.status}`} title={(launch.text ?? launch.summary)?.trim() || undefined} onClick={(event) => event.stopPropagation()}>
        {launch.status === "running" ? (
          <>
            <Spinner /> launching at <code>{launch.short}</code>…
          </>
        ) : launch.status === "waiting" ? (
          <>
            <Icon name="clock" size={12} /> waiting to launch - {whose(launch.codebase)} launch before it runs first
          </>
        ) : launch.status === "launched" && launch.replacedBy !== undefined && beside ? (
          <>
            <Icon name="stop" size={12} /> launched at <code>{launch.short}</code>, then stopped for {by}, which needed what it held
          </>
        ) : launch.status === "launched" && launch.replacedBy !== undefined ? (
          <>
            <Icon name="forward" size={12} /> launched at <code>{launch.short}</code>, then replaced by {by}, which holds its code
          </>
        ) : launch.status === "launched" ? (
          <>
            <Icon name="play" size={12} /> launched at <code>{launch.short}</code>
            {launch.already ? <span className="muted"> - out already: its code was running</span> : said && <span className="muted"> - {said}</span>}
          </>
        ) : launch.status === "failed" ? (
          <>
            <Icon name="warn" size={12} /> launch did not come up{whyNotUp(launch) && <span className="muted"> - {whyNotUp(launch)}</span>}
          </>
        ) : launch.status === "superseded" ? (
          <>
            <Icon name="forward" size={12} /> not launched on its own - superseded by {by}, which holds its code
          </>
        ) : (
          <>
            <Icon name="stop" size={12} /> launch stopped
          </>
        )}
      </div>
      <Stopped launch={launch} className="job-launch-stopped" />
    </>
  );
}
