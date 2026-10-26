import { useEffect, useState } from "react";
import type { Failure, Job, PastPulse, PastRun, Spec, Status } from "./types.ts";
import { cost, elapsed, Empty, Fold, type Folded, Icon, PlainName, Spinner, tokens, useTick, withPlain } from "./ui.tsx";
import { PulseSpec, type ReadPlain, type ShowInSpec, turriSays } from "./PulseSpec.tsx";
import { Prose } from "./Chat.tsx";

/** Earlier sessions' runs shown at first: the last few, and more on asking. */
const RUNS_SHOWN = 3;

/** The most of a pulse's summary its card heads with: in words, and in characters. */
const SUMMARY_WORDS = 10;
const SUMMARY_CHARS = 70;

/** When something was, as a number to order by: a time unknown is the oldest. */
const at = (ts: string | null | undefined) => (ts ? Date.parse(ts) || 0 : 0);

/**
 * This session's pulses, the newest first - queued, running and done alike, by when each was queued: a new engine's
 * pulses, numbered from 1 again, above the last one's.
 */
export function newestJobs(jobs: Iterable<Job>): Job[] {
  return [...jobs].sort((a, b) => b.queuedAt - a.queuedAt || b.sequence - a.sequence);
}

/** Earlier sessions' runs, the newest first, and each run's pulses the newest first too - whatever order the ledger gives. */
export function newestRuns(runs: PastRun[]): PastRun[] {
  return runs
    .map((run) => ({ ...run, pulses: [...run.pulses].sort((a, b) => at(b.queued) - at(a.queued)) }))
    .sort((a, b) => at(b.started) - at(a.started));
}

/** A pulse's summary as its card heads with it - cut at a word, with an ellipsis - the whole of it on hover. */
export function short(text: string): string {
  const words = text.trim().split(/\s+/);
  let cut = words.slice(0, SUMMARY_WORDS).join(" ");
  if (words.length <= SUMMARY_WORDS && cut.length <= SUMMARY_CHARS) return cut;
  if (cut.length > SUMMARY_CHARS - 1) cut = cut.slice(0, SUMMARY_CHARS - 1).replace(/\s+\S*$/, "") || cut.slice(0, SUMMARY_CHARS - 1);
  return `${cut.replace(/[\s,.;:-]+$/, "")}…`;
}

/** A failed pulse, as a chat is asked to investigate it: what turri looks it up by, and what it said of why it failed. */
export interface Failed {
  id: string;
  module?: string | null;
  pulse?: number | null;
  kind: string;
  why: string;
}

/** A failed pulse's one button: a chat of its own, asked why it failed and to fix it. */
function InvestigateButton({ failed, onInvestigate }: { failed: Failed; onInvestigate: (failed: Failed) => void }) {
  return (
    <button className="link job-investigate" title="a new chat with turri, to find out why it failed and fix it" onClick={() => onInvestigate(failed)}>
      <Icon name="spark" size={12} /> investigate
    </button>
  );
}

/**
 * The work: each codebase's plan, and every pulse - running, planned and done - with the ***plain it works on in its
 * card; below them, earlier sessions' pulses, from the ledger, read only.
 */
