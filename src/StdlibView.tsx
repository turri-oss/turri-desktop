import { useEffect, useMemo, useRef, useState } from "react";
import type { StdlibModule } from "./types.ts";
import { Empty, Icon, PlainMark, PlainName, Spinner } from "./ui.tsx";
import { type Point, pointNow, relocate } from "./PulseSpec.tsx";

type Token = { text: string; role: string | null };

type Kind = { kind: string; title: string };

/** What the list shows a template as: its own row, or - a conformance template - its stack's. */
const rowOf = (module: StdlibModule) => module.tests ?? module.name;
/** A kind's stacks first, then what they import - its `common`. */
const order = (a: StdlibModule, b: StdlibModule) => Number(b.stack) - Number(a.stack) || a.name.localeCompare(b.name);

/**
 * turri's standard library - the stacks a ***plain imports instead of writing its implementation reqs - to look through:
 * every template by its kind on the left, and the one chosen on the right, coloured as the ***plain is and read only, with
 * what it imports, what imports it and its conformance tests, each a click away.
 */
export function StdlibView(props: {
  selected: string | null;
  /** Lines of the template chosen to bring into view and light for a moment, from 1: a concept's definition, clicked in the chat. */
  reveal?: { lines: number[]; texts?: string[]; point?: Point; at: number };
  onSelect: (name: string) => void;
  onOpenSpec: (file: string) => void;
}) {
  const [modules, setModules] = useState<StdlibModule[] | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Where the person came from, as they follow imports: back goes there. */
  const [trail, setTrail] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([window.turri.call<StdlibModule[]>("stdlib"), window.turri.call<Kind[]>("stdlibKinds")])
      .then(([next, kinds]) => (setKinds(kinds), setModules(next)))
      .catch((error: Error) => setFailed(error.message));
  }, []);

  const byName = useMemo(() => new Map((modules ?? []).map((module) => [module.name, module])), [modules]);
  // The one shown: the one chosen, or else the first stack the project imports, or else the first stack there is.
  const shown =
    (props.selected !== null ? byName.get(props.selected) : undefined) ??
    modules?.find((module) => module.usedBy.length > 0 && module.stack) ??
    modules?.find((module) => module.stack) ??
    modules?.[0];

  const go = (name: string) => {
    if (shown !== undefined && name !== shown.name) setTrail((all) => [...all, shown.name]);
    props.onSelect(name);
  };

  if (failed !== null)
    return (
      <Empty icon="warn" title="cannot read the standard library">
        {failed}
      </Empty>
    );
  if (modules === null)
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (modules.length === 0 || shown === undefined)
    return (
      <Empty icon="layers" title="the standard library is empty">
        the turri this app runs has no templates in its stdlib folder.
      </Empty>
    );

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const listed = modules.filter((module) => module.tests === undefined && words.every((word) => `${module.name} ${module.description}`.toLowerCase().includes(word)));
  const stack = byName.get(rowOf(shown))!;
  const twin = stack.conformance !== undefined ? byName.get(stack.conformance) : undefined;
  const importedBy = modules.filter((module) => module.imports.includes(shown.name));
  // The project imports a template, or one that imports it: it is in what the project builds on.
  const inProject = (name: string, seen = new Set<string>()): boolean => {
    const module = byName.get(name);
    if (module === undefined || seen.has(name)) return false;
    seen.add(name);
    return module.usedBy.length > 0 || modules.some((other) => other.imports.includes(name) && inProject(other.name, seen));
  };

  return (
    <div className="stdlib-view">
      <nav className="stdlib-list" aria-label="the standard library">
        <input className="settings-filter" type="search" placeholder="find a template" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="find a template" />
        {listed.length === 0 && <p className="muted pad">nothing in the standard library says that.</p>}
        {kinds.map(({ kind, title }) => {
          const rows = listed.filter((module) => module.kind === kind).sort(order);
          if (rows.length === 0) return null;
          return (
            <section key={kind}>
              <div className="sidebar-section">{title}</div>
              {rows.map((module) => (
                <button key={module.name} className={`stdlib-row ${rowOf(shown) === module.name ? "active" : ""}`} onClick={() => go(module.name)} title={module.description}>
                  <span className="stdlib-row-name">
                    {module.name.split("/").pop()}
                    {inProject(module.name) && (
                      <span className="stdlib-used" title="this project builds on it">
                        in use
                      </span>
                    )}
                  </span>
                  <span className="stdlib-row-about">{module.description}</span>
                </button>
              ))}
            </section>
          );
        })}
      </nav>

      <div className="stdlib-module editor-pane">
        <div className="pane-header">
          <span className="stdlib-title">
            <button className="icon-button" disabled={trail.length === 0} onClick={() => (props.onSelect(trail.at(-1)!), setTrail((all) => all.slice(0, -1)))} title="back to the template you came from" aria-label="back">
              <Icon name="back" />
            </button>
            <PlainMark size={14} />
            <span className="stdlib-name" title={shown.name}>
              {shown.name}
            </span>
          </span>
          <span className="pane-header-right">
            {twin !== undefined && (
              <div className="segmented small" role="tablist" aria-label="the template or its conformance tests">
                {[stack.name, twin.name].map((name) => (
                  <button key={name} role="tab" aria-selected={shown.name === name} className={shown.name === name ? "on" : ""} onClick={() => go(name)}>
                    {name === twin.name ? "conformance tests" : "template"}
                  </button>
                ))}
              </div>
            )}
            <button className="link" onClick={() => void navigator.clipboard.writeText(shown.name)} title={`copy ${shown.name}, to put under import: in a ***plain`}>
              copy import
            </button>
          </span>
        </div>
        <div className="editor stdlib-body">
          {shown.description && <p className="stdlib-description">{shown.description}</p>}
          <dl className="stdlib-facts">
            <Links label="imports" names={shown.imports} known={byName} onGo={go} none="nothing" />
            <Links label="imported by" names={importedBy.map((module) => module.name)} known={byName} onGo={go} none="no other template" />
            <dt>in this project</dt>
            <dd>
              {shown.usedBy.length === 0 ? (
                <span className="muted">{inProject(shown.name) ? "through a template it imports" : <>no <PlainName /> of it imports it</>}</span>
              ) : (
                shown.usedBy.map((spec) => (
                  <button key={spec.file} className="stdlib-chip" onClick={() => props.onOpenSpec(spec.file)} title={`open ${spec.rel}`}>
                    <PlainMark size={12} /> {spec.rel}
                  </button>
                ))
              )}
            </dd>
          </dl>
          <Template text={shown.text} known={byName} onGo={go} reveal={shown.name === props.selected ? props.reveal : undefined} />
        </div>
      </div>
    </div>
  );
}

