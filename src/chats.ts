import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatItem, ChatStats, Conclusion, Notice, NoticeState, Question, SkillProgress } from "./Chat.tsx";

/** A chat of turri's session, as the engine lists it: in the order they were opened. */
export type ChatInfo = {
  id: string;
  /** "new chat" until something is said in it, then its first message. */
  title: string;
  /** A turn running, or something said since it was last shown. */
  status: "idle" | "working" | "question" | "unread";
  shown: boolean;
  /** `sentinel` for turri's sentinel - no tab of its own: what it does of each pulse is in regen; none for the person's. */
  role?: string;
};

/** The person's chats in their order, then the sentinel's, whenever turri opened it. */
const inOrder = (chats: ChatInfo[]) => [...chats.filter((chat) => chat.role === undefined), ...chats.filter((chat) => chat.role !== undefined)];

/** What the window keeps of each chat: what it said, what it is doing, and what it asks. */
export type ChatState = {
  items: ChatItem[];
  /** What the person said while turri answered, waiting for its turn to end. */
  queued: string[];
  /** What waited, its turn stopped: back in the message box - `at` tells one from the next. */
  restored: { text: string; at: number } | null;
  streaming: ChatItem | null;
  busy: boolean;
  working: string | null;
  tools: Map<string, boolean>;
  statuses: Record<string, string>;
  questions: Question[];
  progress: SkillProgress | null;
  model: string | null;
  stats: ChatStats | null;
  /** The sentinel's notices open in it, by id: their cards' buttons are live only while they are. */
  notices: Set<string>;
  /** How each notice of it ended, as turri told the window while it was open. */
  over: Map<string, NoticeState>;
};

const EMPTY: ChatState = { items: [], queued: [], restored: null, streaming: null, busy: false, working: null, tools: new Map(), statuses: {}, questions: [], progress: null, model: null, stats: null, notices: new Set(), over: new Map() };

type History = { messages: ChatItem[]; queued?: string[]; model: string | null; stats: ChatStats; questions: Question[]; notices?: Notice[] };

/**
 * turri's chats in the window: each one's state, kept whether it is shown or not - a hidden chat goes on working, and
 * what it said and asks is there when it is shown - from the engine's events, each of the chat it is of.
 */
