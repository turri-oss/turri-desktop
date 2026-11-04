import type { Spec } from "./types.ts";
import { withPlain } from "./ui.tsx";

/** How to regenerate a module: each one of /regenerate's ways the window asks for, said as turri takes it. */
export type Regeneration = { how: "changed" } | { how: "again"; funcIds: string[] } | { how: "scratch"; chain: boolean };

/**
 * Regenerate, from the toolbar or ***plain > Regenerate…: the module from scratch, or it and every module it requires -
 * its whole chain - from scratch. Either deletes code and starts at once: the
 * chat shows its box, as try it's, and turri's /regenerate runs under it. A module that requires none has no chain.
 */
export function RegenerateSheet({ spec, onClose, onRegenerate }: { spec: Spec; onClose: () => void; onRegenerate: (regeneration: Regeneration) => void }) {
  const chained = spec.requires.length > 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet regenerate" role="dialog" aria-label={`regenerate ${spec.module}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <h2>regenerate {spec.module} from scratch</h2>
        <p className="regenerate-says">
          {withPlain(`its code and conformance tests are deleted, and every functional spec is regenerated from ***plain.`)}{" "}
          {chained ? `with its whole chain, the modules it requires - ${spec.requires.join(", ")} - are too, from the bottom first.` : "it requires no other module, so it has no chain."}
        </p>
        <div className="sheet-actions">
          <button className="button" onClick={onClose}>
            cancel
          </button>
          <button className="button" onClick={() => onRegenerate({ how: "scratch", chain: true })} disabled={!chained} title={chained ? `${spec.module} and ${spec.requires.join(", ")}, from scratch` : `${spec.module} requires no other module`}>
            whole chain
          </button>
          <button className="button primary" onClick={() => onRegenerate({ how: "scratch", chain: false })} autoFocus>
            this module
          </button>
        </div>
      </div>
    </div>
  );
}
