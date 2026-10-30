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

/**
 * Something the window was told or found - a pulse ended, an engine call refused: kept until dismissed. The sentinel's -
 * what it concluded of a pulse - are its tab's, with its notices.
 */
export type Notification = { id: number; text: string; tone: Tone; at: number; action?: { label: string; run: () => void }; source?: "sentinel" };

type Tab = "problems" | "notifications" | "sentinel";

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
 * for a moment, and the unread ones counted - the window's, then the sentinel's - and above it, opened from it, the panel
 * listing them in three tabs. The sentinel's tab holds what the sentinel says: its notices - and turri's asking before it
 * first opens - answered there, the open ones first, and what it concluded of each pulse. A new error opens the panel on
 * the notifications, a notice to answer on the sentinel's; nothing floats over the window.
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
  /** The pulse a notice is about, by its id: its title, when this session has it - and opened in regen. */
  pulseOf: (job: string) => { title: string } | undefined;
  onOpenPulse: (job: string) => void;
  /** A notice to show - asked for from its pulse in regen: the panel opened on it, brought into view and marked a moment. */
  focus?: { id: string; at: number };
  /** A tab's notifications cleared - the sentinel's with its notices that have ended. */
  onClear: (tab: "notifications" | "sentinel") => void;
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
  const [tab, setTab] = useState<Tab>("problems");
  // Each tab's notifications up to this id have been seen in it.
  const [seen, setSeen] = useState({ notifications: 0, sentinel: 0 });
  const [said, setSaid] = useState<Notification | null>(null);
  const errors = props.problems.filter((problem) => problem.tone === "error");
  const warnings = props.problems.length - errors.length;
  const general = props.notifications.filter((note) => note.source !== "sentinel");
  const sentinel = props.notifications.filter((note) => note.source === "sentinel");
  const unread = general.filter((note) => note.id > seen.notifications);
  const unheard = sentinel.filter((note) => note.id > seen.sentinel);
  const waiting = props.notices.filter((shown) => shown.ended === undefined);
  const ended = props.notices.filter((shown) => shown.ended !== undefined);

  // A notice put to the person - one not there before - opens the panel on it: it waits on their answer.
  const asked = useRef(new Set<string>());
  const waitingIds = waiting.map((shown) => shown.notice.id).join("\n");
  useEffect(() => {
    const now = waitingIds === "" ? [] : waitingIds.split("\n");
    const fresh = now.some((id) => !asked.current.has(id));
    asked.current = new Set([...asked.current, ...now]);
    if (fresh) {
      setTab("sentinel");
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
    if (newest.tone === "error" && newest.source !== "sentinel") {
      setTab("notifications");
      setOpen(true);
    }
    const timer = setTimeout(() => setSaid((now) => (now?.id === newest.id ? null : now)), SAID_FOR);
    return () => clearTimeout(timer);
  }, [newest]);

  // Shown, a tab's are read.
  const last = { notifications: general.at(-1)?.id ?? 0, sentinel: sentinel.at(-1)?.id ?? 0 };
  useEffect(() => {
    if (open && tab !== "problems") setSeen((now) => (now[tab] >= last[tab] ? now : { ...now, [tab]: last[tab] }));
  }, [open, tab, last.notifications, last.sentinel]);

  // A notice asked for: the panel open on the sentinel's, the notice brought into view and marked.
  const list = useRef<HTMLUListElement>(null);
  const [marked, setMarked] = useState<string | null>(null);
  useEffect(() => {
    if (props.focus === undefined) return;
    setTab("sentinel");
    setOpen(true);
    setMarked(props.focus.id);
    const timer = setTimeout(() => setMarked((now) => (now === props.focus?.id ? null : now)), 2000);
    return () => clearTimeout(timer);
  }, [props.focus?.at]);
  useEffect(() => {
    if (marked !== null) list.current?.querySelector(`[data-notice="${CSS.escape(marked)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [marked, open, tab]);
  /** A notice's pulse, as its card links it: named by its title, or as its pulse when this session does not have it. */
  const pulseOf = (shown: NoticeShown) =>
    shown.notice.job === undefined ? undefined : { title: props.pulseOf(shown.notice.job)?.title ?? "its pulse", onOpen: () => props.onOpenPulse(shown.notice.job!) };

  const show = (which: Tab) => {
    if (open && tab === which) return setOpen(false);
    setTab(which);
    setOpen(true);
  };

  /** A notification's row: its tone, its words, what it opens, when - and dismissed. */
  const noteRow = (note: Notification) => (
    <li key={note.id} className={`notification ${note.tone}`}>
      <Icon name={note.tone === "error" ? "error" : note.tone === "warning" ? "warn" : note.source === "sentinel" ? "eye" : "bell"} size={14} />
      <p>{withPlain(note.text)}</p>
      {note.action !== undefined && (
        <button className="link notification-action" onClick={note.action.run}>
          {note.action.label}
        </button>
      )}
      <span className="muted notification-at">{time(note.at)}</span>
      <button className="icon-button" onClick={() => props.onDismiss(note.id)} title="dismiss" aria-label="dismiss">
        <Icon name="x" size={12} />
      </button>
    </li>
  );
  /** A notice's card, marked while asked for. */
  const noticeRow = (shown: NoticeShown) => (
    <li key={shown.notice.id} className={`notice-item ${marked === shown.notice.id ? "marked" : ""}`} data-notice={shown.notice.id}>
      <NoticeCard notice={shown.notice} open={shown.ended === undefined} ended={shown.ended} onAnswer={(answer) => props.onAnswerNotice(shown, answer)} pulse={pulseOf(shown)} />
      {shown.ended !== undefined && (
        <button className="icon-button" onClick={() => props.onPutAway(shown.notice.id)} title="put away" aria-label="put away">
          <Icon name="x" size={12} />
        </button>
      )}
    </li>
  );
  const tabButton = (which: Tab, count: number) => (
    <button role="tab" aria-selected={tab === which} className={tab === which ? "on" : ""} onClick={() => setTab(which)}>
      {which} {count > 0 && <span className="status-count">{count}</span>}
    </button>
  );
  const clearable = tab === "notifications" ? general.length > 0 : tab === "sentinel" && sentinel.length + ended.length > 0;

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
            {tabButton("problems", props.problems.length)}
            {tabButton("notifications", general.length)}
            {tabButton("sentinel", sentinel.length + props.notices.length)}
            <span className="status-tabs-end">
              {clearable && (
                <button className="link" onClick={() => props.onClear(tab as "notifications" | "sentinel")}>
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
          ) : tab === "notifications" ? (
            <ul className="status-list notifications" role="tabpanel" aria-label="notifications">
              {general.length === 0 && <li className="status-none muted">no notifications</li>}
              {[...general].reverse().map(noteRow)}
            </ul>
          ) : (
            <ul className="status-list sentinel" role="tabpanel" aria-label="sentinel" ref={list}>
              {sentinel.length + props.notices.length === 0 && <li className="status-none muted">nothing from the sentinel</li>}
              {/* The notices waiting on an answer first, the oldest first; then the rest, the newest first. */}
              {waiting.map(noticeRow)}
              {[
                ...sentinel.map((note) => ({ at: note.at, row: () => noteRow(note) })),
                ...ended.map((shown) => ({ at: Date.parse(shown.notice.at), row: () => noticeRow(shown) })),
              ]
                .sort((a, b) => b.at - a.at)
                .map(({ row }) => row())}
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
          aria-label={`notifications: ${unread.length} unread`}
        >
          <Icon name="bell" size={13} />
          {unread.length > 0 && <span className={`status-count ${unread.some((note) => note.tone === "error") ? "error" : ""}`}>{unread.length}</span>}
        </button>
        {/* The sentinel's, right of the window's: what it concluded not yet read, and its notices waiting on an answer. */}
        <button
          className={`status-sentinel ${open && tab === "sentinel" ? "on" : ""} ${unheard.length + waiting.length > 0 ? "unread" : ""}`}
          onClick={() => show("sentinel")}
          title="sentinel"
          aria-label={`sentinel: ${unheard.length} unread${waiting.length > 0 ? `, ${waiting.length} to answer` : ""}`}
        >
          <Icon name="eye" size={13} />
          {unheard.length + waiting.length > 0 && (
            <span className={`status-count ${waiting.some((shown) => shown.notice.severity === "error") ? "error" : ""}`}>{unheard.length + waiting.length}</span>
          )}
        </button>
      </div>
    </div>
  );
}
