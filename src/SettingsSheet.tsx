import { useEffect, useState } from "react";
import type { AppSettings, ThemeList } from "../electron/preload.ts";
import type { ThemeInfo } from "../electron/themes.ts";
import type { UpdateState } from "../electron/updates.ts";
import { keys } from "./platform.ts";
import { Icon, Spinner } from "./ui.tsx";

/** A theme by a few of its colours: its background, text, accent, regenerated and conformance tested. */
function Swatch({ theme }: { theme: ThemeInfo | undefined }) {
  if (theme === undefined) return null;
  return (
    <span className="theme-swatch" aria-hidden>
      {theme.swatch.map((colour, at) => (
        <i key={at} style={{ background: colour }} />
      ))}
    </span>
  );
}

/** A choice of theme: the dark ones, the light ones and the person's own - and, for the window's, the system's. */
function ThemePicker({ list, value, onChange, label, system = false }: { list: ThemeList; value: string; onChange: (id: string) => void; label: string; system?: boolean }) {
  const groups: Array<[string, ThemeInfo[]]> = [
    ["dark", list.themes.filter((each) => each.file === undefined && each.appearance === "dark")],
    ["light", list.themes.filter((each) => each.file === undefined && each.appearance === "light")],
    ["your own", list.themes.filter((each) => each.file !== undefined)],
  ];
  const known = value === "system" || list.themes.some((each) => each.id === value);
  return (
    <span className="theme-picker">
      <Swatch theme={list.themes.find((each) => each.id === value)} />
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {system && <option value="system">same as the system</option>}
        {!known && <option value={value}>{value.replace(/^own:/, "")} - gone</option>}
        {groups
          .filter(([, themes]) => themes.length > 0)
          .map(([group, themes]) => (
            <optgroup key={group} label={group}>
              {themes.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </span>
  );
}

/** Electron's zoom levels: each about 20% bigger or smaller than the one before. */
const percent = (zoom: number) => `${Math.round(100 * 1.2 ** zoom)}%`;

/** A setting that is on or off: the app's here, and a project's in its settings sheet. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button className={`setting-switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      {on ? "on" : "off"}
    </button>
  );
}

/** Where the app's updates are, in a line. */
function updateLine(state: UpdateState | null): string {
  if (state === null) return "";
  if (state.status === "off") return `turri cannot update itself here: ${state.reason}.`;
  if (state.status === "checking") return "checking for an update…";
  if (state.status === "downloading") return `downloading turri ${state.version} - ${state.percent}%`;
  if (state.status === "ready") return `turri ${state.version} is ready: restart to update.`;
  if (state.status === "available") return `turri ${state.version} is out: download it from GitHub - this one cannot update itself.`;
  if (state.status === "failed") return `the last check failed: ${state.error}`;
  return "up to date, as of the last check.";
}

/**
 * The app's settings (⌘,): its look, the models a new project starts on, how it updates itself, which turri it runs,
 * and what it sends - each saved as it is changed, for every window. What a project runs on is its own config's.
 */
export function SettingsSheet({ onClose, onPrivacy }: { onClose: () => void; onPrivacy: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vendors, setVendors] = useState<Array<{ id: string; label: string }> | null>(null);
  const [updates, setUpdates] = useState<UpdateState | null>(null);
  const [version, setVersion] = useState<Awaited<ReturnType<typeof window.turri.turriVersion>> | null>(null);
  const [app, setApp] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeList | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);

  useEffect(() => {
    void window.turri.settings.get().then(setSettings);
    void window.turri.updates.state().then(setUpdates);
    void window.turri.turriVersion().then(setVersion);
    void window.turri.about.info().then((info) => setApp(info.app));
    void window.turri.themes.list().then(setThemes);
    void window.turri.vendors().then((all: { vendors: Array<{ id: string; label: string }> }) => setVendors(all.vendors), () => setVendors([]));
    const off = [window.turri.on("settings", setSettings), window.turri.on("updates", setUpdates), window.turri.on("themes", setThemes)];
    return () => off.forEach((stop) => stop());
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const change = (next: Partial<AppSettings>) => void window.turri.settings.set(next).then(setSettings);
  const importTheme = () =>
    void window.turri.themes.import().then((result) => {
      if (result === null) return;
      setThemeError("error" in result ? result.error : null);
    });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet preferences" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="settings">
        <h2>settings</h2>
        {settings === null ? (
          <p className="muted">
            <Spinner /> reading…
          </p>
        ) : (
          <>
            <section>
              <h3>appearance</h3>
              <div className="preference">
                <span>theme</span>
                {themes === null ? <Spinner /> : <ThemePicker list={themes} value={settings.theme} onChange={(theme) => change({ theme })} label="theme" system />}
              </div>
              {themes !== null && settings.theme === "system" && (
                <>
                  <div className="preference">
                    <span>while the system is light</span>
                    <ThemePicker list={themes} value={settings.lightTheme} onChange={(lightTheme) => change({ lightTheme })} label="the theme while the system is light" />
                  </div>
                  <div className="preference">
                    <span>while it is dark</span>
                    <ThemePicker list={themes} value={settings.darkTheme} onChange={(darkTheme) => change({ darkTheme })} label="the theme while the system is dark" />
                  </div>
                </>
              )}
              <div className="preference">
                <span>text size</span>
                <div className="segmented">
                  <button onClick={() => change({ zoom: settings.zoom - 0.5 })} title={`smaller (${keys("−")})`} aria-label="smaller">
                    −
                  </button>
                  <button onClick={() => change({ zoom: 0 })} className={settings.zoom === 0 ? "on" : ""} title={`actual size (${keys("0")})`}>
                    {percent(settings.zoom)}
                  </button>
                  <button onClick={() => change({ zoom: settings.zoom + 0.5 })} title={`bigger (${keys("+")})`} aria-label="bigger">
                    +
                  </button>
                </div>
              </div>
              <div className="preference">
                <span>your own</span>
                <span className="preference-buttons">
                  <button className="button small" onClick={importTheme}>
                    import a theme…
                  </button>
                  <button className="button small" onClick={() => void window.turri.themes.reveal()}>
                    open the themes folder
                  </button>
                </span>
              </div>
              <p className="muted small">
                a base16 or base24 scheme, .yaml or .json - the format hundreds of palettes are published in, Catppuccin, Dracula and Nord among them. one saved in the
                themes folder is read again as it changes.
              </p>
              {themeError && <p className="error-text small">{themeError}</p>}
              {themes?.problems.map((problem) => (
                <p key={problem.file} className="error-text small">
                  {problem.file}: {problem.error}
                </p>
              ))}
            </section>

            <section>
              <h3>new projects</h3>
              <div className="preference">
                <span>start on</span>
                {vendors === null ? (
                  <span className="muted">
                    <Spinner /> reading turri's models…
                  </span>
                ) : (
                  <select value={settings.vendor ?? ""} onChange={(event) => change({ vendor: event.target.value === "" ? null : event.target.value })} aria-label="the models new projects start on">
                    <option value="">ask each time</option>
                    {vendors.map((each) => (
                      <option key={each.id} value={each.id}>
                        {each.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="muted small">which models the new-project sheet has chosen when it opens. a project's own models are in its config.turri.yaml, and stay as they are.</p>
            </section>

            <section>
              <h3>updates</h3>
              <div className="preference">
                <span>look for updates on its own</span>
                <Switch on={settings.checkUpdates} onChange={(on) => change({ checkUpdates: on })} label="look for updates on its own" />
              </div>
              <div className="preference">
                <span>pre-releases too</span>
                <Switch on={settings.prerelease} onChange={(on) => change({ prerelease: on })} label="pre-releases too" />
              </div>
              <div className="preference">
                <span className="muted small">{updateLine(updates)}</span>
                {updates?.status === "ready" ? (
                  <button className="button small primary" onClick={() => void window.turri.updates.install()}>
                    restart to update
                  </button>
                ) : updates?.status === "available" ? (
                  <a className="button small primary" href={updates.url} target="_blank" rel="noreferrer">
                    download
                  </a>
                ) : (
                  <button
                    className="button small"
                    disabled={updates === null || updates.status === "off" || updates.status === "checking" || updates.status === "downloading"}
                    onClick={() => void window.turri.updates.check().then(setUpdates)}
                  >
                    {updates?.status === "checking" ? <Spinner /> : <Icon name="reload" size={13} />} check now
                  </button>
                )}
              </div>
            </section>

            <section>
              <h3>turri</h3>
              <p className="small">
                {version === null
                  ? "…"
                  : version.from === "npm"
                    ? `turri ${version.label} comes with this app${app ? `, turri desktop ${app}` : ""}: a new turri arrives as an update of the app.`
                    : `turri from a clone, ${version.label} - run from source, as TURRI_DEV names it.`}
              </p>
              {version?.warning && <p className="error-text small">{version.warning}</p>}
            </section>

            <section>
              <h3>privacy</h3>
              <p className="small">
                no telemetry: the app collects nothing about how you use it. what turri sends goes to the model providers you choose, under your own account - your
                ***plain, code and conversation among it.{" "}
                <button className="link" onClick={onPrivacy}>
                  what turri sends, and where
                </button>
              </p>
            </section>
          </>
        )}
        <div className="sheet-actions">
          <button className="button primary" onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}
