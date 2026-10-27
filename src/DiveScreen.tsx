import { Icon, Spinner } from "./ui.tsx";

/** The dive's sections, left to right: regen for now - what turri does, in all its detail. */
export type DiveSection = "regen";

/**
 * The dive: a whole screen of its own, in the window's place - no chat, no preview, no files - for what
 * is too detailed for the project's window. ‹ and the project's name go back to it, saying so when turri asks something
 * there meanwhile.
 */
export function DiveScreen({
  project,
  asking,
  running,
  testing,
  onWatch,
  onLeave,
  children,
}: {
  project: string;
  /** A chat asks something: said on the way back to it. */
  asking: boolean;
  /** Pulses running: regen's tab turns a spinner. */
  running: boolean;
  /** turri testing in the preview: an invitation to watch it, glowing - the dive is never left for it on its own. */
  testing: boolean;
  onWatch: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dive" role="region" aria-label="dive">
      <header className="dive-top">
        <button className={`button dive-back ${asking ? "asking" : ""}`} onClick={onLeave} title={asking ? "turri is asking you something" : `back to ${project}`}>
          <Icon name="back" size={14} /> {project}
          {asking && " · turri asks"}
        </button>
        {testing && (
          <button className="button dive-watch" onClick={onWatch} title="leave the dive for the preview, where turri is testing">
            <Icon name="eye" size={14} /> turri is testing - watch
          </button>
        )}
        {/* Its sections at the right, and its mark - the toolbar's bolt - last. */}
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected className="on">
            regen
            {running && <Spinner />}
          </button>
        </div>
        <span className="dive-mark" title="dive" aria-label="dive" role="img">
          <Icon name="bolt" />
        </span>
      </header>
      <section className="dive-content">{children}</section>
    </div>
  );
}
