import { useState } from "react";
import type { Spec } from "./types.ts";
import { Icon, withPlain } from "./ui.tsx";

/** How to regenerate a module: each one of /regenerate's ways, said as turri takes it. */
export type Regeneration =
  | { how: "continue"; left: string[] }
  | { how: "changed" }
  | { how: "again"; funcIds: string[] }
  | { how: "scratch"; chain: boolean };

type How = "continue" | "changed" | "again" | "scratch" | "chain";

/**
 * Regenerate, chosen how: on where a module partly built stopped - its functional specs not built yet, and the first
 * choice while there are any - what changed in the spec (the button's own), chosen functional specs again though they did
 * not change, the whole module from scratch, or it and every module it requires from scratch. It says what the person
 * would type: from scratch starts at once, its code committed first, so its history keeps it. A module with nothing built has one way of its own - all of it, each functional spec built
 * on the ones before it, so none alone and nothing to start over - and, on a chain, its chain from scratch.
 */
export function RegenerateSheet({ spec, initial, onClose, onRegenerate }: { spec: Spec; initial?: string[]; onClose: () => void; onRegenerate: (regeneration: Regeneration) => void }) {
  // Some of its functional specs built and some not - a regeneration stopped, or halted, part of the way: carry on.
  const left = spec.functionalSpecs.filter((entry) => !entry.built).map((entry) => entry.funcId);
  const partly = left.length > 0 && left.length < spec.functionalSpecs.length;
  const none = !spec.functionalSpecs.some((entry) => entry.built);
  // Built from the ***plain as it is now: nothing changed, so nothing for "what changed" to do - it is not offered.
  const unchanged = !none && spec.drifted === false;
  const [how, setHow] = useState<How>(initial?.length && !none ? "again" : partly ? "continue" : unchanged ? "again" : "changed");
  const [funcIds, setFuncIds] = useState<Set<string>>(new Set(initial ?? []));
  const chained = spec.requires.length > 0;
  // Only what is built is regenerated again: what is not is built by continuing, or by what changed.
  const builtSpecs = spec.functionalSpecs.filter((entry) => entry.built);

  const toggle = (funcId: string) =>
    setFuncIds((now) => {
      const next = new Set(now);
      if (next.has(funcId)) next.delete(funcId);
      else next.add(funcId);
      return next;
    });

  const ways: Array<{ id: How; title: string; detail: string }> = none
    ? [
        {
          id: "changed",
          title: `all of ${spec.module}`,
          detail: `nothing of it is built yet: its ${spec.functionalSpecs.length === 1 ? "functional spec" : `${spec.functionalSpecs.length} functional specs`} regenerated from the ***plain, in pulses - each built on the ones before it.`,
        },
        ...(chained
          ? [{ id: "chain" as const, title: `${spec.module}, and its whole chain from scratch`, detail: `the modules it requires - ${spec.requires.join(", ")} - deleted and built again from the bottom first, then ${spec.module} on them.` }]
          : []),
      ]
    : [
    ...(partly
      ? [
          {
            id: "continue" as const,
            title: "continue where it stopped",
            detail: `${spec.functionalSpecs.length - left.length} of ${spec.functionalSpecs.length} functional specs are built: the ${left.length === 1 ? "one" : left.length} left - ${left.join(", ")} - built now, on top of what is built.`,
          },
        ]
      : []),
    ...(unchanged ? [] : [{ id: "changed" as const, title: "what changed", detail: "the code brought up to the ***plain as it is now - only what changed is built." }]),
    { id: "again", title: "chosen functional specs again", detail: "built ones, built again though they did not change - the code for them rewritten from the spec." },
    { id: "scratch", title: `all of ${spec.module} from scratch`, detail: "its code and conformance tests deleted - committed first, so its history keeps them - and every functional spec built again." },
    ...(chained
      ? [{ id: "chain" as const, title: `${spec.module} and its whole chain from scratch`, detail: `the same for every module it requires too - ${spec.requires.join(", ")} - built again from the bottom.` }]
      : []),
      ];

  const ordered = builtSpecs.filter((entry) => funcIds.has(entry.funcId)).map((entry) => entry.funcId);
  const ready = how !== "again" || ordered.length > 0;
  const go = () => {
    if (!ready) return;
    onRegenerate(how === "continue" ? { how, left } : how === "changed" ? { how } : how === "again" ? { how, funcIds: ordered } : { how: "scratch", chain: how === "chain" });
  };
  const deletes = how === "scratch" || how === "chain";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet regenerate" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <h2>regenerate {spec.module}</h2>
        <div className="options">
          {ways.map((way) => (
            <button key={way.id} className={`option ${how === way.id ? "on" : ""}`} onClick={() => setHow(way.id)} aria-pressed={how === way.id}>
              <strong>{way.title}</strong>
              <span className="option-detail">{withPlain(way.detail)}</span>
            </button>
          ))}
        </div>

        {how === "again" && (
          <div className="regenerate-specs">
            <div className="regenerate-specs-head">
              <span className="muted">
                {ordered.length} of {builtSpecs.length} built chosen
              </span>
              <button className="link" onClick={() => setFuncIds(new Set(ordered.length === builtSpecs.length ? [] : builtSpecs.map((entry) => entry.funcId)))}>
                {ordered.length === builtSpecs.length ? "none" : "all"}
              </button>
            </div>
            <div className="options">
              {builtSpecs.map((entry) => (
                <button key={entry.funcId} role="checkbox" aria-checked={funcIds.has(entry.funcId)} className={`option check ${funcIds.has(entry.funcId) ? "on" : ""}`} onClick={() => toggle(entry.funcId)}>
                  <span className="checkbox">{funcIds.has(entry.funcId) && <Icon name="check" size={12} />}</span>
                  <span className="regenerate-spec">
                    <span className="regenerate-func-id">{entry.funcId}</span>
                    <span className="regenerate-text">{entry.text.split("\n")[0]}</span>
                  </span>
                  <span className="muted small">{entry.conformed ? "tested" : "built"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sheet-actions">
          {deletes && <span className="muted small regenerate-warning">turri asks you in the chat before it deletes anything.</span>}
          <button className="button" onClick={onClose}>
            cancel
          </button>
          <button className="button primary" onClick={go} disabled={!ready} autoFocus>
            <Icon name="play" /> regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
