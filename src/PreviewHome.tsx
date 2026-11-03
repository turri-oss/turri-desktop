import { useState } from "react";
import type { Spec } from "./types.ts";
import { Empty, Icon, PlainMark } from "./ui.tsx";
import type { Action } from "./actions.ts";

/** A functional spec as turri names it outside its module. */
const nameOf = (module: string, funcId: string) => `${module}:${funcId}`;

/** `a`, `a and b`, `a, b and c`. */
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** A module and every module it is built on, as turri's requires have them: what its release holds. */
function builtOn(specs: Spec[], module: string, seen = new Set<string>()): Set<string> {
  if (seen.has(module)) return seen;
  seen.add(module);
  for (const required of specs.find((spec) => spec.module === module)?.requires ?? []) builtOn(specs, required, seen);
  return seen;
}

/** The newest built module whose release holds `module`: the last built, in build order, built on it. */
function releaseOf(specs: Spec[], module: string): Spec | undefined {
  return specs.filter((spec) => spec.ok && spec.functionalSpecs.some((entry) => entry.built) && builtOn(specs, spec.module).has(module)).at(-1);
}

/** The last functional spec built of a module: where its codebase is up to. */
const upTo = (spec: Spec) => spec.functionalSpecs.filter((entry) => entry.built).at(-1)?.funcId ?? "";

/**
 * The preview's home: what there is to try, as the ***plain has it - each module's functional specs in the order they
 * are built, the built ones to choose - and two ways to try what is chosen, each in one release: the newest built
 * module's that holds it, released first when what runs is behind. turri tries it in the chat, as the person watches;
 * the sentinel checks it in the background, on a turri whose sentinel can be asked.
 */
export function PreviewHome({ specs, sentinel, onAsk, onSentinel }: { specs: Spec[]; sentinel: boolean; onAsk: (action: Action) => void; onSentinel: (module: string, names: string[]) => void }) {
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

  // Each release what is chosen is tried in, with what of it: one, unless the project has chains that build on nothing of each other.
  const releases = new Map<string, { release: Spec; chosen: Array<{ module: string; funcId: string }> }>();
  for (const each of trying) {
    const release = releaseOf(specs, each.module);
    if (release === undefined) continue;
    const found = releases.get(release.module) ?? { release, chosen: [] };
    found.chosen.push(each);
    releases.set(release.module, found);
  }
  // Said of the release: what is chosen is tried in - or, with nothing chosen, the newest of all.
  const said = releases.size > 0 ? [...releases.values()].map((each) => each.release) : [modules.filter((spec) => spec.functionalSpecs.some((entry) => entry.built)).at(-1)!];

  const isChosen = (module: string, funcId: string) => trying.some((each) => each.module === module && each.funcId === funcId);
  const toggle = (module: string, funcId: string) =>
    setChosen((now) => (isChosen(module, funcId) ? now.filter((each) => each.module !== module || each.funcId !== funcId) : [...now, { module, funcId }]));
  const tryIt = () => {
    // Theirs to try: turri opens the release - released first only if what runs is behind - and says how, testing none of it.
    const tried = [...releases.values()].map(({ release, chosen }) => ({ release: release.module, names: listOf(chosen.map((one) => nameOf(one.module, one.funcId))) }));
    const each = tried.map(({ release, names }) => `the release of ${release} for me to try ${names}`);
    onAsk({
      kind: "try",
      title: listOf(tried.map(({ release, names }) => `${names} in the release of ${release}`)),
      prompt: `Open ${listOf(each)} - its last commit, released first only if what runs is not - then tell me in a few steps how to try it and what I should see. Don't test it yourself: I'll try it.`,
    });
    setChosen([]);
  };
  const check = () => {
    // One check for each release: what is chosen of it, by its module:func-id - of that module or one it is built on.
    for (const { release, chosen } of releases.values()) onSentinel(release.module, chosen.map((one) => nameOf(one.module, one.funcId)));
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
        <span className="preview-home-release">
          latest release:{" "}
          {said.map((release, index) => (
            <span key={release.module}>
              {index > 0 && ", "}
              <code>{nameOf(release.module, upTo(release))}</code>
            </span>
          ))}{" "}
          <span className="muted">- the codebase as built up to it</span>
        </span>
        {sentinel && (
          <button className="button sentinel" disabled={trying.length === 0} onClick={check}>
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