export function useChats({ onAsk, onError }: { onAsk: () => void; onError: (text: string) => void }) {
  const [list, setList] = useState<ChatInfo[]>([]);
  const [states, setStates] = useState<Map<string, ChatState>>(new Map());
  const update = useCallback((id: string, change: (state: ChatState) => Partial<ChatState>) => {
    setStates((all) => {
      const now = all.get(id) ?? EMPTY;
      return new Map(all).set(id, { ...now, ...change(now) });
    });
  }, []);
  /** Notes to put after a chat's history once it is read: a new project's config, said in its first chat. */
  const after = useRef(new Map<string, ChatItem[]>());
  /** The chats read from the engine already: one the engine tells of anew is read once. */
  const known = useRef(new Set<string>());

  /** A chat read from the engine: what was said in it, its model, how full it is, and what it asks now. */
  const load = useCallback(
    (id: string) =>
      void window.turri.call<History>("chatHistory", { chat: id }).then(
        ({ messages, queued = [], model, stats, questions, notices = [] }) => {
          const notes = after.current.get(id) ?? [];
          after.current.delete(id);
          update(id, () => ({ items: [...messages, ...notes], queued, model, stats, questions, notices: new Set(notices.map((notice) => notice.id)) }));
        },
        () => {},
      ),
    [update],
  );

  /** The chats of a project just opened - or of the window drawn again - read anew; `notes` after the first one's history. */
  const reset = useCallback(
    async (notes: ChatItem[] = []) => {
      setStates(new Map());
      after.current.clear();
      const chats = inOrder(await window.turri.call<ChatInfo[]>("chats").catch(() => [] as ChatInfo[]));
      setList(chats);
      known.current = new Set(chats.map((chat) => chat.id));
      if (chats[0] !== undefined && notes.length > 0) after.current.set(chats[0].id, notes);
      for (const chat of chats) load(chat.id);
    },
    [load],
  );

  useEffect(() => {
    const on = <T,>(event: string, handle: (id: string, data: T) => void) => window.turri.on(`engine:${event}`, ({ chat, data }: { chat: string; data: T }) => handle(chat, data));
    const off = [
      window.turri.on("engine:chats", (told: ChatInfo[]) => {
        const chats = inOrder(told);
        setList(chats);
        // One opened is read; one closed is let go.
        for (const chat of chats) if (!known.current.has(chat.id)) (known.current.add(chat.id), load(chat.id));
        const open = new Set(chats.map((chat) => chat.id));
        known.current = open;
        setStates((all) => new Map([...all].filter(([id]) => open.has(id))));
      }),
      on<ChatItem>("chat:message", (id, item) => update(id, (state) => ({ items: [...state.items, item] }))),
      on<{ texts: string[] }>("chat:queued", (id, { texts }) => update(id, () => ({ queued: texts }))),
      on<{ text: string }>("chat:restore", (id, { text }) => update(id, () => ({ restored: { text, at: Date.now() } }))),
      on<ChatItem | null>("chat:streaming", (id, item) => update(id, () => ({ streaming: item }))),
      on<{ busy: boolean }>("chat:busy", (id, { busy }) => update(id, (state) => ({ busy, working: busy ? state.working : null }))),
      on<{ text: string | null }>("chat:working", (id, { text }) => update(id, () => ({ working: text }))),
      on<{ id: string; running: boolean }>("chat:tool", (id, tool) => update(id, (state) => ({ tools: new Map(state.tools).set(tool.id, tool.running) }))),
      on<{ key: string; text: string | null }>("chat:status", (id, { key, text }) => update(id, (state) => ({ statuses: { ...state.statuses, [key]: text ?? "" } }))),
      on<{ level: string; text: string }>("chat:notify", (id, { level, text }) => {
        update(id, (state) => ({ items: [...state.items, { role: "note", text, level }] }));
        if (level === "error") onError(text.split("\n")[0]!);
      }),
      on<SkillProgress | null>("chat:progress", (id, progress) => update(id, () => ({ progress }))),
      on<{ model: string }>("chat:model", (id, { model }) => update(id, () => ({ model }))),
      on<ChatStats>("chat:stats", (id, stats) => update(id, () => ({ stats }))),
      on<Question>("chat:ask", (id, question) => {
        update(id, (state) => ({ questions: [...state.questions, question] }));
        onAsk();
      }),
      // A question over unanswered - declined, its turn stopped: its card put away.
      on<{ id: number }>("chat:unask", (id, { id: asked }) => update(id, (state) => ({ questions: state.questions.filter((question) => question.id !== asked) }))),
      // The sentinel's notices: open as each is put - its card is the transcript's - and over as it is answered or
      // superseded. One for a chat not shown waits there, its tab marked by turri: the window never switches to it.
      on<Notice>("chat:notice", (id, notice) => update(id, (state) => ({ notices: new Set(state.notices).add(notice.id) }))),
      on<Notice>("chat:noticeOver", (id, notice) => update(id, (state) => ({ notices: without(state.notices, notice.id), over: new Map(state.over).set(notice.id, notice.state) }))),
    ];
    return () => off.forEach((stop) => stop());
  }, [update, load, onAsk, onError]);

  const concluded = useMemo(
    () => new Map([...states.values()].flatMap((state) => state.items.flatMap((item): Array<[string, Conclusion]> => (item.role === "concluded" ? [[item.conclusion.job, item.conclusion]] : [])))),
    [states],
  );
  // The person's chats, as tabs: the sentinel is never one - it is followed, and what it did of a pulse is in regen.
  const theirs = list.filter((chat) => chat.role === undefined);
  const sentinelId = list.find((chat) => chat.role === "sentinel")?.id;
  const shownId = (theirs.find((chat) => chat.shown) ?? theirs[0])?.id ?? null;
  return {
    list: theirs,
    shownId,
    /** The sentinel's chat as the window keeps it - what it did and is doing - once turri has opened it. */
    sentinel: sentinelId !== undefined ? (states.get(sentinelId) ?? EMPTY) : null,
    /** Each pulse the sentinel is done with, by its id: as the person's chats were told of it. */
    concluded,
    /** The chat shown's state - empty until it is read. */
    shown: (shownId !== null ? states.get(shownId) : undefined) ?? EMPTY,
    /** The chats with a question waiting: marked so in the tabs. */
    asking: new Set([...states].filter(([, state]) => state.questions.length > 0).map(([id]) => id)),
    reset,
    /** The chat's first question answered: put away. */
    answered: (id: string) => update(id, (state) => ({ questions: state.questions.slice(1) })),
    /** A notice turri says is over already - answered elsewhere, superseded, or gone with its session: its card let go. */
    noticeGone: (id: string, notice: string) => update(id, (state) => ({ notices: without(state.notices, notice) })),
  };
}

function without<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
