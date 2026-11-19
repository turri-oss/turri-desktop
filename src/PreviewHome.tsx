import { useState } from "react";
import type { Launch, Spec } from "./types.ts";
import { Empty, Icon, PlainMark } from "./ui.tsx";
import type { Action } from "./actions.ts";
import { checkable } from "./launches.tsx";

/** A functional spec as turri names it outside its module. */
const nameOf = (module: string, funcId: string) => `${module}:${funcId}`;

/** `a`, `a and b`, `a, b and c`. */
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** A module and every module it is built on, as turri's requires have them: what its codebase holds. */
function builtOn(specs: Spec[], module: string, seen = new Set<string>()): Set<string> {
  if (seen.has(module)) return seen;
  seen.add(module);
  for (const required of specs.find((spec) => spec.module === module)?.requires ?? []) builtOn(specs, required, seen);
  return seen;
}

/** The newest built module whose codebase holds `module`: the last built, in build order, built on it - what is launched to try it. */
function codebaseOf(specs: Spec[], module: string): Spec | undefined {
  return specs.filter((spec) => spec.ok && spec.functionalSpecs.some((entry) => entry.built) && builtOn(specs, spec.module).has(module)).at(-1);
}

/** The last functional spec built of a module: where its codebase is up to. */
const upTo = (spec: Spec) => spec.functionalSpecs.filter((entry) => entry.built).at(-1)?.funcId ?? "";

/**
 * The preview's home: what there is to try, as the ***plain has it - each module's functional specs in the order they
 * are built, the built ones to choose - and two ways to try what is chosen, each in one codebase: the newest built
 * module's that holds it. try it asks turri in the chat to launch it - out already when what runs is its last commit -
 * and say how to try it, as the person watches. use sentinel has the sentinel check it in the background, on a turri
 * whose sentinel can be asked - in what is launched: the sentinel launches nothing, so it is offered only once something
 * of the codebase runs, or is being launched (`launches`, as turri told of them), and says why not when nothing does.
 */
export function PreviewHome({ specs, launches, sentinel, onAsk, onSentinel }: { specs: Spec[]; launches: Launch[]; sentinel: boolean; onAsk: (action: Action) => void; onSentinel: (module: string, names: string[]) => void }) {
  const modules = specs.filter((spec) => spec.ok && spec.functionalSpecs.length > 0);
  const [chosen, setChosen] = useState<Array<{ module: string; funcId: string }>>([]);
  // What is chosen and still there to try - not gone from the ***plain since, nor regenerated away.
  const trying = chosen.filter((each) => modules.some((spec) => spec.module === each.module && spec.functionalSpecs.some((entry) => entry.funcId === each.funcId && entry.built)));

  if (!modules.some((spec) => spec.functionalSpecs.some((entry) => entry.built)))
    return (
      <div className="preview-home">
        <Empty icon="globe" title="nothing built yet">
          once turri has built something from the ***plain, choose here what of it to try.
        </Empty>
      </div>
    );

  // Each codebase what is chosen is tried in, with what of it: one, unless the project has chains that build on nothing of each other.
  const codebases = new Map<string, { codebase: Spec; chosen: Array<{ module: string; funcId: string }> }>();
  for (const each of trying) {
    const codebase = codebaseOf(specs, each.module);
    if (codebase === undefined) continue;
    const found = codebases.get(codebase.module) ?? { codebase, chosen: [] };
    found.chosen.push(each);
    codebases.set(codebase.module, found);
  }
  // Said of the codebase: what is chosen is tried in - or, with nothing chosen, the newest of all.
  const said = codebases.size > 0 ? [...codebases.values()].map((each) => each.codebase) : [modules.filter((spec) => spec.functionalSpecs.some((entry) => entry.built)).at(-1)!];
  // Whether the sentinel can check each: something of it runs, or is being launched - else why not.
  const unready = [...codebases.keys()].map((codebase) => checkable(launches, codebase)).find((each) => !each.ok);

  const isChosen = (module: string, funcId: string) => trying.some((each) => each.module === module && each.funcId === funcId);
  const toggle = (module: string, funcId: string) =>
    setChosen((now) => (isChosen(module, funcId) ? now.filter((each) => each.module !== module || each.funcId !== funcId) : [...now, { module, funcId }]));
  const tryIt = () => {
    // Theirs to try: turri launches it - out already when what runs is its last commit - and once it is up says how, testing none of it.
    const tried = [...codebases.values()].map(({ codebase, chosen }) => ({ codebase: codebase.module, names: listOf(chosen.map((one) => nameOf(one.module, one.funcId))) }));
    const each = tried.map(({ codebase, names }) => `${codebase} for me to try ${names}`);
    onAsk({
      kind: "try",
      title: listOf(tried.map(({ codebase, names }) => `${names}, launched from ${codebase}`)),
      prompt: `Launch ${listOf(each)} - its last commit, out already if that is what runs - and once it is up, open it and tell me in a few steps how to try it and what I should see. Don't test it yourself: I'll try it.`,
    });
    setChosen([]);
  };
  const check = () => {
    // One check for each codebase: what is chosen of it, by its module:func-id - of that module or one it is built on.
    for (const { codebase, chosen } of codebases.values()) onSentinel(codebase.module, chosen.map((one) => nameOf(one.module, one.funcId)));
    setChosen([]);
  };

  return (
    <div className="preview-home">
      <div className="preview-home-list">
        {modules.map((spec) => (
          <section key={spec.file} className="preview-home-module">
            <h3>
              <PlainMark size={12} /> {spec.module}
            </h3>
            {spec.functionalSpecs.map((entry) => {
              const on = isChosen(spec.module, entry.funcId);
              const tested = entry.conformed && spec.conformanceTests !== false;
              return (
                <button key={entry.funcId} role="checkbox" aria-checked={on} disabled={!entry.built} className={`preview-home-row${on ? " on" : ""}`} onClick={() => toggle(spec.module, entry.funcId)} title={entry.text}>
                  <span className="checkbox">{on && <Icon name="check" size={12} />}</span>
                  <span className="preview-home-id">{entry.funcId}</span>
                  <span className={`state-dot ${tested ? "conformed" : entry.built ? "done" : "new"}`} title={tested ? "built and conformance tested" : entry.built ? "built" : "not built yet"} />
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <div className="preview-home-foot">
        <span className="preview-home-launch">
          tried in:{" "}
          {said.map((codebase, index) => (
            <span key={codebase.module}>
              {index > 0 && ", "}
              <code>{nameOf(codebase.module, upTo(codebase))}</code>
            </span>
          ))}{" "}
          <span className="muted">- the codebase as built up to it</span>
        </span>
        {/* The sentinel tests what is launched, and launches nothing: with nothing of it running, said why - try it first. */}
        {sentinel && unready !== undefined && !unready.ok && <span className="preview-home-why muted">{unready.why}</span>}
        {sentinel && (
          <button className="button sentinel" disabled={trying.length === 0 || unready !== undefined} onClick={check} title={unready !== undefined && !unready.ok ? unready.why : "the sentinel checks it in what is launched, in the background"}>
            use sentinel
          </button>
        )}
        <button className="button primary" disabled={trying.length === 0} onClick={tryIt}>
          try it
        </button>
      </div>
    </div>
  );
}
