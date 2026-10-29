import { useEffect, useRef, useState } from "react";
import { ChooseFolder } from "./ProjectSettings.tsx";
import type { Project } from "./types.ts";
import type { AuthProvider } from "../electron/preload.ts";
import { AuthSheet } from "./AuthSheet.tsx";
import { DoctorChecks, useDoctor } from "./DoctorSheet.tsx";
import { Icon, Spinner } from "./ui.tsx";

type Pair = { harness: string; coding: string };
/** Bedrock as the engine offers it - as turri says it: each maker, its geographies, and in each its models and the pair offered. */
interface BedrockMaker {
  maker: string;
  label: string;
  regions: Array<{
    region: string;
    /** Served in the AWS region it is called in: no geography of its own. */
    inRegion: boolean;
    /** The AWS region it needs AWS_REGION set to, or null when pi's us-east-1 serves it. */
    awsRegion: string | null;
    /** The strongest first. */
    models: Array<{ id: string; name: string; reasoning: boolean }>;
    pair: Pair | null;
  }>;
}
interface Vendors {
  vendors: Array<{ id: string; label: string; harness: string; coding: string }>;
  bedrockDefault: { maker: string; region: string };
  bedrock: BedrockMaker[];
  /** Whether turri sets AWS_REGION itself for a geography that needs one - false on a turri that asks the person to. */
  setsRegion?: boolean;
}

/**
 * A new project: its folder named in the save sheet, then the models it runs on chosen here - turri's vendors, as
 * `turri init-config` offers them - and its config.turri.yaml written before it opens, so the chat starts on them.
 */
