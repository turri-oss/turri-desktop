import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Jellyfish, PlainMark, PlainName, Spinner, withPlain } from "./ui.tsx";
import { keys, MAC } from "./platform.ts";
import type { Concept } from "./types.ts";
import type { ChatInfo } from "./chats.ts";
import type { Attached } from "../electron/preload.ts";

/** The concepts the project's ***plain can name, as turri reads them - longest first - to colour where they are said. */
let conceptNames: string[] = [];
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A pattern of the concepts there are, by name: none, while there are none. */
const conceptsIn = () => (conceptNames.length === 0 ? null : new RegExp(`(${conceptNames.map(escapeRegExp).join("|")})`, "g"));

/** Words with the concepts in them coloured, as the ***plain colours them. */
function withConcepts(text: string): React.ReactNode {
  const pattern = conceptsIn();
  if (pattern === null) return text;
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <span key={index} className="plain-concept">{part}</span> : part));
}

/** The concepts that fit what is typed: those it starts first, then those with it anywhere in their name. */
function fitting(concepts: Concept[], typed: string): Concept[] {
  const word = typed.slice(1).toLowerCase();
  const starts = (concept: Concept) => concept.name.slice(1).toLowerCase().startsWith(word);
  return concepts
    .filter((concept) => concept.name.slice(1, -1).toLowerCase().includes(word) && concept.name.toLowerCase() !== typed.toLowerCase())
    .sort((a, b) => Number(starts(b)) - Number(starts(a)) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

/**
 * The tree's files a word is the start of - of its path, or of its name in its folder - those its path starts first.
 * No word yet: every one, to see what is there.
 */
function filesFitting(files: string[], word: string): string[] {
  const lower = word.toLowerCase();
  const byPath = (file: string) => file.toLowerCase().startsWith(lower);
  const byName = (file: string) => file.slice(file.lastIndexOf("/") + 1).toLowerCase().startsWith(lower);
  if (lower === "") return [...files].sort((a, b) => a.localeCompare(b));
  return files.filter((file) => file !== word && (byPath(file) || byName(file))).sort((a, b) => Number(byPath(b)) - Number(byPath(a)) || a.localeCompare(b));
}

/** The longest side and the size an attached image is sent at: a larger one is drawn smaller first, as the models take them. */
const IMAGE_SIDE = 2000;
const IMAGE_DATA = 4_500_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** An image as it can be sent - drawn smaller if it is too large, as a PNG or else a JPEG - or null for one that is not. */
async function sendable(image: { mimeType: string; data: string }): Promise<{ mimeType: string; data: string } | null> {
  const picture = new Image();
  picture.src = `data:${image.mimeType};base64,${image.data}`;
  try {
    await picture.decode();
  } catch {
    return null;
  }
  const scale = Math.min(1, IMAGE_SIDE / Math.max(picture.naturalWidth, picture.naturalHeight));
  if (scale === 1 && image.data.length <= IMAGE_DATA) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
  const drawn = canvas.getContext("2d")!;
  drawn.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png").split(",")[1]!;
  if (png.length <= IMAGE_DATA) return { mimeType: "image/png", data: png };
  // A JPEG has no transparency: drawn over white, not black.
  drawn.globalCompositeOperation = "destination-over";
  drawn.fillStyle = "#fff";
  drawn.fillRect(0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.6]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality).split(",")[1]!;
    if (jpeg.length <= IMAGE_DATA) return { mimeType: "image/jpeg", data: jpeg };
  }
  return null;
}

/** An attachment with its image as it can be sent - or, an image that cannot be, by its path alone. */
async function prepared(each: Attached): Promise<Attached> {
  if (each.image === undefined) return each;
  const image = await sendable(each.image);
  return image ? { ...each, image } : { name: each.name, path: each.path };
}

