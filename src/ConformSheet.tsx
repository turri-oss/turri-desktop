import type { Spec } from "./types.ts";
import { withPlain } from "./ui.tsx";

/**
 * Conform…, from the toolbar or the ***plain menu, as Regenerate… is regenerate's: the module's conformance tests from
 * scratch, or its whole chain's - turri's /conform from scratch. Either deletes tests and starts at once - the code
 * untouched: the chat shows its box and the command runs under it. A module that requires none has no chain. One
 * functional spec's tests are its mark's to conform. Never functional specs named with from scratch: turri refuses it.
 * With conformance tests off for the module, /conform turns them on first - said here, as it is more than this module's.
 */
export function ConformSheet({ spec, onClose, onConform }: { spec: Spec; onClose: () => void; onConform: (chain: boolean) => void }) {
  const chained = spec.requires.length > 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet regenerate" role="dialog" aria-label={`conform ${spec.module}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <h2>conform {spec.module} from scratch</h2>
        <p className="regenerate-says">
          {withPlain("its conformance tests are deleted where its code lives - kept in its history - and written again from its scenarios. its code is untouched, and so is every other module.")}{" "}
          {chained ? `with its whole chain, the tests of the modules it requires - ${spec.requires.join(", ")} - are written again too, from nothing.` : "it requires no other module, so it has no chain."}
        </p>
        {spec.conformanceTests === false && <p className="regenerate-says conform-turns-on">conformance tests are off for it: they are turned on first - conformance-tests: true - and stay on.</p>}
        <div className="sheet-actions">
          <button className="button" onClick={onClose}>
            cancel
          </button>
          <button className="button" onClick={() => onConform(true)} disabled={!chained} title={chained ? `${spec.module}'s and ${spec.requires.join(", ")}'s conformance tests, from scratch` : `${spec.module} requires no other module`}>
            whole chain
          </button>
          <button className="button primary" onClick={() => onConform(false)} autoFocus>
            this module
          </button>
        </div>
      </div>
    </div>
  );
}
