// turri's host entry: the published package's - or, for working on turri and the app together, a clone's own sources,
// which Node runs as they are: TURRI_DEV=<the clone>, relative to where the app is started. Nothing is built or
// released for it: a change to turri is in the app at the next project opened, as each starts an engine of its own.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// TURRI_DEV=npm - npm run dev:npm - is the package, as no TURRI_DEV is.
const clone = process.env.TURRI_DEV === "npm" ? undefined : process.env.TURRI_DEV;
const sources = clone ? resolve(clone, "src", "host.ts") : undefined;
if (sources !== undefined && !existsSync(sources)) throw new Error(`TURRI_DEV=${clone} is not a turri clone: there is no ${sources}.`);
// Where it is, whatever folder the engine is in by then: its threads (describe-worker.mjs) import it too.
if (clone) process.env.TURRI_DEV = resolve(clone);

/** Where turri comes from: the clone's sources, or the package installed from npm. */
export const turriFrom = sources ?? "@turri-dev/cli";

export default sources !== undefined ? await import(pathToFileURL(sources).href) : await import("@turri-dev/cli/host");
