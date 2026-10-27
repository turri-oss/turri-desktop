import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Empty, Icon, PlainMark, Spinner } from "./ui.tsx";
import { type Point, pointNow, relocate } from "./PulseSpec.tsx";
import { MAC, withMod } from "./platform.ts";
import { highlightCode, languageOf } from "./highlight.ts";
import { followAt, PlainLinks, useModHeld, usePlainLinks, type Followed, type OpenLink } from "./PlainLinks.tsx";

type Token = { text: string; role: string | null };
type Read = { file: string; text: string | null; reason?: "large" | "binary"; size: number };

/** Folders whose files turri writes and writes again: shown, not edited here - an edit would be lost to the next pulse. */
const GENERATED = ["plain_modules", "dist", ".turri"];

function kilobytes(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

/**
 * Any file of the project that is not one of its specs: a template a spec imports, a test script, a readme, a skill. It
 * is edited as text - a .plain file coloured by turri's grammar, as the spec is, code in its palette - and saved with ⌘S; what turri
 * generates is read only. A file that is not text, or too large, is offered to the app that opens it.
 */
export function FileView(props: { root: string; file: string; onDirty: (dirty: boolean) => void; saveRef: MutableRefObject<(() => Promise<void>) | null>; say: (text: string, tone?: "info" | "error") => void; onOpen: OpenLink;
  /** A module, concept or linked resource ⌘-clicked in a .plain: to open what it names. */
  onFollow: (followed: Followed, point: { x: number; y: number }) => void;
  /**
   * Lines to bring into view and light for a moment, from 1: a concept's definition, clicked in the chat - or a pulse's
   * lines of a template, with their text to find them by where it has changed since, and the point clicked, for the caret.
   */
  reveal?: { lines: number[]; texts?: string[]; point?: Point; at: number };
}) {
  const { root, file } = props;
  const rel = file.slice(root.length + 1);
  const readOnly = GENERATED.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const plain = file.endsWith(".plain");
  // Code, coloured in the ***plain's palette, by what highlight.js knows of its language.
  const code = !plain && languageOf(file) !== null;
  const [read, setRead] = useState<Read | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<Token[][]>([]);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Lines shown from elsewhere: in view once the text is here, and lit for a few seconds - a pulse's where they are now,
  // and, clicked at a point, the caret there.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (props.reveal === undefined || text === null || props.reveal.lines.length === 0) return;
    const all = text.split("\n");
    const { lines: then, texts, point } = props.reveal;
    const lines = new Set((texts !== undefined ? relocate(all, then, texts) : then).map((line) => line - 1));
    setRevealed(lines);
    const to = point !== undefined && texts !== undefined ? pointNow(all, then, texts, point) - 1 : Math.min(...lines);
    if (point !== undefined && areaRef.current !== null) {
      const at = all.slice(0, to).reduce((sum, line) => sum + line.length + 1, 0);
      areaRef.current.focus({ preventScroll: true });
      areaRef.current.setSelectionRange(at, at);
    }
    requestAnimationFrame(() => {
      const line = editorRef.current?.querySelector<HTMLElement>(`.editor-colours > div:nth-child(${to + 1})`);
      if (line && editorRef.current) editorRef.current.scrollTo({ top: Math.max(0, line.offsetTop - editorRef.current.clientHeight / 3), behavior: "smooth" });
    });
    const timer = setTimeout(() => setRevealed(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [props.reveal?.at, text === null]);
  const now = useRef({ text, saved });
  now.current = { text, saved };
  const links = usePlainLinks(file, plain);
  const linking = useModHeld();

  useEffect(() => {
    window.turri
      .call<Read>("readFile", { file })
      .then((next) => {
        setRead(next);
        setText(next.text);
        setSaved(next.text);
      })
      .catch((error: Error) => setFailed(error.message));
  }, [file]);

  // Changed on disk: taken at once, unless there are edits it would undo.
  useEffect(
    () =>
      window.turri.on("engine:files", ({ paths }: { paths: string[] }) => {
        if (!paths.includes(file)) return;
        void window.turri.call<Read>("readFile", { file }).then(
          (next) => {
            if (next.text === null || next.text === now.current.saved) return;
            if (now.current.text === now.current.saved || now.current.text === next.text) {
              setText(next.text);
              setSaved(next.text);
              setOnDisk(null);
            } else setOnDisk(next.text);
          },
          () => setFailed(`${rel} is no longer there.`),
        );
      }),
    [file, rel],
  );

  // A .plain file coloured as turri's grammar has it, code as highlight.js reads its language - a moment after typing stops.
  useEffect(() => {
    if ((!plain && !code) || text === null) return;
    const timer = setTimeout(() => (plain ? void window.turri.call<Token[][]>("highlightSpec", { text }).then(setLines) : setLines(highlightCode(file, text) ?? [])), 80);
    return () => clearTimeout(timer);
  }, [plain, code, file, text]);

  const dirty = text !== null && text !== saved;
  useEffect(() => props.onDirty(dirty), [dirty]);

  const save = async () => {
    if (text === null || !dirty || readOnly) return;
    try {
      await window.turri.call("writeFile", { file, text });
      setSaved(text);
      setOnDisk(null);
    } catch (error) {
      props.say(`not saved: ${(error as Error).message}`, "error");
    }
  };
  props.saveRef.current = save;

  // What file it is, the pane's title - and, for a file not shown here, the app that opens it, or where it is.
  const header = (shown: boolean) => (
    <div className="pane-header">
      <span className="pane-title" title={file}>
        {plain ? <PlainMark /> : <Icon name="file" />} {rel}
      </span>
      {!shown && (
        <span className="pane-header-right">
          <button className="link" onClick={() => void window.turri.openPath(file)} title="open it in the app your mac opens it with">
            open
          </button>
          <span className="muted">·</span>
          <button className="link" onClick={() => void window.turri.reveal(file)}>
            reveal
          </button>
        </span>
      )}
    </div>
  );

  if (failed !== null)
    return (
      <div className="editor-pane">
        <Empty icon="warn" title="cannot read this file">
          {failed}
        </Empty>
      </div>
    );
  if (read === null || (read.text !== null && text === null))
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (text === null)
    return (
      <div className="editor-pane">
        {header(false)}
        <Empty icon="file" title={read.reason === "large" ? `too large to show here (${kilobytes(read.size)})` : "not a text file"}>
          {MAC ? "open it in the app your Mac opens it with, or reveal it in Finder." : "open it in the app your computer opens it with, or show it in the file manager."}
        </Empty>
      </div>
    );

  return (
    <div className="editor-pane">
      {header(true)}
      {plain && <PlainLinks links={links} onOpen={props.onOpen} />}
      {onDisk !== null && (
        <div className="disk-banner">
          <Icon name="warn" />
          <span>{rel} changed on disk while you were editing it.</span>
          <button
            className="button small"
            onClick={() => {
              setText(onDisk);
              setSaved(onDisk);
              setOnDisk(null);
            }}
          >
            load the new version
          </button>
        </div>
      )}
      {/* The two layers of the spec's editor: the text drawn, coloured for a .plain file and for code, and the textarea laid over it. */}
      <div className={`editor ${plain && linking ? "linking" : ""}`} ref={editorRef}>
        <div className={`editor-sheet file-sheet ${code ? "code" : ""}`}>
          <pre className="editor-colours" aria-hidden>
            {text.split("\n").map((line, index) => {
              const tokens = plain || code ? lines[index] : undefined;
              const coloured = tokens !== undefined && tokens.map((token) => token.text).join("") === line;
              return <div key={index} className={revealed.has(index) ? "revealed" : undefined}>{line === "" ? "​" : coloured ? tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text)) : line}</div>;
            })}
          </pre>
          <textarea
            ref={areaRef}
            spellCheck={false}
            value={text}
            readOnly={readOnly}
            onChange={(event) => setText(event.target.value)}
            // ⌘-click on a module a .plain imports or requires, a concept or a linked resource opens it.
            onMouseUp={(event) => {
              const area = event.currentTarget;
              if (!plain || !withMod(event) || area.selectionStart !== area.selectionEnd) return;
              const before = area.value.slice(0, area.selectionStart).split("\n");
              const followed = followAt(links, lines[before.length - 1], before.at(-1)!.length, before.length);
              if (followed !== null) props.onFollow(followed, { x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key === "s" && withMod(event)) {
                event.preventDefault();
                void save();
              }
              if (event.key === "Tab" && !readOnly) {
                event.preventDefault();
                const area = event.currentTarget;
                const { selectionStart, selectionEnd } = area;
                setText(area.value.slice(0, selectionStart) + "  " + area.value.slice(selectionEnd));
                requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2));
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