export function NewProject({ onOpened, onDone }: { onOpened: (project: Project) => void; onDone: () => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendors | null>(null);
  const [vendor, setVendor] = useState<string | null>(null);
  const [maker, setMaker] = useState("anthropic");
  const [region, setRegion] = useState("global");
  // Bedrock's two models, as picked - turri's, or the catalogue's first, until the person picks others.
  const [pair, setPair] = useState<{ harness: string; coding: string } | null>(null);
  const [starting, setStarting] = useState(false);
  // What its codebase starts from: a folder chosen - an existing codebase, files to use - or nothing.
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Made, its config written, but not opened: why, and what turri said of its config.
  const [unready, setUnready] = useState<{ failed: string; setup: string } | null>(null);
  // Every provider, with whether it is signed in to: each vendor's models say which they come from.
  const [providers, setProviders] = useState<AuthProvider[] | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const readProviders = () => void window.turri.auth.providers().then(({ providers: all }) => setProviders(all), () => {});

  useEffect(() => {
    void window.turri.newProject().then(
      (chosen: string | null) => (chosen === null ? onDone() : setDir(chosen)),
      (failure: Error) => setError(plain(failure)),
    );
    void window.turri.vendors().then(async (all: Vendors) => {
      setVendors(all);
      // The models new projects start on, as chosen in the settings - if turri still offers them.
      const { vendor: chosen } = await window.turri.settings.get();
      if (chosen !== null && all.vendors.some((entry) => entry.id === chosen)) setVendor(chosen);
      setMaker(all.bedrockDefault.maker);
      setRegion(all.bedrockDefault.region);
      setPair(twoOf(placeIn(all, all.bedrockDefault.maker, all.bedrockDefault.region)?.pair));
    }, (failure: Error) => setError(plain(failure)));
    readProviders();
  }, []);

  // Given up before it started: the folder made for it goes again, while it is still empty.
  const cancel = () => {
    if (dir !== null) void window.turri.abandonProject(dir);
    onDone();
  };

  // Started once: its config is written once, with the models chosen when Create was pressed.
  const started = useRef(false);
  const start = async () => {
    if (dir === null || vendor === null || started.current) return;
    started.current = true;
    setStarting(true);
    try {
      const bedrock = vendor === "amazon-bedrock";
      const project = await window.turri.startProject(dir, vendor, bedrock ? { maker, region } : undefined, bedrock ? (pair ?? undefined) : undefined);
      if (project.failed !== undefined) {
        setUnready({ failed: project.failed, setup: project.setup });
        setStarting(false);
        return;
      }
      onDone();
      onOpened({ ...project, ...(startFrom !== null ? { startFrom } : {}) });
    } catch (failure) {
      started.current = false;
      setError(plain(failure as Error));
      setStarting(false);
    }
  };

  // The save sheet is the system's: nothing of the window's until a folder is chosen, unless that went wrong.
  if (dir === null && error === null) return null;
  const name = dir?.split("/").at(-1) ?? "";
  const models = (id: string) => {
    if (id === "amazon-bedrock") return pair ?? undefined;
    return vendors?.vendors.find((entry) => entry.id === id);
  };
  const regionsOf = (each: string) => vendors?.bedrock.find((entry) => entry.maker === each)?.regions ?? [];
  const choose = (nextMaker: string, nextRegion: string) => {
    const regions = regionsOf(nextMaker);
    const at = regions.find((entry) => entry.region === nextRegion) ?? regions[0];
    if (at === undefined) return;
    setMaker(nextMaker);
    setRegion(at.region);
    setPair(twoOf(at.pair));
  };
  const place = vendors === null ? undefined : placeIn(vendors, maker, region);
  /** The providers a vendor's two models come from - Other's are two - as the sign-in sheet has them. */
  const providersOf = (id: string) => {
    const shown = models(id);
    if (shown === undefined || providers === null) return [];
    const ids = [...new Set([shown.harness, shown.coding].map((model) => model.split("/")[0]!))];
    return ids.map((each) => providers.find((provider) => provider.id === each)).filter((provider) => provider !== undefined);
  };
  /** Whether a vendor's models can be started on here: signed in to every provider they come from - or not known yet. */
  const signedIn = (id: string) => providersOf(id).every((provider) => provider.connected);
  const unsigned = vendor === null ? [] : providersOf(vendor).filter((provider) => !provider.connected);

  return (
    <div className="sheet-backdrop">
      <div className={`sheet new-project ${unready ? "doctor" : ""}`}>
        {dir !== null && unready !== null ? (
          <Unready dir={dir} name={name} {...unready} onOpened={(project) => onOpened({ ...project, ...(startFrom !== null ? { startFrom } : {}) })} onDone={onDone} />
        ) : dir === null ? (
          <>
            <h2>the project was not made</h2>
            <p className="error-text">{error}</p>
            <div className="sheet-actions">
              <button className="button primary" onClick={onDone} autoFocus>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>which models does {name} use?</h2>
            <p className="muted">
              a strong one you talk to, and a smaller one that writes the code - turri writes them into its config.turri.yaml, which can change them later. not signed in to them yet? sign in here, with a subscription or an API key.
            </p>
            {vendors === null ? (
              <Spinner />
            ) : (
              <div className="options">
                {vendors.vendors.map((entry) => {
                  const shown = models(entry.id);
                  return (
                    <button key={entry.id} className={`option ${vendor === entry.id ? "on" : ""}`} onClick={() => setVendor(entry.id)} aria-pressed={vendor === entry.id}>
                      <span className="option-head">
                        <strong>{entry.label}</strong>
                        {providers !== null && (
                          <span className={`option-signed ${signedIn(entry.id) ? "on" : ""}`}>{signedIn(entry.id) ? "signed in" : "not signed in"}</span>
                        )}
                      </span>
                      {shown && (
                        <span className="option-detail">
                          you talk to {shown.harness} · it codes {shown.coding}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {vendor === "amazon-bedrock" && vendors && (
              <div className="bedrock">
                <div className="bedrock-row">
                  <span className="muted">whose models</span>
                  <div className="segmented wraps">
                    {vendors.bedrock.map((each) => (
                      <button key={each.maker} className={maker === each.maker ? "on" : ""} onClick={() => choose(each.maker, region)}>
                        {each.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bedrock-row">
                  <span className="muted">where</span>
                  <div className="segmented wraps">
                    {regionsOf(maker).map((each) => (
                      <button
                        key={each.region}
                        className={region === each.region ? "on" : ""}
                        onClick={() => choose(maker, each.region)}
                        title={each.inRegion ? "served in the AWS region it is called in" : `a cross-region profile: Bedrock runs it anywhere in ${each.region}`}
                      >
                        {each.inRegion ? "your AWS region" : each.region}
                      </button>
                    ))}
                  </div>
                </div>
                {pair !== null &&
                  (["harness", "coding"] as const).map((role) => (
                    <label key={role} className="bedrock-row">
                      <span className="muted">{role === "harness" ? "you talk to" : "it codes"}</span>
                      <select className="bedrock-model" value={pair[role]} onChange={(event) => setPair({ ...pair, [role]: event.target.value })} title={pair[role]}>
                        {(place?.models ?? []).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                            {model.reasoning ? "" : " - does not reason"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                {place?.inRegion ? (
                  <p className="muted small bedrock-note">these run in the AWS region turri calls Bedrock in: us-east-1, unless AWS_REGION in your shell names another.</p>
                ) : (
                  place?.awsRegion &&
                  (vendors?.setsRegion === true ? (
                    <p className="muted small bedrock-note">
                      turri calls these models in {place.awsRegion}, as they answer only in {place.region} - an AWS_REGION you set yourself wins over it, and so does your AWS profile's region when it is in {place.region}.
                    </p>
                  ) : (
                    <p className="muted small bedrock-note">
                      these models answer only when called in {place.region}: set AWS_REGION={place.awsRegion} in your shell - or in your AWS profile, if you signed in with one.
                    </p>
                  ))
                )}
              </div>
            )}
            {unsigned.length > 0 && (
              <div className="new-project-sign-in">
                <span className="muted small">
                  turri starts on these models once you are signed in to {unsigned.map((provider) => provider.name).join(" and ")}.
                </span>
                {unsigned.map((provider) => (
                  <button key={provider.id} className="button" onClick={() => setSigningIn(provider.id)} disabled={starting}>
                    <Icon name="key" /> sign in to {provider.name}
                  </button>
                ))}
              </div>
            )}
            {/* What its codebase starts from: nothing, or a folder - written as base-folder: once it opens, through /turri-config. */}
            <div className="new-project-start">
              <div className="bedrock-row">
                <span className="muted">start from</span>
                {startFrom === null ? <span>nothing - the code starts empty</span> : <code>{startFrom}</code>}
                <ChooseFolder root={dir!} onChosen={setStartFrom} label={startFrom === null ? "a folder…" : "another…"} />
                {startFrom !== null && (
                  <button className="link small" onClick={() => setStartFrom(null)}>
                    nothing
                  </button>
                )}
              </div>
              <p className="muted small">an existing codebase to build on, or files the code is to use - images, fonts. copied into the code before its first pulse; the folder itself is never written to.</p>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="sheet-actions">
              <button className="button" onClick={cancel} disabled={starting}>
                cancel
              </button>
              <button
                className="button primary"
                onClick={() => void start()}
                disabled={vendor === null || starting}
                title={unsigned.length > 0 ? "made now, it waits for you to sign in before turri starts on it" : undefined}
              >
                {starting ? (
                  <>
                    <Spinner /> starting turri…
                  </>
                ) : (
                  "create"
                )}
              </button>
            </div>
          </>
        )}
      </div>
      {signingIn !== null && <AuthSheet initial={signingIn} onClose={() => (setSigningIn(null), readProviders())} />}
    </div>
  );
}

/**
 * Made, its config written, but turri would not start on it - no credentials for the models chosen, most often: why,
 * and turri doctor's checks of the project, its models asked, each with what to do about it. A provider of its models
 * with no credentials is offered to sign in to, and once signed in to the project is opened again. Tried again once
 * seen to; the folder and its config stay either way.
 */
function Unready({ dir, name, failed, setup, onOpened, onDone }: { dir: string; name: string; failed: string; setup: string; onOpened: (project: Project) => void; onDone: () => void }) {
  const doctor = useDoctor(true, dir);
  const [error, setError] = useState(failed);
  const [opening, setOpening] = useState(false);
  // The providers its models come from that have no credentials here, and the sign-in sheet - open on one of them.
  const [unsigned, setUnsigned] = useState<AuthProvider[]>([]);
  const [signingIn, setSigningIn] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void window.turri.auth.providers(dir).then(({ providers }) => setUnsigned(providers.filter((provider) => provider.project && !provider.connected)), () => {});
  }, []);
  const again = async () => {
    setOpening(true);
    try {
      const project = await window.turri.openProject(dir);
      onDone();
      onOpened({ ...project, setup });
    } catch (failure) {
      setError(plain(failure as Error));
      setOpening(false);
      void doctor.run(true);
    }
  };
  return (
    <>
      <h2>{name} is made, but turri cannot start on its models yet</h2>
      <p className="error-text">{error}</p>
      <DoctorChecks doctor={doctor} />
      <div className="sheet-actions">
        {unsigned.length === 0 ? (
          <button className="button sheet-actions-start" onClick={() => setSigningIn(null)} disabled={opening}>
            <Icon name="key" /> sign in to your models…
          </button>
        ) : (
          unsigned.map((provider) => (
            <button key={provider.id} className="button sheet-actions-start" onClick={() => setSigningIn(provider.id)} disabled={opening}>
              <Icon name="key" /> sign in to {provider.name}
            </button>
          ))
        )}
        <button className="button" onClick={onDone} disabled={opening}>
          close
        </button>
        <button className="button primary" onClick={() => void again()} disabled={opening || doctor.checking}>
          {opening ? (
            <>
              <Spinner /> starting turri…
            </>
          ) : (
            "try again"
          )}
        </button>
      </div>
      {signingIn !== undefined && (
        <AuthSheet
          dir={dir}
          initial={signingIn}
          // Signed in: the sheet closes, and the project is opened again on the credential just stored.
          onSignedIn={() => (setSigningIn(undefined), void again())}
          onClose={() => setSigningIn(undefined)}
        />
      )}
    </>
  );
}

/** The two of a pair offered - not its strong one, which is the one you talk to unless named: turri judges with it. */
const twoOf = (pair: Pair | null | undefined): Pair | null => (pair ? { harness: pair.harness, coding: pair.coding } : null);

/** A maker's geography, as the engine offers it. */
const placeIn = (vendors: Vendors, maker: string, region: string) => vendors.bedrock.find((entry) => entry.maker === maker)?.regions.find((entry) => entry.region === region);

/** An error as the main process said it, without Electron's wrapping. */
function plain(failure: Error) {
  return String(failure.message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
