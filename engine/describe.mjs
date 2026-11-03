// A module of the project as the window shows it, in two parts. What it says - its functional specs, what it requires,
// whether it is read at all - is turri's parse and graph: there at once. How it stands - which functional specs are
// built and conformance tested, whether its code is regenerated from the ***plain as it is now - is turri's completion
// and drift, which read every module's history beneath it: seconds on a project of many modules, so read apart from
// the window's calls (describe-worker.mjs) and sent as it is known.
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";

/** Whether a module's functional specs are conformance tested: its stack's conformance-tests: over the project's, as turri reads it. */
export function conformanceTestsOn(turri, file) {
  try {
    return turri.configForSpec(file).conformanceTests === true;
  } catch {
    return false;
  }
}

/**
 * What a .plain module says, from its ***plain and turri's graph alone: none of it built yet as far as this knows -
 * `standing` reads that. `graph` is turri's plainGraph of the project, read once for every module described with it.
 */
export function said(turri, projectDir, file, graph) {
  const result = turri.checkPlainFile(file);
  const text = readFileSync(file, "utf8");
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const base = { file, rel: relative(projectDir, file), ok: result.ok, module: result.moduleName ?? basename(file, ".plain"), description, requires: result.requiredModules ?? [], conformanceTests: conformanceTestsOn(turri, file) };
  // Not read - and, for the old ***plain syntax, turri's next step: to have it converted.
  if (!result.ok) return { ...base, error: result.error, ...(result.nextStep !== undefined ? { nextStep: result.nextStep } : {}), functionalSpecs: [] };
  // Each functional spec's test plain file and its scenarios, as turri's graph binds them: none, and it is not tested.
  const graphed = new Map(graph.items.filter((item) => item.file === file && item.funcId !== undefined).map((item) => [item.funcId, item]));
  // What the test advisor made of each, as it reads now: an entry of another text - its hash not this one's - is none.
  // On a turri before its test advisor's records (readAdvisor, textHash), none: no functional spec looked at.
  const advised = (turri.textHash !== undefined && turri.readAdvisor?.(projectDir, result.moduleName)?.entries) || {};
  const advisorOf = (funcId, item) => {
    const entry = advised[funcId];
    if (entry === undefined || item === undefined || entry.hash !== turri.textHash(item.text)) return null;
    return { state: entry.state, ...(entry.report !== undefined ? { report: entry.report } : {}), ...(entry.undelivered === true ? { undelivered: true } : {}), ...(entry.reason !== undefined ? { reason: entry.reason } : {}) };
  };
  const functionalSpecs = [];
  try {
    const [, tree] = turri.plainFileParser(basename(file), turri.resolveTemplateDirs(file), { allowNoFunctionalities: true });
    for (const { funcId, specifications } of turri.iterateFunctionalSpecs(tree, false)) {
      const item = graphed.get(funcId);
      const scenarios = { conformance: item?.scenarios?.conformance ?? [], acceptance: item?.scenarios?.acceptance ?? [] };
      functionalSpecs.push({ funcId, text: specifications[turri.FUNCTIONAL_REQUIREMENTS]?.at(-1) ?? "", built: false, conformed: false, testPlainFile: item?.testPlainFile ?? null, scenarios, advisor: advisorOf(funcId, item) });
    }
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : String(error), functionalSpecs: [] };
  }
  // A step of adding tests skipped - scenarios, but no test reqs or no conformance testing script: turri says which, and
  // writes no conformance tests there until it is taken.
  return { ...base, warnings: result.warnings ?? [], functionalSpecs };
}

/**
 * How a module said stands: its functional specs built and conformance tested, as turri's completion has them - given,
 * null when it could not say, or asked of it here - and, from drift's reports of every codebase in its requires chain,
 * or undefined when drift could not say, whether regenerating what changed would have work to do. A module not read is
 * as it was said.
 */
