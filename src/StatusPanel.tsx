import { useEffect, useRef, useState, type ReactNode } from "react";
import { NoticeCard, type NoticeAnswer } from "./Chat.tsx";
import type { NoticeShown, Tone } from "./chats.ts";
import { Icon, withPlain } from "./ui.tsx";

/** What is wrong with a file of the project, as turri says it: there until it is put right - nothing to dismiss. */
export type Problem = {
  key: string;
  tone: "error" | "warning";
  file: string;
  rel: string;
  title: ReactNode;
  text: string;
  /** What the chat can do about it - "convert it". */
  action?: { label: string; run: () => void };
};

/** Something the window was told or found - a pulse ended, an engine call refused: kept until dismissed. */
export type Notification = { id: number; text: string; tone: Tone; at: number; action?: { label: string; run: () => void } };

/** How long the newest notification is said in the strip itself. */
const SAID_FOR = 6000;

/** The panel's height as it starts, and the least it is dragged to - kept between launches, per viewer. */
const PANEL_HEIGHT = 240;
const PANEL_LEAST = 120;
const HEIGHT_KEY = "turri-app.status-height";

/** As high as dragged, held to the window: the view above it keeps a little room. */
const clampHeight = (height: number) => Math.round(Math.max(PANEL_LEAST, Math.min(height, window.innerHeight - 200)));