export function WorkView({
  status,
  jobs,
  earlier,
  specs,
  onShowInSpec,
  readPlain,
  debug,
  onInvestigate,
  opened,
  onToggle,
  focus,
  onRevealed,
}: {
  status: Status;
  jobs: Job[];
  earlier: PastRun[];
  /** The project's ***plain files as they are now: a pulse's lines open in one only while they are still there. */
  specs: Spec[];
  onShowInSpec: ShowInSpec;
  readPlain: ReadPlain;
  /** turri's debug mode on (config.turri.yaml's debug): a pulse's report shown - otherwise left out. */
  debug: boolean;
  onInvestigate: (failed: Failed) => void;
  /**
   * The pulses whose cards are open, and the parts of them - `<id>/<part>` - kept by the window, so they stay so as the
   * view is left and shown again: each closed, to its head, until it is clicked open - a card opened for the person too,
   * asked for in the chat, or newly failed.
   */
  opened: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** The pulse marked - the one last asked for - and, while `reveal`, to bring into view and focus, once. */
  focus?: { id: string; at: number; reveal: boolean };
  onRevealed: () => void;
}) {
  const toggle = onToggle;
  const partOf = (id: string) => (name: string) => ({ open: opened.has(`${id}/${name}`), onToggle: () => toggle(`${id}/${name}`) });
  const [runsShown, setRunsShown] = useState(RUNS_SHOWN);
  useEffect(() => {
    if (focus === undefined || !focus.reveal) return;
    onRevealed();
    // An earlier pulse in a run not shown yet: the runs down to it are.
    const run = earlier.findIndex((entry) => entry.pulses.some((pulse) => pulse.id === focus.id));
    if (run >= runsShown) setRunsShown(run + 1);
    requestAnimationFrame(() => {
      const card = document.querySelector(`.job[data-id="${CSS.escape(focus.id)}"]`);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      card?.querySelector<HTMLElement>(".job-head[role=button]")?.focus({ preventScroll: true });
    });
  }, [focus?.at, focus?.reveal]);
  const anyRunning = jobs.some((job) => job.status === "running");
  useTick(anyRunning);

  if (jobs.length === 0 && status.modules.length === 0 && earlier.length === 0)
    return (
      <Empty icon="layers" title="nothing has run yet">
        ask turri in the chat to regenerate, or choose <PlainName /> &gt; regenerate…: turri plans the work into pulses and starts them. each one shows up here, live.
      </Empty>
    );

  const total = jobs.reduce((sum, job) => sum + job.usage.cost, 0);

  return (
    <div className="work-view" tabIndex={-1}>
      <div className="work-list">
        {status.modules.map((module) => (
          <div key={module.module} className="module-plan">
            <div className="module-plan-head">
              <Icon name="layers" />
              <strong>{module.module}</strong>
              {module.stack && <span className="tag">{module.stack}</span>}
              {module.why && <span className="muted"> - {withPlain(turriSays(module.why))}</span>}
            </div>
            {module.planned.length > 0 && (
              <ol className="planned">
                {module.planned.map((entry, index) => (
                  <li key={index} className={entry.track === "conformance" ? "conformance" : "regenerate"}>
                    <span className="planned-index">{index + 1}</span>
                    {entry.planning ? <Spinner /> : <Icon name={entry.track === "conformance" ? "test" : "clock"} size={14} />}
                    <span title={entry.title}>{short(entry.title)}</span>
                    <span className="kind-tag">{entry.track === "conformance" ? "conformance" : "regenerate"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}

        {(jobs.length > 0 || earlier.length === 0) && (
          <div className="sidebar-section inline">
            Pulses {total > 0 && <span className="muted">· ${total.toFixed(2)} so far</span>}
          </div>
        )}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} open={opened.has(job.id)} marked={job.id === focus?.id} onToggle={() => toggle(job.id)} part={partOf(job.id)} debug={debug} specs={specs} onShowInSpec={onShowInSpec} readPlain={readPlain} onInvestigate={onInvestigate} />
        ))}

        {earlier.length > 0 && <div className="sidebar-section inline">earlier sessions</div>}
        {earlier.slice(0, runsShown).map((run) => (
          <div key={run.run} className="past-run">
            <div className="past-run-head">
              <span>{when(run.started)}</span>
              <span className="muted">· {MODES[run.mode ?? ""] ?? run.mode ?? "run"}</span>
              {run.version && <span className="muted">· turri {run.version}</span>}
              {runCost(run) && <span className="muted">· {runCost(run)}</span>}
            </div>
            {run.pulses.map((pulse) => (
              <PastPulseCard key={pulse.id} pulse={pulse} open={opened.has(pulse.id)} marked={pulse.id === focus?.id} onToggle={() => toggle(pulse.id)} part={partOf(pulse.id)} specs={specs} onShowInSpec={onShowInSpec} readPlain={readPlain} onInvestigate={onInvestigate} />
            ))}
          </div>
        ))}
        {earlier.length > runsShown && (
          <button className="link past-more" onClick={() => setRunsShown((now) => now + 5)}>
            <Icon name="chevron" size={12} /> show earlier runs <span className="muted">· {earlier.length - runsShown} more</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** What a card is told of how it is shown: open or closed to its head, and marked - the pulse the chat last pointed to. */
interface Shown {
  open: boolean;
  marked: boolean;
  onToggle: () => void;
  /** A part of its card, by its name - its ***plain file, trace, report - open or not, as the window keeps it. */
  part: (name: string) => Folded;
}

/**
 * A card's head, which opens and closes it - a click, or enter or space with it focused. Not a button: its words can be
 * selected and copied, and a click that ends a selection leaves the card as it is. With nothing to open, just the head.
 */
function CardHead({ open, onToggle, children }: { open: boolean; onToggle?: () => void; children: React.ReactNode }) {
  if (onToggle === undefined) return <div className="job-head">{children}</div>;
  return (
    <div
      className="job-head"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => {
        if ((window.getSelection()?.toString() ?? "") === "") onToggle();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onToggle();
      }}
    >
      <span className="job-chevron">
        <Icon name="chevron" size={12} />
      </span>
      {children}
    </div>
  );
}

/**
 * A closed card opened by a click anywhere on it - the line under its head, its edges - as its head opens it: not one on
 * a button or link of its own (investigate), on the head (which toggles it itself), nor one that ends a selection. Open,
 * its body is left to what is in it.
 */
function opensOnClick(open: boolean, onToggle: (() => void) | undefined) {
  if (open || onToggle === undefined) return undefined;
  return (event: React.MouseEvent) => {
    const at = event.target as HTMLElement;
    if (at.closest(".job-head, button, a, input, textarea, select") !== null || (window.getSelection()?.toString() ?? "") !== "") return;
    onToggle();
  };
}

function JobCard({ job, open, marked, onToggle, part, debug, specs, onShowInSpec, readPlain, onInvestigate }: Shown & { job: Job; debug: boolean; specs: Spec[]; onShowInSpec: ShowInSpec; readPlain: ReadPlain; onInvestigate: (failed: Failed) => void }) {
  // Open, what a pulse that ended reports, and what it found the ***plain does not say - closed, its head says how it
  // went without them. A failed one's report is not read here: investigate hands it to a chat.
  const gaps = job.specGaps.length;
  const report = job.status !== "running" && job.status !== "queued" ? (job.announce ?? job.report ?? job.error ?? "").trim() : "";
  // Its kind, coloured as the ***plain view marks it: a regenerate pulse pink, as a built functional spec; a conformance
  // pulse turri's cyan, as a conformance-tested one - two ticks when it lands.
  const kind = job.kind === "conformance" ? "conformance" : "regenerate";
  const summary = job.title ?? job.summary;
  const failed = job.status === "failed";
  const icon =
    job.status === "running" ? (
      <Spinner />
    ) : job.status === "succeeded" ? (
      <Icon name={kind === "conformance" ? "checks" : "check"} />
    ) : job.status === "failed" ? (
      <Icon name="x" />
    ) : job.status === "stopped" ? (
      <Icon name="stop" />
    ) : (
      <Icon name="clock" />
    );
  return (
    <div className={`job openable ${kind} ${job.status} ${open ? "open" : ""} ${marked ? "marked" : ""}`} data-id={job.id} onClick={opensOnClick(open, onToggle)}>
      <CardHead open={open} onToggle={onToggle}>
        <span className={`job-icon ${job.status}`}>{icon}</span>
        <div className="job-title">
          <strong title={summary}>{short(summary)}</strong>
          <span className="muted">
            {/* Two spaces after its module - the first one that does not collapse - then its kind. */}
            {job.module}{"\u00a0"} · <span className="kind-tag">{job.kind}</span>
          </span>
        </div>
        <div className="job-meta">
          <span>{job.status === "queued" ? "waiting" : elapsed(job.startedAt, job.finishedAt)}</span>
          {cost(job.usage) && <span className="muted">{cost(job.usage)}</span>}
        </div>
      </CardHead>
      {/* Failed, said under the head, open or closed - and investigate beside it, a chat of its own to find out why. */}
      {failed && (
        <div className="job-outcome failed">
          failed
          <InvestigateButton failed={{ id: job.id, module: job.module, pulse: job.pulse, kind: job.kind, why: report }} onInvestigate={onInvestigate} />
        </div>
      )}
      {open && (
        <div className="job-body">
          {/* The ***plain it works on: what it renders, or the functional spec a conformance run builds. */}
          <PulseSpec job={job} specs={specs} onShowInSpec={onShowInSpec} readPlain={readPlain} part={part} />
          {/* What its agents are doing, while it runs: once it has ended, there is no trace. */}
          {job.status === "running" && <Trace job={job} folded={part("trace")} />}
          {debug && !failed && report !== "" && (
            <Fold className="job-report" title="report" folded={part("report")}>
              <Prose text={report} />
            </Fold>
          )}
          {gaps > 0 && (
            <Fold
              className="job-gaps"
              folded={part("gaps")}
              title={
                <>
                  <span className="gaps-count">{gaps}</span> <PlainName /> gap{gaps === 1 ? "" : "s"}
                </>
              }
            >
              <ul className="gaps">
                {job.specGaps.map((gap, index) => (
                  <li key={index}>
                    <div>
                      <strong>the <PlainName /> does not say:</strong> {gap.question}
                    </div>
                    <div className="muted">Meanwhile, the pulse assumed: {gap.assumption}</div>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
          <Failures diagnosis={job.diagnosis} failures={job.failures} folded={part("failure")} />
        </div>
      )}
    </div>
  );
}

/**
 * What a running pulse's agents are doing, opened: its steps, and its agents, by the turns they have taken and what
 * they have spent. Its line says no more than that it is there.
 */
function Trace({ job, folded }: { job: Job; folded: Folded }) {
  return (
    <Fold className="job-trace" title="agent trace" folded={folded}>
      {job.building && <div className="building">building {withPlain(turriSays(job.building.label))}</div>}
      {job.activity.length > 0 && (
        <ul className="activity">
          {job.activity.map((line, index) => (
            <li key={index}>{withPlain(turriSays(line))}</li>
          ))}
        </ul>
      )}
      {job.agents.length > 0 && (
        <div className="agents">
          {/* An agent turri started without a label - its release agent - is named for what it is. */}
          {job.agents.map((agent, index) => (
            <span key={agent.label ?? index} className="agent-chip" title={agent.model}>
              {withPlain(turriSays(agent.label ?? "agent"))} · {agent.turns} turn{agent.turns === 1 ? "" : "s"}
              {tokens(agent.usage) && ` · ${tokens(agent.usage)}`}
            </span>
          ))}
        </div>
      )}
    </Fold>
  );
}

/**
 * What went wrong in a pulse: why it failed, as turri's diagnosis says, and what failed that the work went on past - a
 * healer, the model provider, a commit. Nothing, no line.
 */
function Failures({ diagnosis, failures, folded }: { diagnosis?: string; failures: Failure[]; folded: Folded }) {
  if (!diagnosis && failures.length === 0) return null;
  const summary = [diagnosis && "diagnosis", failures.length > 0 && failures.map((failure) => failure.mark).join(", ")].filter(Boolean).join(" · ");
  return (
    <Fold className="job-failure" title="failure" summary={summary} folded={folded}>
      {diagnosis && (
        <div className="diagnosis">
          <div>{diagnosis}</div>
        </div>
      )}
      <FailureMarks failures={failures} />
    </Fold>
  );
}

/** What failed in a pulse that the work went on past - a healer, the model provider, a commit - each once, its whole on hover. */
function FailureMarks({ failures }: { failures: Failure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="failure-marks">
      {failures.map((failure) => (
        <span key={failure.mark} className="failure-mark" title={failure.text}>
          <Icon name="warn" size={12} /> {failure.mark}
        </span>
      ))}
    </div>
  );
}

/** How a run was started, as the ledger's `run.started` names it. */
const MODES: Record<string, string> = {
  host: "in the app",
  chat: "in the terminal",
  regenerate: "turri regenerate, headless",
};

/** When a run started: today's and yesterday's by their time, older ones by their date too. */
function when(ts: string | null): string {
  if (ts === null) return "a run";
  const at = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const ago = Math.round((day(new Date()) - day(at)) / 86_400_000);
  if (ago === 0) return `today, ${time}`;
  if (ago === 1) return `yesterday, ${time}`;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}, ${time}`;
}

function runCost(run: PastRun): string {
  const spent = run.pulses.reduce((sum, pulse) => sum + (pulse.usage?.cost ?? 0), 0);
  return spent > 0 ? `$${spent.toFixed(2)}` : "";
}

/** How an earlier pulse ended: its status, whether it landed, who stopped it - or that its run stopped under it. */
function outcome(pulse: PastPulse): string {
  if (pulse.status === "unended") return "never ended - its session stopped while it ran";
  if (pulse.status === "unstarted") return "never started - its session stopped first";
  const by = pulse.status === "stopped" && pulse.stoppedBy !== null ? ` by ${pulse.stoppedBy === "turri" ? "turri" : "you"}` : "";
  const landed = pulse.landed === true ? ", landed" : pulse.landed === false ? ", did not land" : "";
  return `${pulse.status}${by}${landed}`;
}

/**
 * A pulse of an earlier session: read only - how it ended, how long, what it cost, a failed one with investigate beside
 * that, and, open, the ***plain it regenerated, as the ledger keeps it, in its right half.
 */
function PastPulseCard({ pulse, open, marked, onToggle, part, specs, onShowInSpec, readPlain, onInvestigate }: Shown & { pulse: PastPulse; specs: Spec[]; onShowInSpec: ShowInSpec; readPlain: ReadPlain; onInvestigate: (failed: Failed) => void }) {
  const kind = pulse.kind === "conformance" ? "conformance" : "regenerate";
  const summary = pulse.title ?? pulse.summary;
  // Nothing more than its head says - no marks, no ***plain kept of it: a card that does not open.
  const more = pulse.failures.length > 0 || (pulse.diff ?? "").trim() !== "";
  const icon =
    pulse.status === "succeeded" ? (
      <Icon name={kind === "conformance" ? "checks" : "check"} />
    ) : pulse.status === "failed" ? (
      <Icon name="x" />
    ) : pulse.status === "stopped" ? (
      <Icon name="stop" />
    ) : (
      <Icon name="clock" />
    );
  return (
    <div className={`job past ${more ? "openable" : ""} ${kind} ${pulse.status} ${open ? "open" : ""} ${marked ? "marked" : ""}`} data-id={pulse.id} onClick={opensOnClick(open, more ? onToggle : undefined)}>
      <CardHead open={open} onToggle={more ? onToggle : undefined}>
        <span className={`job-icon ${pulse.status}`}>{icon}</span>
        <div className="job-title">
          <strong title={summary}>{short(summary)}</strong>
          <span className="muted">
            {pulse.module ? `${pulse.module}\u00a0 · ` : ""}
            <span className="kind-tag">{pulse.kind}</span>
          </span>
        </div>
        <div className="job-meta">
          <span>{pulse.ms !== null ? elapsed(0, pulse.ms) : ""}</span>
          {cost(pulse.usage ?? undefined) && <span className="muted">{cost(pulse.usage ?? undefined)}</span>}
        </div>
      </CardHead>
      <div className={`job-outcome ${pulse.status}`}>
        {outcome(pulse)}
        {pulse.status === "failed" && <InvestigateButton failed={{ id: pulse.id, module: pulse.module, pulse: pulse.pulse, kind: pulse.kind, why: pulse.error ?? "" }} onInvestigate={onInvestigate} />}
      </div>
      {open && more && (
        <div className="job-body">
          <PulseSpec job={{ diff: pulse.diff ?? undefined, diffWhere: pulse.diffWhere ?? undefined, kind: pulse.kind, status: pulse.status }} specs={specs} onShowInSpec={onShowInSpec} readPlain={readPlain} part={part} />
          <Failures failures={pulse.failures} folded={part("failure")} />
        </div>
      )}
    </div>
  );
}
