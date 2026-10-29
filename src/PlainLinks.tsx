import { useEffect, useRef, useState } from "react";
import { PlainMark, withPlain } from "./ui.tsx";
import { MAC } from "./platform.ts";

/** A module a ***plain names, and the .plain file it is - null for the standard library's, or one not found. */
export type Link = { name: string; file: string | null; stdlib?: boolean };
export type Links = { imports: Link[]; requires: Link[]; requiredBy: Link[]; importedBy: Link[] };

/** Where a link goes: a module of the standard library to the stdlib view, a .plain of the project to its file. */
export type OpenLink = (link: Link) => void;

/**
 * What a .plain builds on and what builds on it, from turri's graph of the project's ***plain as saved: read again
 * whenever a .plain of the project changes on disk. None for what is not a .plain, or on a turri without the graph.
 */
export function usePlainLinks(file: string, plain = true): Links | null {
  const [links, setLinks] = useState<Links | null>(null);
  const [changed, setChanged] = useState(0);
  useEffect(
    () =>
      window.turri.on("engine:files", ({ paths }: { paths: string[] }) => {
        if (paths.some((path) => path.endsWith(".plain"))) setChanged((count) => count + 1);
      }),
    [],
  );
  useEffect(() => window.turri.on("engine:spec", () => setChanged((count) => count + 1)), []);
  useEffect(() => {
    if (!plain) return;
    let alive = true;
    void window.turri.call<Links | null>("plainLinks", { file }).then((next) => alive && setLinks(next), () => {});
    return () => void (alive = false);
  }, [file, plain, changed]);
  return links;
}

/**
 * What a ⌘-click follows in a ***plain: a module its front matter names, a concept - to where it is defined - or a
 * linked resource - to its file, the `resource`th link on the line. `line` is from 1, as turri's graph counts.
 */
export type Followed = { module: Link } | { concept: string; line: number } | { resource: number; line: number } | { funcRef: string; line: number };

/**
 * What is ⌘-clicked at `column` of a line coloured by turri's grammar: the concept, linked resource or func-id the caret
 * is in or at the end of, or else the module the line names - one the ***plain imports or requires, or one of the standard library.
 */
export function followAt(links: Links | null, tokens: Array<{ text: string; role: string | null }> | undefined, column: number, line: number): Followed | null {
  if (tokens === undefined) return null;
  let start = 0;
  for (const [index, token] of tokens.entries()) {
    const end = start + token.text.length;
    if (start <= column && column <= end) {
      if (token.role === "concept") return { concept: token.text, line };
      // A test plain file's func_id: the functional spec its scenarios are of.
      if (token.role === "func-ref") return { funcRef: token.text.trim(), line };
      if (token.role === "link") return { resource: tokens.slice(0, index).filter((each) => each.role === "link").length, line };
    }
    start = end;
  }
  const name = tokens.find((token) => token.role === "module")?.text.trim().replace(/^\.\//, "");
  if (name === undefined) return null;
  const found = links && [...links.imports, ...links.requires].find((link) => link.name === name);
  const module = found ?? (name.startsWith("stdlib/") ? { name, file: null, stdlib: true } : null);
  return module === null ? null : { module };
}

/** Whether ⌘ - Ctrl on Linux - is held: the modules, concepts and linked resources a ***plain names are links while it is. */
export function useModHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => setHeld(MAC ? event.metaKey : event.ctrlKey);
    const off = () => setHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", off);
    };
  }, []);
  return held;
}

/**
 * Under a ***plain's header: what it imports and requires, and which of the project's .plain files require it or import
 * it - each a button, to go up and down its chain. A module of the standard library opens in the stdlib view.
 */
export function PlainLinks({ links, onOpen }: { links: Links | null; onOpen: OpenLink }) {
  if (links === null) return null;
  const rows: Array<[string, Link[]]> = [
    ["imports", links.imports],
    ["requires", links.requires],
    ["required by", links.requiredBy],
    ["imported by", links.importedBy],
  ];
  if (rows.every(([, shown]) => shown.length === 0)) return null;
  return (
    <div className="plain-links" title={`${MAC ? "⌘" : "Ctrl"}-click a module, a concept or a linked resource in the ***plain to open it`}>
      {rows.map(
        ([label, shown]) =>
          shown.length > 0 && (
            <span key={label} className="plain-links-row">
              <span className="muted">{label}</span>
              {shown.map((link) =>
                link.stdlib || link.file !== null ? (
                  <button key={link.name} className="stdlib-chip" onClick={() => onOpen(link)} title={link.stdlib ? `open ${link.name} in the stdlib view` : `open ${link.name}`}>
                    {!link.stdlib && <PlainMark size={12} />} {link.name}
                  </button>
                ) : (
                  <span key={link.name} className="stdlib-chip missing" title="not found in the project">
                    {link.name}
                  </span>
                ),
              )}
            </span>
          ),
      )}
    </div>
  );
}

/** A place in the ***plain, from turri's graph: an item's file and the line it starts on, and its module - the standard library's or the project's. */
export type Place = { file: string; line: number; module: string; stdlib: boolean };
/** An item that uses a concept: where it is, by its path in the project or its template's name, and its first line - its concepts apart. */
export type Use = Place & { name: string; text: Array<{ text: string; concept?: boolean }> };

/**
 * Where a concept is used, ⌘-clicked where it is defined: a list at the point clicked, each use a button to go to it -
 * the arrows to choose, enter to go, escape or a click elsewhere to put it away.
 */
export function ConceptUses(props: { concept: string; uses: Use[]; x: number; y: number; onGo: (use: Use) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    box.current?.focus();
    const away = (event: MouseEvent) => !box.current?.contains(event.target as Node) && props.onClose();
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, []);
  // Below the point clicked, kept inside the window.
  const left = Math.min(props.x, window.innerWidth - 380);
  const top = Math.min(props.y + 12, window.innerHeight - 40 - Math.min(props.uses.length, 8) * 44);
  return (
    <div
      ref={box}
      className="uses-pop"
      style={{ left, top }}
      tabIndex={-1}
      role="dialog"
      aria-label={`where ${props.concept} is used`}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActive((active + (event.key === "ArrowDown" ? 1 : props.uses.length - 1)) % props.uses.length);
        } else if (event.key === "Enter") props.onGo(props.uses[active]!);
      }}
    >
      <div className="uses-title muted">
        <span className="plain-concept">{props.concept}</span> is used in {props.uses.length === 1 ? "one place" : `${props.uses.length} places`}
      </div>
      <ul>
        {props.uses.map((use, index) => (
          <li key={`${use.file}:${use.line}`}>
            <button className={index === active ? "on" : ""} onMouseEnter={() => setActive(index)} onClick={() => props.onGo(use)}>
              <span className="uses-where">
                <PlainMark size={12} /> {use.name}:{use.line}
              </span>
              <span className="uses-text">{use.text.map((part, at) => (part.concept ? <span key={at} className="plain-concept">{part.text}</span> : <span key={at}>{withPlain(part.text)}</span>))}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
