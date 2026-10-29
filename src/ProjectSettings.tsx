import { useEffect, useState } from "react";
import { Switch } from "./SettingsSheet.tsx";
import { Spinner, withPlain } from "./ui.tsx";

type Value = string | number | boolean | null;

/** A setting of config.turri.yaml as the engine gives it - turri's /turri-config catalogue, with what the file has now. */
type Setting = {
  key: string;
  about: string;
  kind: "boolean" | "choice" | "number" | "model" | "list" | "path" | "budget";
  /** What it is when it is not set. */
  unset: string;
  /** When a change takes effect, said to the person. */
  effect: string;
  /** Its words (choice), or the values offered first. */
  options: string[];
  /** What the file has, as /turri-config takes it back - null for unset. */
  value: string | null;
  /** What wins over it: models.chat over harness-model, a stack's file. */
  over: string[];
};

/**
 * A turri that does not give every setting (0.1.12 and before): the ones the summary has, so the sheet still changes
 * them. Their words and models are asked of /turri-config, as for every setting.
 */
function fromSummary(settings: Record<string, Value>): Setting[] {
  const few: Array<Omit<Setting, "value" | "over" | "effect" | "options">> = [
    { key: "harness-model", about: "the model you talk to: it writes the ***plain and plans the work", kind: "model", unset: "pi's own choice" },
    { key: "coding-model", about: "the model that writes the code", kind: "model", unset: "harness-model" },
    { key: "review", about: "whether the code and its tests are reviewed once they pass", kind: "boolean", unset: "true" },
    { key: "parallel-jobs", about: "how many pulses run at once, on modules that share nothing", kind: "number", unset: "half this machine's cores, one to four" },
    { key: "debug", about: "whether turri keeps what it writes for debugging it - agents' logs and sessions, pulse logs, outputs", kind: "boolean", unset: "false" },
  ];
  return few.filter(({ key }) => key in settings).map((each) => ({ ...each, effect: "", options: [], over: [], value: settings[each.key] === null ? null : String(settings[each.key]) }));
}

/** A model as config.turri.yaml writes it - provider/id, and how hard it thinks after a colon - taken apart. */
function splitModel(spec: string): { model: string; level: string } {
  const colon = spec.lastIndexOf(":");
  return colon > spec.lastIndexOf("/") ? { model: spec.slice(0, colon), level: spec.slice(colon + 1) } : { model: spec, level: "" };
}

/** What /turri-config offers for what is typed after it - turri's own choices, asked of the engine. */
const choicesFor = (typed: string) => window.turri.call<string[]>("configChoices", { typed }).catch(() => [] as string[]);

/**
 * A list to choose from - what is set now in it even when turri does not offer it, a model not signed in to, say - and
 * `blank`, when given, the choice of none: unset, or no thinking level of its own.
 */
