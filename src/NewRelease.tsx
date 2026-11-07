import { useEffect, useState } from "react";
import type { UpdateState } from "../electron/updates.ts";
import { Icon } from "./ui.tsx";

/**
 * A newer turri desktop, said as the app starts - or once it is found, every few hours after: on GitHub, to download,
 * where this app cannot update itself (`available`), or downloaded and waiting for a restart (`ready`). Put away by its
 * ×, for this version, until the app starts again.
 */
export function NewRelease() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [put, setPut] = useState<string | null>(null);
  useEffect(() => {
    // What it is now, asked - unless a change was told meanwhile, which is newer.
    let told = false;
    void window.turri.updates.state().then((now) => told || setState(now), () => {});
    return window.turri.on("updates", (next: UpdateState) => ((told = true), setState(next)));
  }, []);
  if (state === null || (state.status !== "available" && state.status !== "ready") || put === state.version) return null;
  return (
    <div className="toast new-release" role="alert">
      <Icon name="warn" />
      {state.status === "available" ? (
        <>
          <span>turri {state.version} is out - please update.</span>
          <a className="button small primary" href={state.url} target="_blank" rel="noreferrer">
            download it
          </a>
        </>
      ) : (
        <>
          <span>turri {state.version} is downloaded - restart to update.</span>
          <button className="button small primary" onClick={() => void window.turri.updates.install()}>
            restart to update
          </button>
        </>
      )}
      <button className="icon-button" onClick={() => setPut(state.version)} title="not now - said again when turri next starts" aria-label="not now">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