function Links(props: { label: string; names: string[]; known: Map<string, StdlibModule>; onGo: (name: string) => void; none: string }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>
        {props.names.length === 0 ? (
          <span className="muted">{props.none}</span>
        ) : (
          props.names.map((name) =>
            props.known.has(name) ? (
              <button key={name} className="stdlib-chip" onClick={() => props.onGo(name)} title={props.known.get(name)!.description}>
                {name}
              </button>
            ) : (
              <span key={name} className="stdlib-chip missing" title="not in the standard library">
                {name}
              </span>
            ),
          )
        )}
      </dd>
    </>
  );
}

/** A template's ***plain, numbered and coloured by turri's grammar - each template it imports a link to it. */
function Template({ text, known, onGo, reveal }: { text: string; known: Map<string, StdlibModule>; onGo: (name: string) => void; reveal?: { lines: number[]; texts?: string[]; point?: Point; at: number } }) {
  // Lines shown from elsewhere: brought into view, and lit for a few seconds - a pulse's where they are now, the line
  // clicked in it in view.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const linesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal === undefined || reveal.lines.length === 0) return;
    const all = text.split("\n");
    const { lines: then, texts, point } = reveal;
    const lines = new Set((texts !== undefined ? relocate(all, then, texts) : then).map((line) => line - 1));
    setRevealed(lines);
    const to = point !== undefined && texts !== undefined ? pointNow(all, then, texts, point) - 1 : Math.min(...lines);
    requestAnimationFrame(() => linesRef.current?.children[to]?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const timer = setTimeout(() => setRevealed(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [reveal?.at, text]);
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  useEffect(() => {
    let alive = true;
    void window.turri.call<Token[][]>("highlightSpec", { text }).then((next) => alive && setTokens(next));
    return () => void (alive = false);
  }, [text]);
  const lines = text.split("\n");
  return (
    <div className="pulse-spec-lines stdlib-lines" ref={linesRef}>
      {lines.map((line, index) => {
        const coloured = tokens?.[index] !== undefined && tokens[index]!.map((token) => token.text).join("") === line;
        return (
          <div key={index} className={revealed.has(index) ? "revealed" : undefined}>
            <span className="pulse-spec-number">{index + 1}</span>
            <span className="pulse-spec-text">
              {line === ""
                ? "​"
                : coloured
                  ? tokens![index]!.map((token, at) =>
                      token.role === "module" && known.has(token.text.trim()) ? (
                        <button key={at} className="plain-module stdlib-import" onClick={() => onGo(token.text.trim())} title={known.get(token.text.trim())!.description}>
                          {token.text}
                        </button>
                      ) : token.role ? (
                        <span key={at} className={`plain-${token.role}`}>
                          {token.text}
                        </span>
                      ) : (
                        token.text
                      ),
                    )
                  : line}
            </span>
          </div>
        );
      })}
    </div>
  );
}

