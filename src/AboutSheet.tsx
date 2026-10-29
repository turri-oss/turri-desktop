import { useEffect, useState } from "react";
import type { Notice } from "../electron/preload.ts";
import { Jellyfish, PlainName, Spinner } from "./ui.tsx";

export type AboutTab = "about" | "privacy" | "notices";

const REPOSITORY = "https://github.com/turri-oss/turri-desktop";

/** What the app is made of: its version, turri's, and the runtime's. */
function About() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.turri.about.info>> | null>(null);
  useEffect(() => void window.turri.about.info().then(setInfo), []);
  if (info === null) return <Spinner />;
  const rows: Array<[string, string]> = [
    ["turri desktop", info.app],
    ["turri", info.turri.from === "npm" ? `${info.turri.label} (@turri-dev/cli)` : `a clone, ${info.turri.label}`],
    ["Electron", info.electron],
    ["Chromium", info.chromium],
    ["Node", info.node],
    ["system", info.os],
  ];
  return (
    <div className="about">
      <Jellyfish size={56} swimming={false} />
      <p>
        turri as an app, for people who do not live in a terminal: the <PlainName /> is the source of truth, and turri regenerates the code from it.{" "}
        <a href={REPOSITORY} target="_blank" rel="noreferrer">
          its source
        </a>
        , under the MIT licence.
      </p>
      <dl className="about-versions">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** What turri sends, and where - and what stays on this machine. docs/privacy.md says the same. */
function Privacy() {
  return (
    <div className="privacy">
      <p>
        <strong>the app collects no telemetry</strong> - no analytics, no crash reports, nothing of how you use it.
      </p>
      <h3>to the model providers you choose</h3>
      <p>
        turri is an agent: to write your <PlainName /> with you and build its code, it sends what it works on to the models your project's <code>config.turri.yaml</code> names - with your
        subscription or API key, under that provider's terms. that is:
      </p>
      <ul>
        <li>what you say in the chat, and the conversation so far - with the images you attach to it, and the files you attach when turri reads them;</li>
        <li>your <PlainName />, and the files of the project turri and its agents read - code, tests, templates, config;</li>
        <li>what commands and test runs print, and what the preview's terminal shows when turri reads it;</li>
        <li>the preview's pages when turri tries them - their text, controls and console, and screenshots of them;</li>
        <li>
          in the background, each functional spec you add or change that has no scenarios - with its module, and your project's <code>AGENTS.md</code> - for turri's test advisor to judge
          whether it needs testing scenarios. <code>test-advisor</code> off in the project settings stops it doing so by itself.
        </li>
      </ul>
      <p>check this machine's "ask the models too" sends each model a word, to see that it answers.</p>
      <h3>to the web</h3>
      <ul>
        <li>turri's agents can search the web, through DuckDuckGo, and read public pages - documentation, say. they never reach this machine's own servers that way.</li>
        <li>turri's browser tools go only to this machine's own servers (localhost), never the web.</li>
        <li>signing in to a provider opens its page in your browser.</li>
        <li>
          the app looks on GitHub for a newer release of itself - unless you turn that off in the settings. pi, which turri runs on, may ask pi.dev for its latest list of models; nothing of
          yours goes with it.
        </li>
      </ul>
      <h3>on this machine only</h3>
      <ul>
        <li>
          what you sign in with - tokens and API keys - in pi's <code>auth.json</code> (<code>~/.pi/agent/</code>), where the turri command line keeps it too;
        </li>
        <li>the conversations, in pi's sessions there; each pulse's ledger and logs, and what the test advisor made of each functional spec, in the project's <code>.turri</code> folder;</li>
        <li>the preview's cookies and storage, in memory - gone when the project closes;</li>
        <li>the app's own settings and recent projects, in its folder of the system's application support.</li>
      </ul>
    </div>
  );
}

/** Every package the app carries, each with its licence - its text a click away - and Chromium's, opened. */
function Notices() {
  const [notices, setNotices] = useState<{ packages: Notice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => void window.turri.about.notices().then(setNotices, (failure: Error) => setError(failure.message)), []);
  const all = notices?.packages ?? [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((each) => words.every((word) => `${each.name} ${each.license}`.toLowerCase().includes(word)));
  if (error !== null) return <p className="error-text">the notices could not be read: {error}</p>;
  if (notices === null) return <Spinner />;
  return (
    <div className="notices">
      <p className="small">
        turri desktop is made with {notices.packages.length} open source packages. Chromium's own licences are{" "}
        <button className="link" onClick={() => void window.turri.about.chromium()}>
          in a page of their own
        </button>
        .
      </p>
      <input className="recents-search" type="search" value={query} placeholder="search by name or licence" spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
      <ul className="notice-list">
        {shown.map((each) => {
          const key = `${each.name}@${each.version}`;
          return (
            <li key={key}>
              <button className="notice-row" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                <span className="notice-name">{each.name}</span>
                <span className="muted small">{each.version}</span>
                <span className="notice-licence">{each.license}</span>
              </button>
              {open === key && (
                <div className="notice-text">
                  {each.homepage && (
                    <a href={each.homepage} target="_blank" rel="noreferrer" className="small">
                      {each.homepage}
                    </a>
                  )}
                  <pre>{each.text || `${each.license}: the package ships no licence file of its own.`}</pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** About turri: what it is made of, what it sends where (privacy), and the third-party notices - a tab each. */
export function AboutSheet({ tab: initial, onClose }: { tab: AboutTab; onClose: () => void }) {
  const [tab, setTab] = useState<AboutTab>(initial);
  useEffect(() => setTab(initial), [initial]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet about-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="about turri">
        <div className="segmented" role="tablist">
          {(["about", "privacy", "notices"] as AboutTab[]).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? "on" : ""} onClick={() => setTab(name)}>
              {name === "notices" ? "third-party notices" : name}
            </button>
          ))}
        </div>
        <div className="about-body">{tab === "about" ? <About /> : tab === "privacy" ? <Privacy /> : <Notices />}</div>
        <div className="sheet-actions">
          <button className="button primary" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
