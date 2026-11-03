// How the project's modules stand - built, conformance tested, drifted - read in a thread of its own, so the engine
// answers the window while it is read: turri of its own (the engine's turri.mjs), and a work loop of its own that starts
// nothing (dryRun), as the engine's would be. Told the project and the modules to read, it sends turri's graph of the
// project, what each module says, how each stands - each as it is known - then that it is done.
import { parentPort, workerData } from "node:worker_threads";
import turri from "./turri.mjs";
import { standings } from "./describe.mjs";

// turri writes progress to the console as it would to a terminal: here a log line for the app, as the engine's is.
for (const level of ["log", "info", "warn", "error"]) console[level] = (...args) => parentPort.postMessage({ log: { level, text: args.map(String).join(" ") } });

const { projectDir } = workerData;
const looker = turri.createWorkLoop({ registry: turri.createJobRegistry(), cwd: projectDir, dryRun: true });

parentPort.on("message", ({ run, files }) => {
  try {
    standings(turri, projectDir, looker, files, {
      graph: (graph) => parentPort.postMessage({ run, graph }),
      said: (said) => parentPort.postMessage({ run, said }),
      stood: (spec) => parentPort.postMessage({ run, spec }),
    });
    parentPort.postMessage({ run, done: true });
  } catch (error) {
    parentPort.postMessage({ run, done: true, error: error instanceof Error ? error.message : String(error) });
  }
});
parentPort.postMessage({ ready: true });