/** A file dropped or pasted, attached: an image with its bytes, any other by where it is - null for one not on disk. */
async function attachedFrom(file: File): Promise<Attached | null> {
  const path = window.turri.pathOf(file);
  if (IMAGE_TYPES.has(file.type)) {
    const data = await new Promise<string>((done, failed) => {
      const reader = new FileReader();
      reader.onload = () => done(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => failed(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => "");
    const attached = await prepared({ name: file.name || "pasted image", path, image: { mimeType: file.type, data } });
    if (attached.image !== undefined || path !== "") return attached;
  }
  return path === "" ? null : { name: file.name, path };
}

export type ChatItem =
  | { role: "user"; text: string; images?: string[] }
  | { role: "assistant"; text: string; thinking?: string; tools?: Array<{ id: string; name: string; args: unknown }>; error?: string }
  | { role: "toolResult"; id: string; name: string; text: string; isError: boolean; image?: string; background?: Background; file?: string }
  | { role: "note"; customType?: string; text: string; level?: string }
  | { role: "command"; text: string }
  | { role: "job"; id: string; summary: string; status: string; duration?: string; spent?: string; text: string }
  | { role: "notice"; notice: Notice }
  | { role: "noticeOver"; state: NoticeState; summary: string }
  | { role: "concluded"; conclusion: Conclusion }
  /** Where the sentinel's work on a pulse starts, in its chat: turri's brief of it, which the person does not read. */
  | { role: "sentinelPulse"; job: string | null }
  /** The test advisor's yes, which starts the turn that writes their testing scenarios: the functional specs, `module:func-id`. */
  | { role: "advisorVerdict"; specs: string[] }
  /** Background runs that did not do their work, which start the turn that says so: each its skill, and what it was to write. */
  | { role: "skillRun"; runs: Array<{ skill: string } & Omit<Background, "already">> };

/** A skill cultivate started in the background: the testing script it writes and the module it is for - or, running already, nothing new. */
type Background = { kind?: "unit" | "conformance"; plainFile?: string; already?: true };

/** A testing script by its kind, in turri's words. */
const SCRIPT = { unit: "unit testing script", conformance: "conformance testing script" } as const;

/** What the sentinel puts to the person, as turri gives it - or turri, asking before the sentinel first opens: a card in the status panel's notifications, its actions its buttons. */
export type Notice = {
  id: string;
  chat: string;
  severity: "error" | "warning" | "info";
  summary: string;
  evidence: string[];
  actions: Array<{ label: string; task: string }>;
  module?: string;
  pulse?: number;
  job?: string;
  /** What the person may leave as it is for good - a gap in the ***plain the build settled - so it is not raised again. */
  ignorable?: boolean;
  state: NoticeState;
  at: string;
};
export type NoticeState = "open" | "accepted" | "steered" | "dismissed" | "ignored" | "superseded";
/**
 * How the person answers a notice: one of its actions, by its index; their own words; not at all, this once; or - one
 * turri says may be - not at all, for good: the sentinel does not raise it again.
 */
export type NoticeAnswer = { action: number } | { steer: string } | { dismiss: true } | { ignore: true };

/** The sentinel done with a pulse: whether what it checked holds, and what it checked and found. */
export type Conclusion = { job: string; verdict: "holds" | "wrong"; summary: string; module?: string; pulse?: number };

/** A skill running in the chat, where it is in its phases: what turri's terminal draws above its input. */
export type SkillProgress = {
  skill: string;
  phases: Array<{ name: string; state: "done" | "now" | "todo" }>;
  /** "phase 2 of 4", "starting", an attempt after a gate sent it back. */
  where: string | null;
  /** The phase it is in and what it does: "stack - the language, frameworks, ...". */
  about: string | null;
};

/** How full the conversation's context is, and what its own model has cost - the pulses' cost is the work view's. */
export type ChatStats = { percent: number | null; tokens: number | null; contextWindow: number | null; cost: number; spent: number };

/**
 * What the project has spent since it opened, in dollars: the chats' own replies - every chat's - the pulses', regenerating
 * and conformance testing, the sentinel's, and turri's other agents', each by its role - null for a skill's.
 */
export type Spending = { chat: number; regeneration: number; sentinel: number; other: Array<{ role: string | null; cost: number }> };

export type Question = {
  id: number;
  kind: "select" | "confirm" | "input" | "editor" | "question";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};


/**
 * Talking to turri: the same conversations `turri` holds in the terminal - their tools, commands and questions - in the
 * window. Several can be open, each a tab: the one shown is drawn here.
 */
export function Chat(props: {
  /** The chat shown. */
  chatId: string | null;
  /** Every chat, in its order: tabs once there are two. */
  chats: ChatInfo[];
  /** The chats with a question waiting. */
  asking: Set<string>;
  /** Whether the turri running opens more chats than one. */
  canOpen: boolean;
  onNewChat: () => void;
  onShowChat: (id: string) => void;
  onCloseChat: (id: string) => void;
  items: ChatItem[];
  /** What was said while turri answered, waiting for its turn to end: shown at once, after it. */
  queued: string[];
  /** What waited when its turn was stopped: put back in the message box, before what is typed there. */
  restored: { text: string; at: number } | null;
  streaming: ChatItem | null;
  busy: boolean;
  working: string | null;
  running: Map<string, boolean>;
  statuses: Record<string, string>;
  model: string | null;
  /** A project with no spec yet: the hints start one. */
  fresh: boolean;
  /** What typing / offers: turri's commands, prompt templates and skills, as its chat has them. */
  commands: Array<{ name: string; description: string }>;
  /** What typing : offers: the concepts the project's ***plain can name, as turri reads them. */
  concepts: Concept[];
  /** What tab completes: the files the tree shows, relative to the project. */
  files: string[];
  onSend: (text: string, attached?: Attached[]) => void;
  onAbort: () => void;
  /** ctrl+c: what the chat does stopped - or, doing nothing, its draft cleared (`cleared`), or turri's session ended. */
  onInterrupt: (draft: boolean) => Promise<string>;
  /** ctrl+c at a question: declined - turri's own - or dismissed, the turn going on. */
  onDecline: (id: number) => void;
  onClose: () => void;
  /** What turri asks now - ask_user, a choice, a confirm - answered where the message box is, until it is answered. */
  question?: Question;
  onAnswer: (value: unknown) => void;
  progress: SkillProgress | null;
  stats: ChatStats | null;
  /** What the project has spent since it opened - the meter's figure, each part on hover. */
  spending: Spending | null;
  /** A concept said in the chat, clicked: opened where the ***plain defines it. */
  onShowConcept: (concept: string) => void;
  /** Whether any of the project's ***plain has changed since it was built: only then is regenerating what changed offered. */
  changed: boolean;
}) {
  // What is typed in each chat and not sent yet: kept as another chat is shown, and there again when it is back.
  const [draft, setDraftNow] = useState("");
  const drafts = useRef(new Map<string | null, string>());
  const setDraft = (text: string) => {
    drafts.current.set(props.chatId, text);
    setDraftNow(text);
  };
  // What is attached to it, kept with it the same way; and whether files are being dragged over the chat to attach.
  const [attached, setAttachedNow] = useState<Attached[]>([]);
  const attachments = useRef(new Map<string | null, Attached[]>());
  const setAttached = (next: Attached[]) => {
    attachments.current.set(props.chatId, next);
    setAttachedNow(next);
  };
  const [dropping, setDropping] = useState(false);
  conceptNames = props.concepts.map((concept) => concept.name).sort((a, b) => b.length - a.length);
  // Where the caret is in the message box, for the concept being typed there; the concept chosen in what is offered;
  // and where one started that escape put away.
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  // The files tab found for the word before the caret, more than one: offered while the draft is as it was.
  const [fileOffer, setFileOffer] = useState<{ draft: string; from: number; to: number; files: string[] } | null>(null);
  const [fileActive, setFileActive] = useState(0);
  const question = useLingering(props.question);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [props.items, props.queued, props.streaming, props.question?.id]);

  // ctrl+c, as in turri's terminal, wherever the focus is while the chat is open - but in the preview's terminal, whose
  // shell it is, and in the dive, which has no chat: a question asked declined - each one, however many in a row, the
  // turn going on; with none, what the chat shown is doing stopped; doing nothing, its draft cleared, and with none
  // turri left - the window closes. On Linux, where ctrl+c copies, what is selected is copied, and an editor outside the
  // chat keeps it.
  const latest = useRef({ props, draft, setDraft });
  latest.current = { props, draft, setDraft };
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") return;
      const at = event.target instanceof Element ? event.target : null;
      if (at?.closest(".xterm, .dive")) return;
      if (!MAC && (window.getSelection()?.toString() || (at?.closest("textarea, input, [contenteditable]") && !at.closest(".chat")))) return;
      event.preventDefault();
      const { props: now, draft: typed, setDraft: clear } = latest.current;
      if (now.question !== undefined) return now.onDecline(now.question.id);
      void now.onInterrupt(typed.trim() !== "").then((did) => did === "cleared" && clear(""), () => {});
    };
    // Escape, as in pi's terminal: what the chat shown is doing stopped - only that, never its draft cleared or turri
    // left. Heard first, so what Escape puts away - a sheet, a menu, a list offered, a question - is still there to see,
    // and is left to it; so are a field's own, the preview's terminal, the dive and the status panel.
    const escaped = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const at = event.target instanceof Element ? event.target : null;
      if (at?.closest(".xterm, .dive, .status-panel, input, select")) return;
      if (document.querySelector(".sheet-backdrop, [role=dialog], [role=menu], [role=listbox]")) return;
      const { props: now } = latest.current;
      if (now.question !== undefined || !now.busy) return;
      event.preventDefault();
      // As with a draft: a chat that turns out to be doing nothing is left as it is.
      void now.onInterrupt(true).catch(() => {});
    };
    window.addEventListener("keydown", pressed, true);
    window.addEventListener("keydown", escaped, true);
    return () => {
      window.removeEventListener("keydown", pressed, true);
      window.removeEventListener("keydown", escaped, true);
    };
  }, []);

  useEffect(() => {
    if (props.restored === null) return;
    const typed = drafts.current.get(props.chatId) ?? "";
    setDraft(typed.trim() === "" ? props.restored.text : `${props.restored.text}\n\n${typed}`);
    input.current?.focus();
  }, [props.restored?.at]);

  // Another chat shown: its own draft, its end in view, and the message box ready for it.
  useEffect(() => {
    setDraftNow(drafts.current.get(props.chatId) ?? "");
    setAttachedNow(attachments.current.get(props.chatId) ?? []);
    stick.current = true;
    input.current?.focus();
  }, [props.chatId]);

  // Results by the call they answer, shown under it.
  const results = new Map<string, Extract<ChatItem, { role: "toolResult" }>>();
  for (const item of props.items) if (item.role === "toolResult") results.set(item.id, item);

  /** Files attached, once read: to the chat they were attached in, whichever is shown by then. */
  const attach = async (coming: Promise<Array<Attached | null>>) => {
    const chat = props.chatId;
    const more = (await coming.catch((): Array<Attached | null> => [])).filter((each): each is Attached => each !== null);
    if (more.length === 0) return;
    const next = [...(attachments.current.get(chat) ?? []), ...more];
    attachments.current.set(chat, next);
    if (latest.current.props.chatId === chat) setAttachedNow(next);
    input.current?.focus();
  };
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");

  const send = () => {
    const text = draft.trim();
    if (text === "" && attached.length === 0) return;
    props.onSend(text, attached);
    setDraft("");
    setAttached([]);
    setCaret(0);
    stick.current = true;
  };

  const suggestions = draft.startsWith("/") && !draft.includes(" ") ? props.commands.filter((command) => command.name.startsWith(draft)) : [];
  // The concept being typed before the caret, as turri reads it - asked of the engine as the draft or the caret moves.
  const [typing, setTyping] = useState<{ typed: string; from: number } | null>(null);
  useEffect(() => {
    if (suggestions.length > 0 || props.concepts.length === 0) return setTyping(null);
    let alive = true;
    void window.turri.call<{ typed: string; from: number } | null>("conceptBeingTyped", { text: draft.slice(0, caret) }).then((next) => alive && setTyping(next), () => {});
    return () => void (alive = false);
  }, [draft, caret, suggestions.length, props.concepts]);
  const offered = typing !== null && dismissed !== typing.from ? fitting(props.concepts, typing.typed) : [];
  const chosen = Math.min(active, Math.max(0, offered.length - 1));
  useEffect(() => setActive(0), [typing?.typed]);

  /** A concept offered, taken: in place of what was typed of it - and of the rest of its name after the caret. */
  const take = (concept: Concept) => {
    if (typing === null) return;
    // What follows the caret of the concept's name already - `er:` of `:Us|er:` - is taken with it.
    const rest = concept.name.slice(typing.typed.length);
    let kept = 0;
    while (kept < rest.length && draft[caret + kept] === rest[kept]) kept++;
    const after = draft.slice(caret + kept);
    const space = /^\s/.test(after) ? "" : " ";
    const at = typing.from + concept.name.length + space.length;
    setDraft(draft.slice(0, typing.from) + concept.name + space + after);
    setCaret(at);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };
  /** A file, in place of the word before the caret it completes - and a space after it, unless one follows. */
  const takeFile = (from: number, to: number, file: string) => {
    const after = draft.slice(to);
    const space = /^\s/.test(after) ? "" : " ";
    const at = from + file.length + space.length;
    setDraft(draft.slice(0, from) + file + space + after);
    setCaret(at);
    setFileOffer(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };
  /**
   * Tab: the word before the caret completed to the one file it starts, or the files it could be offered - and, no word
   * begun, every file offered, none taken: a look at what is there.
   */
  const completeFile = () => {
    const before = draft.slice(0, caret);
    const from = before.search(/\S*$/);
    const word = before.slice(from);
    const found = filesFitting(props.files, word);
    if (found.length === 1 && word !== "") takeFile(from, caret, found[0]!);
    else if (found.length > 0) {
      setFileOffer({ draft, from, to: caret, files: word === "" ? found : found.slice(0, 8) });
      setFileActive(0);
    }
    return found.length > 0;
  };
  // The file chosen with the arrows kept in view, as the whole tree offered scrolls.
  useEffect(() => {
    input.current?.closest(".composer")?.querySelector(".suggestions.files li.on")?.scrollIntoView({ block: "nearest" });
  }, [fileActive, fileOffer]);
  const filesOffered = fileOffer !== null && fileOffer.draft === draft && offered.length === 0 ? fileOffer.files : [];
  const statusLine = Object.values(props.statuses).filter(Boolean).join(" · ");

  return (
    <aside
      className="chat"
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        void attach(Promise.all([...event.dataTransfer.files].map(attachedFrom)));
      }}
    >
      {dropping && <div className="chat-drop">drop to attach to your message</div>}
      <div className="titlebar-space chat-top">
        {props.canOpen ? <ChatTabs {...props} /> : <span className="chat-tabs-room" />}
        <button className="icon-button" onClick={props.onClose} title={`hide the chat (${keys("J")})`}>
          <Icon name="x" />
        </button>
      </div>
      <div
        className="chat-body"
        // A concept said - in turri's words, the person's or a ***plain block - opens where it is defined: not when the
        // click ends a selection of its text.
        onClick={(event) => {
          const concept = (event.target as HTMLElement).closest(".plain-concept");
          if (concept !== null && !window.getSelection()?.toString()) props.onShowConcept(concept.textContent ?? "");
        }}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {/* Nothing said yet - notes aside, such as a new project's config - so how to begin is shown. */}
        {props.items.every((item) => item.role === "note") && !props.streaming && props.queued.length === 0 && (
          <div className="chat-empty">
            <Jellyfish size={110} lifecycle />
            <p>tell turri what you want to build, or what to change. it writes the <PlainName /> with you, then regenerates the code from it.</p>
            {props.fresh ? (
              <>
                <button
                  className="hint"
                  onClick={() => {
                    setDraft("I want to build ");
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  i want to build…
                </button>
                <button className="hint" onClick={() => props.onSend("Help me work out what to build: ask me what you need to know, then write the first ***plain.")}>
                  help me work out what to build
                </button>
              </>
            ) : (
              ["what does this project do?", "add a way to delete a message", ...(props.changed ? ["regenerate what changed"] : [])].map((hint) => (
                <button key={hint} className="hint" onClick={() => props.onSend(hint)}>
                  {hint}
                </button>
              ))
            )}
          </div>
        )}
        {/* turri's notices are the status panel's, not the conversation's: answered there, whichever chat they are of. */}
        {props.items.map((item, index) =>
          item.role === "toolResult" || item.role === "notice" || item.role === "noticeOver" || item.role === "concluded" ? null : (
            <Message key={index} item={item} results={results} running={props.running} />
          ),
        )}
        {props.streaming && <Message item={props.streaming} results={results} running={props.running} live />}
        {props.busy && !props.streaming && (
          <div className="chat-working">
            <Jellyfish size={21} /> {props.working ?? "thinking"}
          </div>
        )}
        {props.queued.map((text, index) => (
          <div key={index} className="msg user queued">
            {withConcepts(text)}
            <span className="queued-note">waiting - turri has not read this yet</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {props.progress && <ProgressBar progress={props.progress} />}
      {question ? (
        // Known by what it asks, not its id: a question asked again - a box ticked, the rest still to choose - is the
        // same card, changed in place.
        <QuestionCard key={question.title} question={question} waiting={props.question === undefined} onAnswer={props.onAnswer} />
      ) : (
      <div className="composer">
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map(({ name, description }) => (
              <li key={name} onMouseDown={(event) => (event.preventDefault(), setDraft(`${name} `))}>
                <strong>{name}</strong> <span className="muted">{description}</span>
              </li>
            ))}
          </ul>
        )}
        {offered.length > 0 && (
          <ul className="suggestions concepts" role="listbox" aria-label="concepts">
            {offered.map((concept, index) => (
              <li
                key={concept.name}
                role="option"
                aria-selected={index === chosen}
                className={index === chosen ? "on" : ""}
                onMouseDown={(event) => (event.preventDefault(), take(concept))}
                onMouseEnter={() => setActive(index)}
              >
                <span className="plain-concept">{concept.name}</span>
                <span className="muted concept-about">{concept.about}</span>
                <span className="concept-from">{withPlain(concept.from)}</span>
              </li>
            ))}
          </ul>
        )}
        {filesOffered.length > 0 && (
          <ul className="suggestions files" role="listbox" aria-label="files">
            {filesOffered.map((file, index) => (
              <li
                key={file}
                role="option"
                aria-selected={index === fileActive}
                className={index === fileActive ? "on" : ""}
                onMouseDown={(event) => (event.preventDefault(), takeFile(fileOffer!.from, fileOffer!.to, file))}
                onMouseEnter={() => setFileActive(index)}
              >
                {file.endsWith(".plain") ? <PlainMark size={12} /> : <Icon name="file" size={12} />}
                <span>{file}</span>
              </li>
            ))}
          </ul>
        )}
        {attached.length > 0 && (
          <ul className="attachments" aria-label="attached">
            {attached.map((each, index) => (
              <li key={`${index}:${each.path || each.name}`} title={each.path || each.name}>
                {each.image ? <img src={`data:${each.image.mimeType};base64,${each.image.data}`} alt="" /> : <Icon name="file" size={14} />}
                <span>{each.name}</span>
                <button className="icon-button" aria-label={`remove ${each.name}`} onClick={() => setAttached(attached.filter((_, at) => at !== index))}>
                  <Icon name="x" size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={input}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          placeholder={props.busy ? "turri hears this when it finishes its turn…" : "talk to turri - or / for a command"}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          // Files pasted - a screenshot, or files copied in Finder - are attached, not typed.
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void attach(Promise.all(files.map(attachedFrom)));
          }}
          onKeyDown={(event) => {
            // A concept offered: the arrows choose, enter or tab takes it, escape puts the list away.
            if (offered.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((chosen + (event.key === "ArrowDown" ? 1 : offered.length - 1)) % offered.length);
                return;
              }
              if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                event.preventDefault();
                take(offered[chosen]!);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissed(typing!.from);
                return;
              }
            }
            // Files offered: the same - the arrows choose, enter or tab takes one, escape puts them away.
            if (filesOffered.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setFileActive((fileActive + (event.key === "ArrowDown" ? 1 : filesOffered.length - 1)) % filesOffered.length);
                return;
              }
              if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                event.preventDefault();
                takeFile(fileOffer!.from, fileOffer!.to, filesOffered[fileActive]!);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setFileOffer(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
            if (event.key === "Tab" && suggestions.length > 0) {
              event.preventDefault();
              setDraft(`${suggestions[0]!.name} `);
            } else if (event.key === "Tab" && !event.shiftKey && draft === "") {
              // Nothing typed: the commands, as / offers them - what there is to do.
              event.preventDefault();
              setDraft("/");
              setCaret(1);
            } else if (event.key === "Tab" && !event.shiftKey) {
              // Tab is the box's: it completes what it can and otherwise does nothing - the focus stays here.
              event.preventDefault();
              completeFile();
            }
          }}
        />
        <div className="composer-bar">
          {/* How full, what it cost, and the model it is with - together at the foot's left. */}
          <span className="composer-meta">
            {props.stats && <ChatMeter stats={props.stats} spending={props.spending} />}
            {props.model && <span className="chat-model" title={props.model}>{props.model.split("/").at(-1)}</span>}
          </span>
          <span className="muted small composer-status">{statusLine}</span>
          <span className="composer-actions">
            <button className="icon-button" onClick={() => void attach(window.turri.attach().then((chosen) => Promise.all(chosen.map(prepared))))} title="attach files or images - or drop them on the chat" aria-label="attach files">
              <Icon name="clip" size={15} />
            </button>
            {props.busy ? (
              <button className="button small" onClick={props.onAbort} title="stop what turri is doing - esc, or ctrl+c">
                <Icon name="stop" size={13} /> stop
              </button>
            ) : (
              <button className="button small primary" onClick={send} disabled={draft.trim() === "" && attached.length === 0}>
                send <kbd>↩</kbd>
              </button>
            )}
          </span>
        </div>
      </div>
      )}
    </aside>
  );
}

function Message({
  item,
  results,
  running,
  live,
}: {
  item: ChatItem;
  results: Map<string, Extract<ChatItem, { role: "toolResult" }>>;
  running: Map<string, boolean>;
  live?: boolean;
}) {
  const [thinking, setThinking] = useState(false);
  if (item.role === "user")
    return (
      <div className="msg user">
        {item.images && (
          <div className="msg-images">
            {item.images.map((image, index) => (
              <img key={index} src={image} alt="an image attached" />
            ))}
          </div>
        )}
        {withConcepts(item.text)}
      </div>
    );
  if (item.role === "command") return <div className="msg user command">{item.text}</div>;
  // A pulse that ended: one line - what it was, how it ended, how long and what it cost - coloured by its kind, as the
  // work view colours it. A click opens what it built in the ***plain view, lit - one that went wrong, or built no
  // ***plain, its card in regen: the chat stays a conversation.
  // Where a turn of the chat's own comes from when nobody typed: the test advisor's yes, which the person does not read -
  // the chat says it, and writes the scenarios.
  if (item.role === "advisorVerdict")
    return (
      <div className="msg advisor-verdict">
        <Icon name="test" size={13} /> testing scenarios evaluated
        {item.specs.length > 0 && <span className="muted"> · {item.specs.join(", ")}</span>}
      </div>
    );
  // Where a turn comes from when a background run did not do its work: the chat says what went wrong.
  if (item.role === "skillRun")
    return (
      <div className="msg advisor-verdict skill-run">
        <Icon name="test" size={13} />{" "}
        {item.runs.map((run, index) => (
          <span key={index}>
            {index > 0 && <span className="muted"> · </span>}
            {run.kind !== undefined ? `${SCRIPT[run.kind]} not written` : `${run.skill} did not finish`}
            {run.plainFile !== undefined && <span className="muted"> · {run.plainFile}</span>}
          </span>
        ))}
      </div>
    );
  if (item.role === "note") {
    return (
      <div className={`msg note ${item.level ?? ""} ${item.customType === "turri_command_echo" ? "echo" : ""}`}>
        <Prose text={item.text} />
      </div>
    );
  }
  if (item.role !== "assistant") return null;
  return (
    <div className={`msg assistant ${live ? "live" : ""}`}>
      {item.thinking && (
        <button className="thinking-toggle" onClick={() => setThinking(!thinking)}>
          {thinking ? "hide thinking" : "thought about it"}
        </button>
      )}
      {thinking && item.thinking && <div className="thinking">{item.thinking}</div>}
      {item.text && <Prose text={item.text} />}
      {item.tools?.map((tool) => (
        <ToolCall key={tool.id} tool={tool} result={results.get(tool.id)} running={running.get(tool.id) === true} />
      ))}
      {item.error && <div className="msg-error">{item.error}</div>}
    </div>
  );
}

/**
 * A conversation drawn to read only - what the sentinel did of a pulse, in regen: its replies and its tools' calls and
 * results, as the chat draws them, with nothing to answer or follow.
 */
export function Transcript({ items, running }: { items: ChatItem[]; running: Map<string, boolean> }) {
  const results = new Map<string, Extract<ChatItem, { role: "toolResult" }>>();
  for (const item of items) if (item.role === "toolResult") results.set(item.id, item);
  return (
    <div className="transcript-read">
      {items.map((item, index) => (item.role === "toolResult" ? null : <Message key={index} item={item} results={results} running={running} />))}
    </div>
  );
}

const SENTINEL_NAME = "sentinel";

/** A pulse, as its line in the chat names it: its module, and what it is - regenerating, or a conformance run. */
export type PulseNamed = { module?: string | null; kind: string };

/** How a pulse ended, in a word: what the person needs, nothing of its time or cost. */
const ENDED_AS: Record<string, string> = { succeeded: "finished", failed: "failed", stopped: "stopped", incomplete: "did not finish" };

/** A pulse's line in the chat, as plain as it gets: `server · regeneration finished`, `server · conformance failed`. */
export function pulseLine(module: string | null | undefined, kind: "regenerate" | "conformance", status: string): string {
  const what = `${kind === "conformance" ? "conformance" : "regeneration"} ${ENDED_AS[status] ?? status}`;
  return module ? `${module} · ${what}` : what;
}

/** How a notice ended, as its card says it. */
const ENDED: Record<Exclude<NoticeState, "open">, string> = {
  accepted: "accepted",
  steered: "answered in your words",
  dismissed: "dismissed",
  ignored: "ignored - left as the build has it, not raised again",
  superseded: "superseded by a newer notice",
};

/**
 * What the sentinel puts to the person: a card among the status panel's notifications - how grave, what it is about,
 * what is wrong and what shows it - with what can be done as buttons, the person's own words, or nothing. It docks
 * nowhere and blocks nothing: the person can go on talking. Its buttons are live while it is open; then it says how it
 * ended.
 */
export function NoticeCard({
  notice,
  open,
  ended,
  onAnswer,
  pulse,
}: {
  notice: Notice;
  open: boolean;
  ended: NoticeState | undefined;
  onAnswer: (answer: NoticeAnswer) => Promise<string>;
  /** The pulse it is about - a sentinel is always of one - named, and opened in regen on what the sentinel did. */
  pulse?: { title: string; onOpen: () => void };
}) {
  const [steering, setSteering] = useState(false);
  const [words, setWords] = useState("");
  // Answered here, and turri not yet saying it is over: its buttons rest.
  const [sent, setSent] = useState(false);
  const live = open && ended === undefined;
  const answer = (given: NoticeAnswer) => {
    setSent(true);
    // Refused - ignore, on one that may not be - it is still open: its buttons back.
    void onAnswer(given).then(
      (did) => did === "refused" && setSent(false),
      () => setSent(false),
    );
  };
  const steer = () => {
    if (words.trim() === "") return;
    answer({ steer: words.trim() });
  };
  // The sentinel and the module it is about: the pulse's number is regen's to say.
  const about = [SENTINEL_NAME, notice.module].filter(Boolean).join(" · ");
  const ending = ended !== undefined && ended !== "open" ? ENDED[ended] : live ? null : "no longer open";
  return (
    <section className={`msg notice-card ${notice.severity} ${live ? "open" : "over"}`} aria-label={`notice: ${notice.summary}`}>
      <div className="notice-head">
        <span className={`notice-mark ${notice.severity}`} aria-label={notice.severity}>
          <Icon name={notice.severity === "info" ? "dot" : "warn"} size={14} />
        </span>
        <span className="notice-about">
          <Icon name="eye" size={13} />
          {about}
        </span>
        {pulse !== undefined && (
          <button className="link notice-pulse" onClick={pulse.onOpen} title="open the pulse in regen, on what the sentinel did of it">
            {withPlain(pulse.title)} <Icon name="chevron" size={11} />
          </button>
        )}
      </div>
      <div className="notice-summary">
        <Prose text={notice.summary} />
      </div>
      {notice.evidence.length > 0 && (
        <ul className="notice-evidence">
          {notice.evidence.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {live ? (
        steering ? (
          <div className="notice-steer">
            <textarea
              autoFocus
              rows={2}
              placeholder="what should turri do about it?"
              value={words}
              disabled={sent}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  steer();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSteering(false);
                }
              }}
            />
            <div className="notice-actions">
              <button className="button small" disabled={sent} onClick={() => setSteering(false)}>
                back
              </button>
              <button className="button small primary" disabled={sent || words.trim() === ""} onClick={steer}>
                send <kbd>↩</kbd>
              </button>
            </div>
          </div>
        ) : (
          <div className="notice-actions">
            {notice.actions.map((action, index) => (
              <button key={index} className={`button small ${index === 0 ? "primary" : ""}`} disabled={sent} title={action.task} onClick={() => answer({ action: index })}>
                {withPlain(action.label)}
              </button>
            ))}
            <button className="button small" disabled={sent} onClick={() => setSteering(true)}>
              say what to do instead…
            </button>
            {/* Left as it is for good: on what turri says may be - a gap in the ***plain the build settled. */}
            {notice.ignorable === true && (
              <button className="button small notice-ignore" disabled={sent} title="leave it as the build has it - the sentinel will not raise it again" onClick={() => answer({ ignore: true })}>
                ignore
              </button>
            )}
            <button className="button small notice-dismiss" disabled={sent} title="nothing done, this time" onClick={() => answer({ dismiss: true })}>
              dismiss
            </button>
          </div>
        )
      ) : (
        <div className="notice-ended">{ending}</div>
      )}
    </section>
  );
}

/** What a tool call says it does, in words: the turri tools by what they mean, the rest by name. */
function describeTool(name: string, args: any, background?: Background, wrote?: string): string {
  const file = args?.path ?? args?.file ?? args?.plain_file ?? args?.plainFile;
  switch (name) {
    case "read":
      return `read ${file ?? "a file"}`;
    case "write":
      return `wrote ${file ?? "a file"}`;
    case "edit":
      return `edited ${file ?? "a file"}`;
    case "bash":
      return `ran ${String(args?.command ?? "a command").split("\n")[0]}`;
    case "ask_user":
      return `asked you: ${args?.question ?? ""}`;
    case "doctor":
      return args?.models === true ? "checked this machine, and asked the models" : "checked this machine";
    // turri's ***plain read alone - no code, no tests - named validate before parse.
    case "parse":
    case "validate":
      return `parsed ${args?.target === undefined || args.target === "." || args.target === "./" ? "the project" : args.target}`;
    case "browser_navigate":
      return `opened ${args?.url ?? "the app"} in the preview`;
    case "browser_screenshot":
      return "looked at the preview";
    case "browser_read":
      return "read the preview";
    case "browser_console":
      return "read the preview's console";
    case "browser_click":
      return `clicked ${args?.ref !== undefined ? `[${args.ref}]` : args?.text !== undefined ? `"${args.text}"` : args?.x !== undefined ? `at ${args.x}, ${args.y}` : (args?.selector ?? "")} in the preview`;
    case "terminal_screenshot":
      return "looked at the terminal";
    case "terminal_press":
      return `pressed ${Array.isArray(args?.keys) ? args.keys.join(", ") : "keys"} in the terminal`;
    case "terminal_click":
      return `clicked ${args?.text !== undefined ? `"${args.text}"` : `at row ${args?.row}, column ${args?.column}`} in the terminal`;
    case "terminal_scroll":
      return `scrolled ${args?.direction ?? ""} in the terminal`;
    case "browser_type":
      return `typed "${args?.text ?? ""}" in the preview`;
    // Conformance tests turned on, the person having asked for them or agreed: where it was written, once it is.
    case "turn_on_conformance_tests":
      return wrote !== undefined ? `conformance tests turned on - written in ${wrote}` : "turning on conformance tests";
    // The functional specs named, or every one of the module's with scenarios.
    case "conform":
      return `conformance testing ${Array.isArray(args?.funcIds) && args.funcIds.length > 0 ? args.funcIds.join(", ") : (args?.plain_file ?? "the functional specs with scenarios")}`;
    case "evaluate_tests":
      return `evaluating testing scenarios for ${Array.isArray(args?.funcIds) ? args.funcIds.join(", ") : "functional specs"}, in the background`;
    case "cultivate": {
      // A skill started in the background says what it writes, once its result says so; the others, the skill.
      const what = background?.kind !== undefined ? `the ${SCRIPT[background.kind]}${background.plainFile !== undefined ? ` for ${background.plainFile}` : ""}` : undefined;
      if (background?.already) return what !== undefined ? `${what} already being written, in the background` : `${args?.skill ?? "a skill"} already running, in the background`;
      if (background !== undefined) return what !== undefined ? `writing ${what}, in the background` : `${args?.skill ?? "a skill"}, in the background`;
      return `${args?.skill ?? "a skill"}${file ? ` · ${file}` : ""}`;
    }
    default:
      return `${name.replace(/_/g, " ")}${file ? ` · ${file}` : ""}`;
  }
}

function ToolCall({ tool, result, running }: { tool: { id: string; name: string; args: unknown }; result?: Extract<ChatItem, { role: "toolResult" }>; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-call ${result?.isError ? "error" : ""}`}>
      <button onClick={() => setOpen(!open)}>
        {running ? <Spinner /> : result?.isError ? <Icon name="warn" size={13} /> : <Icon name="check" size={13} />}
        <span>{describeTool(tool.name, tool.args, result?.background, result?.file)}</span>
      </button>
      {open && (
        <div className="tool-detail">
          <pre>{JSON.stringify(tool.args, null, 2)}</pre>
          {result?.image && <img className="tool-image" src={result.image} alt="what turri saw in the preview" />}
          {result && <pre className="tool-result">{result.text}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * What turri says, as the Markdown it is written in - paragraphs, lists, headings, tables, code, links, and its
 * escapes: an escaped ***plain shows as ***plain. Raw HTML in it is shown as text, never run in the window; a link opens
 * in the browser.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const linkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noreferrer");
  return linkOpen(tokens, index, options, env, self);
};

type Token = { text: string; role: string | null };

type DiffLine = { kind: "file" | "hunk" | "add" | "del" | "same"; marker: string; text: string };

/** A diff's lines: its file and hunk headers whole, the others their marker and what follows it. */
function diffLines(code: string): DiffLine[] {
  let inHunk = false;
  return code
    .replace(/\n$/, "")
    .split("\n")
    .map((line): DiffLine => {
      if (line.startsWith("@@")) return (inHunk = true), { kind: "hunk", marker: line, text: "" };
      if (!inHunk && /^(---|\+\+\+|diff |index )/.test(line)) return { kind: "file", marker: line, text: "" };
      const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "same";
      return { kind, marker: /^[+\- \\]/.test(line) ? line.slice(0, 1) : "", text: /^[+\- \\]/.test(line) ? line.slice(1) : line };
    });
}

/** A diff of ***plain - its files' names say so, or its fence (```diff plain) - is coloured as the ***plain is. */
const ofPlain = (code: string, attrs: string) => attrs.split(/\s+/).includes("plain") || /^(---|\+\+\+) \S*\.plain\b/m.test(code);

/** A block with no language that is ***plain all the same: it has a section of its own - ***definitions***, say. */
const looksPlain = (code: string) => /^\*\*\*[a-z][a-z ]*\*\*\*\s*$/m.test(code);

/**
 * The ***plain a block holds, to colour: a ```plain block's text - or a block with no language that looks it - or a diff
 * of ***plain's lines without their markers.
 */
function plainIn(code: string, lang: string, attrs: string): string | null {
  if (lang === "plain" || (lang === "" && looksPlain(code))) return code.replace(/\n$/, "");
  if (lang === "diff" && ofPlain(code, attrs)) return diffLines(code).map((line) => line.text).join("\n");
  return null;
}

// A ```plain block is coloured as the ***plain is, by turri's grammar: the engine's, asked for each block once, so a
// block shows plain until its colours are back. A ```diff block is coloured as a pulse's diff is in work - and its
// ***plain by the grammar too, when it is a diff of ***plain.
const plainColours = new Map<string, Token[][]>();
const escape = markdown.utils.escapeHtml;
const colour = (text: string, tokens: Token[] | undefined) =>
  tokens !== undefined && tokens.map((token) => token.text).join("") === text
    ? tokens.map((token) => (token.role ? `<span class="plain-${token.role}">${escape(token.text)}</span>` : escape(token.text))).join("")
    : escape(text);
markdown.set({
  highlight: (code, lang, attrs) => {
    const plain = plainIn(code, lang, attrs);
    const lines = plain === null ? undefined : plainColours.get(plain);
    if (lang === "diff") {
      const html = diffLines(code)
        .map((line, index) => `<span class="line ${line.kind}">${escape(line.marker)}${colour(line.text, lines?.[index])}${line.marker + line.text === "" ? "\u200b" : ""}</span>`)
        .join("");
      return `<pre class="diff"><code>${html}</code></pre>`;
    }
    if (lines === undefined) return "";
    return `<pre class="plain-code"><code>${plain!.split("\n").map((text, index) => colour(text, lines[index])).join("\n")}</code></pre>`;
  },
});

// ***plain in what turri writes, written as its name is - in its words, never in its code.
const PLAIN_NAME = '<span class="plain-name"><img class="plain-mark" src="./plain/plain-mark.svg" alt="***" draggable="false">plain</span>';
// Its concepts - `:User:` - coloured as the ***plain colours them, in its words too.
markdown.renderer.rules.text = (tokens, index) =>
  escape(tokens[index]!.content)
    .replace(conceptsIn() ?? /$^/, '<span class="plain-concept">$1</span>')
    .replaceAll("***plain", PLAIN_NAME);

export function Prose({ text }: { text: string }) {
  const [coloured, setColoured] = useState(0);
  const html = useMemo(() => markdown.render(text), [text, coloured]);
  useEffect(() => {
    const blocks = markdown
      .parse(text, {})
      .filter((token) => token.type === "fence")
      .map((token) => {
        const [lang = "", ...attrs] = token.info.trim().split(/\s+/);
        return plainIn(token.content, lang, attrs.join(" "));
      })
      .filter((code): code is string => code !== null && !plainColours.has(code));
    if (blocks.length === 0) return;
    let alive = true;
    // While turri is still writing a block it changes with each word: asked once it settles.
    const timer = setTimeout(() => {
      void Promise.all(blocks.map((code) => window.turri.call<Token[][]>("highlightSpec", { text: code }).then((lines) => plainColours.set(code, lines)))).then(
        () => alive && setColoured((count) => count + 1),
      );
    }, 80);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** turri asking: a sheet over the window, as a native app asks - options to pick, or words to type. */
/**
 * A skill's phases, above the message box while it runs: the ones done
 * ticked, the one it is in turning, the rest to come, joined by a line filled as far as it has got; and under them
 * what the phase it is in does.
 */
function ProgressBar({ progress }: { progress: SkillProgress }) {
  const current = progress.phases.find((phase) => phase.state === "now")?.name;
  // "build - what it does" under a bar that already says build: what it does, alone.
  const about = progress.about && current && progress.about.startsWith(`${current} - `) ? progress.about.slice(current.length + 3) : progress.about;
  return (
    <div className="skill-progress" role="status" aria-label={`${progress.skill}${progress.where ? `, ${progress.where}` : ""}`}>
      <div className="skill-progress-head">
        <strong>{progress.skill}</strong>
        {progress.phases.length === 0 && <Spinner />}
        {progress.where && <span className="muted">{progress.where}</span>}
      </div>
      {progress.phases.length > 0 && (
        <ol className="skill-phases">
          {progress.phases.map((phase) => (
            <li key={phase.name} className={phase.state}>
              <span className="skill-phase-mark">{phase.state === "done" ? <Icon name="check" size={12} /> : phase.state === "now" ? <Spinner /> : null}</span>
              <span className="skill-phase-name">{phase.name}</span>
            </li>
          ))}
        </ol>
      )}
      {about && (
        <p className="skill-about">
          {current && <strong>{current}</strong>} {about}
        </p>
      )}
    </div>
  );
}

/**
 * A question of turri's, docked at the foot of the chat in the message box's place: the conversation stays in view
 * above it, and the window is not covered. Its options are buttons; an answer of one's own is typed in it.
 */
/**
 * The question asked now - or, for a moment after it is answered, the one answered: turri asks again at once when there
 * is more to choose (another box to tick), and the card stays put for it rather than giving way to the message box
 * and coming back.
 */
function useLingering(question: Question | undefined): Question | undefined {
  const [held, setHeld] = useState(question);
  useEffect(() => {
    if (question !== undefined) {
      setHeld(question);
      return;
    }
    const timer = setTimeout(() => setHeld(undefined), 400);
    return () => clearTimeout(timer);
  }, [question]);
  return question ?? held;
}

/** turri's boxes: a question of several answers is asked again after each one, its options ticked and unticked. */
const BOX = /^([☑☐]) ([\s\S]*)$/;

function QuestionCard({ question, waiting, onAnswer }: { question: Question; waiting: boolean; onAnswer: (value: unknown) => void }) {
  const [text, setText] = useState(question.prefill ?? "");
  // The box just clicked: shown ticked or unticked at once, before turri asks again with it so.
  const [toggled, setToggled] = useState<string | null>(null);
  useEffect(() => setToggled(null), [question.id]);
  const [other, setOther] = useState(question.kind === "input" || question.kind === "editor" || (question.kind === "question" && !question.options?.length));
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (other) field.current?.focus();
  }, [other]);
  const options = question.options ?? [];
  // A question of boxes: its rows are boxes, and its last option - Done - is the card's button.
  const boxes = options.some((option) => BOX.test(option));
  const done = boxes ? options.findLast((option) => !BOX.test(option) && option.startsWith("Done")) : undefined;
  const answer = (value: unknown) => {
    if (!waiting) onAnswer(value);
  };
  return (
    <div className={`question-card ${waiting ? "waiting" : ""}`} role="dialog" aria-label={question.title}>
      <div className="question-scroll">
        <h2>{question.title}</h2>
        {question.message && (
          <div className="question-context">
            <Prose text={question.message} />
          </div>
        )}
        {question.kind === "confirm" ? (
          <div className="sheet-actions">
            <button className="button small" onClick={() => onAnswer(false)}>
              no
            </button>
            <button className="button small primary" onClick={() => onAnswer(true)} autoFocus>
              yes
            </button>
          </div>
        ) : (
          <>
            {options.length > 0 && (
              <div className="options">
                {options.map((option) => {
                  if (option === done) return null;
                  const box = BOX.exec(option);
                  if (box === null)
                    return (
                      <button key={option} className="option" onClick={() => answer(option)}>
                        {option}
                      </button>
                    );
                  const label = box[2]!;
                  const ticked = (box[1] === "☑") !== (toggled === label);
                  return (
                    <button
                      key={label}
                      className={`option check ${ticked ? "on" : ""}`}
                      role="checkbox"
                      aria-checked={ticked}
                      onClick={() => {
                        if (waiting) return;
                        setToggled(label);
                        onAnswer(option);
                      }}
                    >
                      <span className="checkbox">{ticked && <Icon name="check" size={12} />}</span>
                      {label}
                    </button>
                  );
                })}
                {question.kind === "question" && !other && (
                  <button className="option muted" onClick={() => setOther(true)}>
                    something else…
                  </button>
                )}
              </div>
            )}
            {other && (
              <textarea
                ref={field}
                className="answer"
                rows={question.kind === "editor" ? 10 : 3}
                placeholder={question.placeholder ?? "your answer"}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && question.kind !== "editor") {
                    event.preventDefault();
                    if (text.trim()) onAnswer(text.trim());
                  }
                }}
              />
            )}
            <div className="sheet-actions">
              <button className="button small" onClick={() => onAnswer(undefined)}>
                skip
              </button>
              {done && !other && (
                <button className="button small primary" onClick={() => answer(done)}>
                  done
                </button>
              )}
              {other && (
                <button className="button small primary" disabled={!text.trim()} onClick={() => onAnswer(text.trim())}>
                  Answer {question.kind !== "editor" && <kbd>↩</kbd>}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The chats, as folder tabs in the chat's header beside turri's name: the one shown raised and open onto the chat below,
 * the others plain, each by its title with what it is doing - a spinner while it works, ? while it asks, a dot when it
 * said something since it was last shown. A click shows one, its × - or ⌘W on the one shown - closes it; + after
 * the last opens another (⌘T), and ctrl+tab and ctrl+shift+tab go to the next and the one before.
 */
function ChatTabs({ chats, chatId, asking, onShowChat, onCloseChat, onNewChat }: { chats: ChatInfo[]; chatId: string | null; asking: Set<string>; onShowChat: (id: string) => void; onCloseChat: (id: string) => void; onNewChat: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  // The one shown kept in view, however many there are.
  // In braces: scrollIntoView gives a promise, which React would take for the effect's clean-up.
  useEffect(() => {
    void strip.current?.querySelector(".chat-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [chatId, chats.length]);
  // The person's last chat stays.
  const theirs = chats.length;
  return (
    <>
      <div className="chat-tabs" role="tablist" aria-label="chats" ref={strip}>
        {chats.map((chat) => {
          const shown = chat.id === chatId;
          const mark = asking.has(chat.id) ? "question" : chat.status === "working" ? "working" : chat.status === "unread" && !shown ? "unread" : null;
          return (
            <div
              key={chat.id}
              className={`chat-tab ${shown ? "on" : ""}`}
              title={chat.title}
            >
              <button role="tab" aria-selected={shown} className="chat-tab-name" onClick={() => onShowChat(chat.id)}>
                {mark === "working" ? <Spinner /> : mark === "question" ? <span className="chat-tab-mark asks">?</span> : mark === "unread" ? <span className="chat-tab-mark unread" aria-label="something new" /> : null}
                <span className="chat-tab-title">{chat.title}</span>
              </button>
              {theirs > 1 && (
                <button
                  className="chat-tab-close"
                  onClick={() => onCloseChat(chat.id)}
                  title={shown ? `close this chat (${keys("W")}) - its conversation is gone, its pulses run on` : "close this chat - its conversation is gone, its pulses run on"}
                  aria-label={`close ${chat.title}`}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* After the last tab - outside the strip, so it is there however far the tabs scroll. */}
      <button className="icon-button chat-new" onClick={onNewChat} title={`new chat (${keys("T")}) - another conversation, beside this one`} aria-label="new chat">
        <Icon name="plus" size={14} />
      </button>
    </>
  );
}

/** turri's other agents, by their role, as the meter names them: a skill's has none. */
const OTHER_NAMES: Record<string, string> = { planner: "planner", advisor: "test advisor", chat: "/btw", diagnosis: "diagnosis", release: "release", "test-reviewer": "test review", reviewer: "review" };
const dollars = (n: number) => `$${n.toFixed(2)}`;

/** What the project has spent since it opened, by part - and, of turri's other agents, which, the most first. */
function spendingParts(spending: Spending): { total: number; parts: Array<{ name: string; cost: number; about: string }> } {
  const other = spending.other.reduce((sum, part) => sum + part.cost, 0);
  const agents = [...spending.other].sort((a, b) => b.cost - a.cost).map((part) => `${part.role === null ? "skills" : (OTHER_NAMES[part.role] ?? part.role)} ${dollars(part.cost)}`);
  return {
    total: spending.chat + spending.regeneration + spending.sentinel + other,
    parts: [
      { name: "chat", cost: spending.chat, about: "the conversations' own replies" },
      { name: "regeneration", cost: spending.regeneration, about: "the pulses, regenerating and conformance testing" },
      { name: "sentinel", cost: spending.sentinel, about: "checking each pulse" },
      { name: "other", cost: other, about: agents.length > 0 ? agents.join(" · ") : "turri's other agents - the planner, the test advisor, skills, /btw" },
    ],
  };
}

/**
 * The context the conversation fills - a ring, and its percent - and what the project has spent since it opened: each
 * part in a card above it while the pointer is on it, or the focus. On an engine that cannot say it, what this
 * conversation's model has cost.
 */
function ChatMeter({ stats, spending }: { stats: ChatStats; spending: Spending | null }) {
  const percent = stats.percent === null ? null : Math.min(100, Math.max(0, stats.percent));
  const tone = percent === null ? "" : percent >= 85 ? "full" : percent >= 60 ? "filling" : "";
  const thousands = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const context =
    percent === null
      ? "context: not known yet - it is measured at the next reply"
      : `context: ${stats.tokens !== null ? thousands(stats.tokens) : "?"} of ${stats.contextWindow !== null ? thousands(stats.contextWindow) : "?"} tokens (${Math.round(percent)}%)`;
  const spent = spending === null ? null : spendingParts(spending);
  // Where the card goes: above the meter, from its left - fixed, so no box around the chat cuts it.
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const show = (event: React.SyntheticEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setAt({ left: box.left, bottom: window.innerHeight - box.top + 8 });
  };
  const r = 6;
  const around = 2 * Math.PI * r;
  return (
    <span className={`chat-meter ${tone}`} tabIndex={0} aria-label={`${context}; spent ${dollars(spent?.total ?? stats.cost)}`} onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} className="chat-meter-track" />
        <circle cx="8" cy="8" r={r} className="chat-meter-fill" strokeDasharray={`${((percent ?? 0) / 100) * around} ${around}`} transform="rotate(-90 8 8)" />
      </svg>
      <span>{percent === null ? "–" : `${Math.round(percent)}%`}</span>
      <span className="chat-meter-cost">{dollars(spent?.total ?? stats.cost)}</span>
      {at !== null && (
        <span className="meter-pop" role="tooltip" style={{ left: at.left, bottom: at.bottom }}>
          <span className="muted">{context}</span>
          {spent === null ? (
            <span>this conversation has cost {dollars(stats.cost)} so far - its own model's calls</span>
          ) : (
            <>
              <span className="meter-pop-total">
                spent since the project opened <b>{dollars(spent.total)}</b>
              </span>
              {spent.parts.map((part) => (
                <span key={part.name} className="meter-pop-part">
                  <span>{part.name}</span>
                  <b>{dollars(part.cost)}</b>
                  <span className="muted">{part.about}</span>
                </span>
              ))}
            </>
          )}
        </span>
      )}
    </span>
  );
}