export function standing(turri, spec, reports, completion) {
  if (!spec.ok) return spec;
  const { file } = spec;
  // A functional spec is completed when the codebase the chain delivers has it, as the spec has it now.
  let incomplete;
  let conformanceTested = 0;
  // The functional specs whose conformance tests are written and pass, as the ***plain has them now, by func-id.
  let tested = new Set();
  let built = false;
  try {
    if (completion === null) throw new Error("no completion");
    for (const chain of completion ?? turri.functionalityCompletion(file)) {
      const own = chain.modules.find((entry) => entry.module === spec.module);
      if (own === undefined) continue;
      incomplete = new Set(own.incomplete);
      built = own.completed > 0;
      conformanceTested = own.conformanceTested;
      tested = new Set(own.tested);
    }
  } catch {
    /* nothing built, or a chain that does not resolve: every spec is still to build */
  }
  const functionalSpecs = spec.functionalSpecs.map((entry) => {
    const done = incomplete !== undefined ? !incomplete.has(entry.funcId) : false;
    return { ...entry, built: done, conformed: done && tested.has(entry.funcId) };
  });
  // Whether its code is regenerated from the spec as it is now: what regenerating what changed would have to do.
  const drifted = reports === undefined || reports.some((report) => report.code !== null);
  // Its codebase's base folder against what the codebase started from, when they do not agree - changed since, named
  // differently now, or not there: drift's line, in turri's words. Not kept in step, so said, not done. Only once it has
  // code: before, a base folder not there is parse's warning already.
  const baseFolder = built ? reports?.find((report) => report.plainFile === file && typeof report.baseFolder === "string")?.baseFolder : undefined;
  return { ...spec, built, drifted, conformanceTested, functionalSpecs, ...(baseFolder !== undefined ? { baseFolder } : {}) };
}

/**
 * Every module given, read in the order the window can show it: turri's graph of the project (`heard.graph`), then what
 * each module says (`heard.said`), then how each stands (`heard.stood`), each as it is known - all of it in one call
 * where turri reads the whole project at once (projectStanding). Otherwise, module by module: drift reports every
 * codebase of a module's requires chain - all the modules beneath it - and each the same whichever module above asked:
 * so it is asked once of each module nothing given requires, its reports kept by module, and a module's chain is what it
 * requires, all the way down. Asked of a module itself only where that cannot be told - a name two files share, a module
 * required that none given is, drift failing above it.
 */
export function standings(turri, projectDir, looker, files, heard) {
  const graph = turri.plainGraph(projectDir);
  heard.graph?.(graph);
  const specs = files.map((file) => said(turri, projectDir, file, graph));
  for (const spec of specs) heard.said?.(spec);
  // A turri that reads the whole project at once (projectStanding): each file parsed once, each codebase's record read
  // once, kept between calls while it holds.
  if (turri.projectStanding !== undefined) {
    const answers = new Map(turri.projectStanding(projectDir, { loop: looker, files }).map((answer) => [answer.plainFile, answer]));
    for (const spec of specs) {
      const answer = answers.get(spec.file);
      heard.stood(spec.ok && answer !== undefined ? standing(turri, spec, answer.driftError !== undefined ? undefined : answer.drift, answer.completionError !== undefined ? null : answer.completion) : spec);
    }
    return;
  }
  const fileOf = new Map();
  const shared = new Set();
  for (const spec of specs) if (spec.ok) (fileOf.has(spec.module) ? shared.add(spec.module) : fileOf.set(spec.module, spec.file));
  const required = new Set(specs.flatMap((spec) => spec.requires));
  const reportsOf = new Map();
  for (const spec of specs) {
    if (!spec.ok || required.has(spec.module)) continue;
    try {
      for (const report of looker.drift(spec.file)) reportsOf.set(report.plainFile, [...(reportsOf.get(report.plainFile) ?? []), report]);
    } catch {
      /* said of each module beneath it, asked of it alone */
    }
  }
  const chainOf = (spec) => {
    const files = new Set([spec.file]);
    const down = [...spec.requires];
    while (down.length > 0) {
      const module = down.pop();
      const file = fileOf.get(module);
      if (file === undefined || shared.has(module)) return undefined;
      if (files.has(file)) continue;
      files.add(file);
      down.push(...(specs.find((each) => each.file === file)?.requires ?? []));
    }
    return [...files];
  };
  const driftOf = (spec) => {
    const chain = shared.has(spec.module) ? undefined : chainOf(spec);
    if (chain !== undefined && chain.every((file) => reportsOf.has(file))) return chain.flatMap((file) => reportsOf.get(file));
    try {
      return looker.drift(spec.file);
    } catch {
      return undefined;
    }
  };
  for (const spec of specs) heard.stood(spec.ok ? standing(turri, spec, driftOf(spec)) : spec);
}
