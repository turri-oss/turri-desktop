import { Fragment, useState } from "react";
import type { Launch } from "./types.ts";
import { Icon, Spinner } from "./ui.tsx";
import { Prose } from "./Chat.tsx";

// What turri launches (turri's docs/launch.md), as the window shows it: each codebase's launches one at a time, the
// newest commit winning - after a pulse, under launch-after-pulse, or when a chat asks. The window says only what a
// launch says: the sentinel's notice is what tells the person what to do about one that did not come up, and a chat that
// is told of a launch says it there itself.

/** turri's launches are numbered as they are asked for: launch-1, launch-2. */
const order = (launch: Launch) => Number(/(\d+)$/.exec(launch.id)?.[1] ?? 0);

/** This session's launches, the oldest first. */
export const inOrder = (launches: Iterable<Launch>) => [...launches].sort((a, b) => a.queuedAt - b.queuedAt || order(a) - order(b));

/** The launch of a codebase asked for last - running, waiting, or the last that ended - none when it was never launched. */
export function newestOf(launches: Launch[], codebase: string): Launch | undefined {
  return inOrder(launches.filter((launch) => launch.codebase === codebase && launch.status !== "superseded")).at(-1);
}

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

/** Whether something of a codebase is being launched now: one running, or one waiting its turn. */
export const launching = (launches: Launch[], codebase: string) => launches.some((launch) => launch.codebase === codebase && (launch.status === "running" || launch.status === "waiting"));

/**
 * Whether the sentinel can check what is chosen of a codebase - it launches nothing, and tests what is launched: something
 * of it runs, or is being launched. Else why not, in a few words.
 */
export function checkable(launches: Launch[], codebase: string): { ok: true } | { ok: false; why: string } {
  const newest = newestOf(launches, codebase);
  if (newest === undefined || newest.status === "stopped") return { ok: false, why: `nothing of ${codebase} is launched for it to check in - try it first` };
  if (newest.status === "failed") return { ok: false, why: `${codebase}'s last launch did not come up - try it again first` };
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

/**
 * What runs, in the preview's bar, for each codebase launched this session: its launch under way - "launching hello at
 * 3f2a1bc…" - or the last one's end: where it runs, why it did not come up, that it was stopped. One out already - its
 * code running, a tests-only pulse's or the chat's asking for what runs - started nothing: what runs is still the last
 * one's, now at its commit. Nothing before the first. Each is one line, cut short at the bar's edge: one whose launch said
 * something opens at a click into the whole of it, wrapped, to read and copy - and closes again.
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
  const shown = codebases.map((codebase) => nowOf(launches, codebase)).filter((launch): launch is Launch => launch !== undefined);
  if (shown.length === 0) return null;
  return (
    <div className="preview-launches" role="status" aria-label="what turri launches">
      {shown.map((launch) => {
        const waiting = launches.filter((each) => each.codebase === launch.codebase && each.status === "waiting" && each.id !== launch.id).at(-1);
        const said = firstLine(launch.summary);
        const whole = launch.summary?.trim() ?? "";
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
              ) : launch.status === "launched" && launch.replacedBy !== undefined ? (
                // Up, and replaced at once by the newer one waiting, which stops what it started: not what runs.
                <>
                  <Icon name="forward" size={13} /> {at} was replaced by a newer launch{launches.find((each) => each.id === launch.replacedBy) && <> at <code>{launches.find((each) => each.id === launch.replacedBy)!.short}</code></>}
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
            {Row === "button" && open.has(launch.codebase) && (
              <div className="preview-launch-whole" aria-label={`all ${launch.codebase}'s launch said`}>
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
 * launched, did not come up, stopped - or superseded or replaced, a newer pulse's launch holding its code in its place.
 */
export function PulseLaunch({ launch, launches }: { launch: Launch; launches: Launch[] }) {
  const said = firstLine(launch.summary);
  const newerId = launch.supersededBy ?? launch.replacedBy;
  const newer = newerId !== undefined ? launches.find((each) => each.id === newerId) : undefined;
  const by = newer !== undefined && "pulse" in newer.cause ? `${newer.cause.title}'s launch` : "a newer launch";
  return (
    <div className={`job-launch ${launch.status}`} title={launch.summary?.trim() || undefined} onClick={(event) => event.stopPropagation()}>
      {launch.status === "running" ? (
        <>
          <Spinner /> launching at <code>{launch.short}</code>…
        </>
      ) : launch.status === "waiting" ? (
        <>
          <Icon name="clock" size={12} /> waiting to launch - {launch.codebase}'s launch before it runs first
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
  );
}
