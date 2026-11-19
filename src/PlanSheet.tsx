import { useState } from "react";
import type { JobCases, ModuleStatus, Spec } from "./types.ts";
import { Icon, PlainName, withPlain } from "./ui.tsx";
import { turriSays } from "./PulseSpec.tsx";

/** A codebase's next pulse, as turri's look ahead tells it (`plannedPulse`): the coding agent's whole prompt, or why none is shown. */
export interface PlannedFirst {
  module: string;
  title: string;
  track: string;
  cases: JobCases | null;
  prompt: string | null;
  why: string | null;
}

export interface Plan {
  spec: Spec;
  statuses: ModuleStatus[];
  firsts: PlannedFirst[];
}

/** What a pulse covers, by what it does to each functional spec: new, changed, again, taken out. */
function casesSaid(cases: JobCases | null): string {
  if (cases === null) return "";
  const named = (refs: JobCases[keyof JobCases]) => refs.map((ref) => `${ref.module}:${ref.funcId}`).join(", ");
  return [
    cases.add.length > 0 ? `new ${named(cases.add)}` : "",
    cases.patch.length > 0 ? `changed ${named(cases.patch)}` : "",
    cases.again.length > 0 ? `again ${named(cases.again)}` : "",
    cases.delete.length > 0 ? `taken out ${named(cases.delete)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What Regenerate would do, planned and not started - turri's look ahead: the pulses, and each codebase's next one with
 * its prompt. The plan is kept, the module waiting for Regenerate, which runs it as it is.
 */
export function PlanSheet({ plan, onClose, onRegenerate }: { plan: Plan; onClose: () => void; onRegenerate: () => void }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const work = plan.statuses.filter((status) => status.planned.length > 0);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>the plan for {plan.spec.module}</h2>
        {work.length === 0 ? (
          <p className="muted">nothing to regenerate: every codebase is built from the <PlainName /> as it is.</p>
        ) : (
          <>
            <p className="muted small">planned, and nothing started: the work waits for regenerate, which runs this plan as it is - unless the <PlainName /> changes first.</p>
            {work.map((status) => (
              <div key={status.module} className="module-plan">
                <div className="module-plan-head">
                  <Icon name="layers" /> <strong>{status.module}</strong> <span className="muted">· {status.planned.length} pulse{status.planned.length === 1 ? "" : "s"}</span>
                </div>
                <ol className="planned">
                  {status.planned.map((entry, index) => (
                    <li key={index}>
                      <span className="planned-index">{index + 1}</span>
                      <span>{entry.title}</span>
                      {entry.track === "conformance" && <span className="tag">conformance</span>}
                    </li>
                  ))}
                </ol>
                {status.planNotes?.map((note, index) => (
                  <p key={index} className="muted small">
                    {withPlain(turriSays(note))}
                  </p>
                ))}
              </div>
            ))}
          </>
        )}
        {plan.firsts.map((first) => (
          <div key={first.module} className="first">
            <p>
              <strong>first:</strong> {first.title}
              {casesSaid(first.cases) !== "" && <span className="muted"> - {casesSaid(first.cases)}</span>}
            </p>
            {first.prompt !== null ? (
              <button className="link" onClick={() => setPrompt(prompt === first.prompt ? null : first.prompt)}>
                {prompt === first.prompt ? "hide the prompt" : "show what the coding agent will be told"}
              </button>
            ) : (
              first.why !== null && <p className="muted small">{withPlain(turriSays(first.why))}</p>
            )}
          </div>
        ))}
        {prompt && <pre className="prompt-preview">{prompt}</pre>}
        <div className="sheet-actions">
          <button className="button" onClick={onClose}>
            close
          </button>
          <button className="button primary" onClick={onRegenerate} disabled={work.length === 0}>
            <Icon name="play" /> regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