function keptHeight(): number {
  try {
    const kept = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(kept) && kept > 0 ? clampHeight(kept) : PANEL_HEIGHT;
  } catch {
    return PANEL_HEIGHT;
  }
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The strip along the bottom of every view, as an IDE's: the project's problems counted, the newest notification said
 * for a moment, and the unread ones counted - and above it, opened from it, the panel listing either. Among the
 * notifications are turri's notices - the sentinel's, and turri's asking before the sentinel first opens - answered
 * there, the open ones first. A new error, or a notice to answer, opens it on its tab; nothing floats over the window.
 */
export function StatusPanel(props: {
  problems: Problem[];
  notifications: Notification[];
  notices: NoticeShown[];
  onOpenFile: (file: string) => void;
  onDismiss: (id: number) => void;
  /** A notice answered: turri's `done`, `dismissed`, `over`, `missing` or `refused`. */
  onAnswerNotice: (shown: NoticeShown, answer: NoticeAnswer) => Promise<string>;
  /** A notice that has ended, put away. */
  onPutAway: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Its height: dragged by its top edge, kept for next time.
  const [height, setHeight] = useState(keptHeight);
  // Where a drag of its edge started: the pointer's height, and the panel's.
  const dragging = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* not kept: it starts at 240 again */
    }
  }, [height]);
  const [tab, setTab] = useState<"problems" | "notifications">("problems");
  // Notifications up to this id have been seen in the panel.
  const [seenUpTo, setSeenUpTo] = useState(0);
  const [said, setSaid] = useState<Notification | null>(null);
  const errors = props.problems.filter((problem) => problem.tone === "error");
  const warnings = props.problems.length - errors.length;
  const unread = props.notifications.filter((note) => note.id > seenUpTo);
  const waiting = props.notices.filter((shown) => shown.ended === undefined);
  const ended = props.notices.filter((shown) => shown.ended !== undefined);
  const listed = props.notifications.length + props.notices.length;

  // A notice put to the person - one not there before - opens the panel on it: it waits on their answer.
  const asked = useRef(new Set<string>());
  const waitingIds = waiting.map((shown) => shown.notice.id).join("\n");
  useEffect(() => {
    const now = waitingIds === "" ? [] : waitingIds.split("\n");
    const fresh = now.some((id) => !asked.current.has(id));
    asked.current = new Set([...asked.current, ...now]);
    if (fresh) {
      setTab("notifications");
      setOpen(true);
    }
  }, [waitingIds]);

  // The error problems there were: one that is new opens the panel on them - those there as the project opened do not.
  const known = useRef<Set<string> | null>(null);
  const errorKeys = errors.map((problem) => problem.key).join("\n");
  useEffect(() => {
    const now = new Set(errorKeys === "" ? [] : errorKeys.split("\n"));
    const before = known.current;
    known.current = now;
    if (before !== null && [...now].some((key) => !before.has(key))) {
      setTab("problems");
      setOpen(true);
    }
  }, [errorKeys]);

  // The newest notification, said in the strip a moment; an error opens the panel on the notifications.
  const newest = props.notifications.at(-1);
  const handled = useRef(newest?.id ?? 0);
  useEffect(() => {
    if (newest === undefined || newest.id <= handled.current) return;
    handled.current = newest.id;
    setSaid(newest);
    if (newest.tone === "error") {
      setTab("notifications");
      setOpen(true);
    }
    const timer = setTimeout(() => setSaid((now) => (now?.id === newest.id ? null : now)), SAID_FOR);
    return () => clearTimeout(timer);
  }, [newest]);

  // Shown, they are read.
  const showing = open && tab === "notifications";
  const last = newest?.id ?? 0;
  useEffect(() => {
    if (showing) setSeenUpTo((now) => Math.max(now, last));
  }, [showing, last]);

  const show = (which: "problems" | "notifications") => {
    if (open && tab === which) return setOpen(false);
    setTab(which);
    setOpen(true);
  };

  return (
    <div className="status-panel">
      {open && (
        <div className="status-body" style={{ height }} onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
          {/* Its top edge: drag it up for more of the panel, down for less - double-click for the height it starts at. */}
          <div
            className="status-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="resize the panel"
            title="drag to resize the panel - double-click to reset"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = { y: event.clientY, height };
            }}
            onPointerMove={(event) => {
              const from = dragging.current;
              if (from === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setHeight(clampHeight(from.height + from.y - event.clientY));
            }}
            onPointerUp={(event) => {
              dragging.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onDoubleClick={() => setHeight(PANEL_HEIGHT)}
          />
          <div className="status-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "problems"} className={tab === "problems" ? "on" : ""} onClick={() => setTab("problems")}>
              problems {props.problems.length > 0 && <span className="status-count">{props.problems.length}</span>}
            </button>
            <button role="tab" aria-selected={tab === "notifications"} className={tab === "notifications" ? "on" : ""} onClick={() => setTab("notifications")}>
              notifications {listed > 0 && <span className="status-count">{listed}</span>}
            </button>
            <span className="status-tabs-end">
              {tab === "notifications" && props.notifications.length + ended.length > 0 && (
                <button className="link" onClick={props.onClear}>
                  clear all
                </button>
              )}
              <button className="icon-button" onClick={() => setOpen(false)} title="hide the panel" aria-label="hide the panel">
                <Icon name="x" size={14} />
              </button>
            </span>
          </div>
          {tab === "problems" ? (
            <ul className="status-list problems" role="tabpanel" aria-label="problems">
              {props.problems.length === 0 && <li className="status-none muted">no problems</li>}
              {props.problems.map((problem) => (
                <li key={problem.key} className={`problem ${problem.tone}`}>
                  <Icon name={problem.tone === "error" ? "error" : "warn"} size={14} />
                  <div>
                    <div className="problem-head">
                      <strong>{problem.title}</strong>
                      <button className="link problem-file" onClick={() => props.onOpenFile(problem.file)} title={`open ${problem.rel}`}>
                        {problem.rel}
                      </button>
                    </div>
                    <p>{withPlain(problem.text)}</p>
                  </div>
                  {problem.action !== undefined && (
                    <button className="button small" onClick={problem.action.run}>
                      {problem.action.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="status-list notifications" role="tabpanel" aria-label="notifications">
              {listed === 0 && <li className="status-none muted">no notifications</li>}
              {/* The notices waiting on an answer first, the oldest first; then the rest, the newest first. */}
              {waiting.map((shown) => (
                <li key={shown.notice.id} className="notice-item">
                  <NoticeCard notice={shown.notice} open ended={undefined} onAnswer={(answer) => props.onAnswerNotice(shown, answer)} />
                </li>
              ))}
              {[
                ...props.notifications.map((note) => ({ at: note.at, item: { note } as const })),
                ...ended.map((shown) => ({ at: Date.parse(shown.notice.at), item: { shown } as const })),
              ]
                .sort((a, b) => b.at - a.at)
                .map(({ item }) =>
                  "note" in item ? (
                    <li key={item.note.id} className={`notification ${item.note.tone}`}>
                      <Icon name={item.note.tone === "error" ? "error" : item.note.tone === "warning" ? "warn" : "bell"} size={14} />
                      <p>{withPlain(item.note.text)}</p>
                      {item.note.action !== undefined && (
                        <button className="link notification-action" onClick={item.note.action.run}>
                          {item.note.action.label}
                        </button>
                      )}
                      <span className="muted notification-at">{time(item.note.at)}</span>
                      <button className="icon-button" onClick={() => props.onDismiss(item.note.id)} title="dismiss" aria-label="dismiss">
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ) : (
                    <li key={item.shown.notice.id} className="notice-item">
                      <NoticeCard notice={item.shown.notice} open={false} ended={item.shown.ended} onAnswer={(answer) => props.onAnswerNotice(item.shown, answer)} />
                      <button className="icon-button" onClick={() => props.onPutAway(item.shown.notice.id)} title="put away" aria-label="put away">
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ),
                )}
            </ul>
          )}
        </div>
      )}
      <div className="status-strip">
        <button className={`status-problems ${open && tab === "problems" ? "on" : ""}`} onClick={() => show("problems")} title="problems" aria-label={`problems: ${errors.length} errors, ${warnings} warnings`}>
          <span className={errors.length > 0 ? "has-errors" : ""}>
            <Icon name="error" size={13} /> {errors.length}
          </span>
          <span className={warnings > 0 ? "has-warnings" : ""}>
            <Icon name="warn" size={13} /> {warnings}
          </span>
        </button>
        <span className={`status-said ${said?.tone ?? ""}`} aria-live="polite">
          {said !== null && withPlain(said.text)}
        </span>
        <button
          className={`status-bell ${open && tab === "notifications" ? "on" : ""} ${unread.length > 0 ? "unread" : ""}`}
          onClick={() => show("notifications")}
          title="notifications"
          aria-label={`notifications: ${unread.length} unread${waiting.length > 0 ? `, ${waiting.length} to answer` : ""}`}
        >
          <Icon name="bell" size={13} />
          {unread.length + waiting.length > 0 && (
            <span className={`status-count ${unread.some((note) => note.tone === "error") || waiting.some((shown) => shown.notice.severity === "error") ? "error" : ""}`}>{unread.length + waiting.length}</span>
          )}
        </button>
      </div>
    </div>
  );
}