function Choose({ value, options, onChange, label, blank }: { value: string; options: string[] | null; onChange: (value: string) => void; label: string; blank?: string }) {
  if (options === null) return <Spinner />;
  const all = value === "" || options.includes(value) ? options : [value, ...options];
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} title={value}>
      {blank !== undefined && <option value="">{blank}</option>}
      {all.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** A model setting: which model, of those turri can reach here, and how hard it thinks. */
function ModelSetting({ setting, onChange }: { setting: Setting; onChange: (value: string) => void }) {
  const { model, level } = splitModel(setting.value ?? "");
  const [models, setModels] = useState<string[] | null>(null);
  const [levels, setLevels] = useState<string[] | null>(null);
  useEffect(() => void choicesFor(`${setting.key} `).then(setModels), [setting.key]);
  useEffect(() => {
    setLevels(null);
    if (model !== "") void choicesFor(`${setting.key} ${model}:`).then((offered) => setLevels(offered.map((each) => splitModel(each).level).filter((each) => each !== "")));
  }, [setting.key, model]);
  return (
    <span className="model-setting">
      <Choose value={model} options={models} onChange={(next) => onChange(next === "" ? "unset" : level ? `${next}:${level}` : next)} label={setting.key} blank={`unset - ${setting.unset}`} />
      {model !== "" && <Choose value={level} options={levels} onChange={(next) => onChange(next ? `${model}:${next}` : model)} label={`how hard ${setting.key} thinks`} blank="its own thinking" />}
    </span>
  );
}

/** A number, a share, a path, a list: typed, with turri's values offered - sent once it is entered or left. */
function TextSetting({ setting, onChange }: { setting: Setting; onChange: (value: string) => void }) {
  const [text, setText] = useState(setting.value ?? "");
  useEffect(() => setText(setting.value ?? ""), [setting.value]);
  const [offered, setOffered] = useState<string[]>(setting.options);
  // A path's and a list's values are the project's - its scripts, its dotenv files, the ***plain rules - asked of turri.
  useEffect(() => {
    if (setting.kind === "path" || setting.kind === "list") void choicesFor(`${setting.key} `).then((more) => setOffered([...new Set([...setting.options, ...more])]));
  }, [setting.key, setting.kind]);
  const send = () => text.trim() !== (setting.value ?? "") && onChange(text.trim() === "" ? "unset" : text.trim());
  const list = `choices-${setting.key}`;
  return (
    <>
      <input
        className="text-setting"
        value={text}
        placeholder={`unset - ${setting.unset}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && send()}
        onBlur={send}
        list={offered.length > 0 ? list : undefined}
        aria-label={setting.key}
        title={setting.kind === "list" ? "several, by commas" : undefined}
      />
      {offered.length > 0 && (
        <datalist id={list}>
          {offered.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** The settings that name a folder, by path from the project's: chosen in the system's sheet, as well as typed. */
const FOLDERS = new Set(["base-folder", "test-dir"]);

/**
 * A folder chosen in the system's sheet, its path from `root` given to `onChosen` - or why it cannot be one: the
 * project's own folder, one that holds it, turri's plain_modules. Shared with the new project's sheet.
 */
export function ChooseFolder({ root, onChosen, label = "choose…" }: { root: string; onChosen: (path: string) => void; label?: string }) {
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <>
      <button
        className="button small"
        onClick={() =>
          void window.turri.pickFolder(root).then((picked) => {
            if (picked === null) return;
            if ("refused" in picked) return setRefused(picked.refused);
            setRefused(null);
            onChosen(picked.path);
          })
        }
      >
        {label}
      </button>
      {refused !== null && (
        <span className="choose-refused small" role="alert">
          {withPlain(refused)}
        </span>
      )}
    </>
  );
}

/** One setting: its control by its kind, what it does and when a change takes effect, and what wins over it. */
function SettingRow({ setting, onChange, dir }: { setting: Setting; onChange: (value: string) => void; dir: string }) {
  const [choices, setChoices] = useState<string[] | null>(setting.kind === "choice" && setting.options.length > 0 ? setting.options : null);
  useEffect(() => {
    if (setting.kind === "choice" && choices === null) void choicesFor(`${setting.key} `).then(setChoices);
  }, [setting.key]);
  const control =
    setting.kind === "boolean" ? (
      <Switch on={(setting.value ?? setting.unset) === "true"} onChange={(on) => onChange(String(on))} label={setting.key} />
    ) : setting.kind === "model" ? (
      <ModelSetting setting={setting} onChange={onChange} />
    ) : setting.kind === "choice" ? (
      <Choose value={setting.value ?? ""} options={choices} onChange={(next) => onChange(next === "" ? "unset" : next)} label={setting.key} blank={`unset - ${setting.unset}`} />
    ) : FOLDERS.has(setting.key) ? (
      <>
        <TextSetting setting={setting} onChange={onChange} />
        <ChooseFolder root={dir} onChosen={onChange} />
      </>
    ) : (
      <TextSetting setting={setting} onChange={onChange} />
    );
  return (
    <div className="project-setting">
      <div className="preference">
        <span className="setting-key">{setting.key}</span>
        <span className="setting-control">
          {control}
          {setting.value !== null && (
            <button className="link small" onClick={() => onChange("unset")} title={`unset it - ${setting.unset}`}>
              reset
            </button>
          )}
        </span>
      </div>
      <p className="muted small">
        {withPlain(setting.about)}
        {setting.value === null && setting.kind === "boolean" ? ` - unset, ${setting.unset}` : ""}
        {setting.effect ? `; ${setting.effect}.` : ""}
      </p>
      {setting.over.map((note) => (
        <p key={note} className="setting-over small">
          {note}
        </p>
      ))}
    </div>
  );
}

/**
 * The project's settings - every one of its config.turri.yaml, as /turri-config knows them - behind the sidebar's gear.
 * Each change is sent as the person would type it, /turri-config review false: turri checks it, writes it into the file
 * with its comments kept, and says in the chat when it takes effect. The sheet reads the file again once it changes.
 */
export function ProjectSettingsSheet({ dir, settings, onClose, onOpenFile }: { dir: string; settings: Record<string, Value>; onClose: () => void; onOpenFile: () => void }) {
  const [all, setAll] = useState<Setting[] | null>(null);
  // Read again as the summary is - once the file changes.
  useEffect(() => {
    void window.turri.call<Setting[] | null>("projectSettings").then((given) => setAll(given ?? fromSummary(settings)), () => setAll(fromSummary(settings)));
  }, [settings]);
  // What was sent and is not in the file yet: shown as chosen, until the file is read again.
  const [sent, setSent] = useState<Record<string, string>>({});
  useEffect(() => setSent({}), [all]);
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const change = (key: string, value: string) => {
    setSent((before) => ({ ...before, [key]: value }));
    void window.turri.call("sendChat", { text: `/turri-config ${key} ${value}` });
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (all ?? [])
    .map((setting) => (setting.key in sent ? { ...setting, value: sent[setting.key] === "unset" ? null : sent[setting.key]! } : setting))
    .filter((setting) => words.every((word) => `${setting.key} ${setting.about}`.toLowerCase().includes(word)));
  const main = shown.filter((setting) => !setting.key.startsWith("models."));
  const byRole = shown.filter((setting) => setting.key.startsWith("models."));
  const row = (setting: Setting) => <SettingRow key={setting.key} setting={setting} dir={dir} onChange={(value) => change(setting.key, value)} />;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet preferences project-settings" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="project settings">
        <h2>project settings</h2>
        <p className="muted small">this project's config.turri.yaml. a change is sent to turri as /turri-config, and it says in the chat when it takes effect.</p>
        <input className="settings-filter" type="search" placeholder="find a setting" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="find a setting" />
        {all === null ? (
          <p className="muted">
            <Spinner /> reading…
          </p>
        ) : (
          <div className="project-settings-list">
            <section>{main.map(row)}</section>
            {byRole.length > 0 && (
              <section>
                <button className="link settings-roles" onClick={() => setRoles(!roles)} aria-expanded={roles || words.length > 0}>
                  {roles || words.length > 0 ? "▾" : "▸"} each role's model - the planner's, the reviewer's, … ({byRole.filter((setting) => !setting.key.endsWith(".turn-limit")).length})
                </button>
                {(roles || words.length > 0) && byRole.map(row)}
              </section>
            )}
            {main.length + byRole.length === 0 && <p className="muted small">no setting is called that.</p>}
          </div>
        )}
        <div className="sheet-actions">
          <button className="button" onClick={onOpenFile}>
            open config.turri.yaml
          </button>
          <button className="button primary" onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}
