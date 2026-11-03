import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PreviewState } from "../electron/preview.ts";
import type { TerminalState } from "../electron/terminal.ts";
import { TerminalPane } from "./Terminal.tsx";
import { PreviewHome } from "./PreviewHome.tsx";
import type { Pane, Spec } from "./types.ts";
import { Empty, Icon, Jellyfish } from "./ui.tsx";
import type { Action } from "./actions.ts";

/** The blue edge round the pane while turri tests in it, in CSS pixels: as wide as `.preview.testing`'s in styles.css. */
const EDGE = 3;

/** The preview's three, in its switch: what there is to try, and the two it is tried in. */
const PANES: Pane[] = ["home", "browser", "terminal"];

const BLANK: PreviewState = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: null };

/** The address last open for each project, so its preview opens there again. */
const keyFor = (dir: string) => `turri-app.preview:${dir}`;
function savedUrl(dir: string): string {
  try {
    return localStorage.getItem(keyFor(dir)) ?? "";
  } catch {
    return "";
  }
}

/** What is typed in the address bar, as an address: `8000` and `localhost:8000` are http://localhost:8000. */
function addressOf(typed: string): string {
  const text = typed.trim();
  if (/^\d+(\/.*)?$/.test(text)) return `http://localhost:${text}`;
  return /^\w+:\/\//.test(text) ? text : `http://${text}`;
}

/**
 * The app turri builds: what there is to try of it - the home, as a project opens - and where it is tried, a browser
 * pane or a terminal, a switch in the bar going between the three. The browser: an address bar, and
 * below it the pane itself - a page of its own the main process lays over the space left here for it
 * (electron/preview.ts). Nothing of the window can draw over it, so it is taken away while something should: a sheet
 * open over the window, nothing loaded to show, or the terminal in its place. The terminal: a shell in the project's
 * folder (electron/terminal.ts), for a CLI. turri drives both with its browser and terminal tools, and the window comes
 * to the one it uses - edged in blue while it does, and the bar saying so.
 */
/** When a key was last pressed in the window, and how long after it the person is still typing. */
let lastKey = 0;
const TYPING_MS = 2000;
window.addEventListener("keydown", () => (lastKey = Date.now()), true);

export function PreviewView({
  dir,
  covered,
  pane,
  onPane,
  specs,
  onTry,
  onSentinel,
  testing,
  testingIn,
}: {
  dir: string;
  covered: boolean;
  pane: Pane;
  onPane: (pane: Pane) => void;
  /** The project's modules, for the home to say what there is to try. */
  specs: Spec[];
  /** try it, from the home: what it asks turri, as a button's action. */
  onTry: (action: Action) => void;
  /** Something chosen on the home for the sentinel to check, in a module's release - none on a turri whose sentinel cannot be asked. */
  onSentinel?: (module: string, names: string[]) => void;
  /** turri testing in the pane shown: edged in blue. */
  testing: boolean;
  /** Which of the two turri tests in, while it does: the other shown, its switch glows, inviting the person to it. */
  testingIn: Pane | null;
}) {
  const [state, setState] = useState<PreviewState>(BLANK);
  const [shell, setShell] = useState<TerminalState>({ running: false, program: "" });
  const [typed, setTyped] = useState("");
  // The address this project had last: offered, not opened - another project's app may answer there now.
  const [last, setLast] = useState("");
  const page = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = window.turri.on("preview:state", (next: PreviewState) => setState(next));
    void window.turri.preview.state().then((now) => {
      setState(now);
      // Nothing open yet: the address this project had last, in the bar to open - or the bar, to type one.
      const saved = savedUrl(dir);
      setLast(saved);
      if (!now.url) setTyped(saved);
      if (!now.url) address.current?.focus();
    });
    return off;
  }, [dir]);

  useEffect(() => {
    if (!state.url || state.error) return;
    try {
      localStorage.setItem(keyFor(dir), state.url);
    } catch {
      /* not kept: the preview opens empty next time */
    }
  }, [dir, state.url, state.error]);

  // The address bar says where the page is: wherever it goes - a link, turri - what was typed gives way to it.
  useEffect(() => {
    if (state.url) setTyped(state.url);
  }, [state.url]);

  // The pane over the space below the bar: placed while there is a page to show and nothing over it, and moved with it.
  const showing = pane === "browser" && state.url !== "" && state.error === null && !covered;
  useLayoutEffect(() => {
    const box = page.current;
    if (!showing || box === null) {
      void window.turri.preview.place(null);
      return;
    }
    // turri testing in it: the pane is drawn inside the blue edge, which the window draws round it.
    const inset = testing ? EDGE : 0;
    const place = () => {
      const { x, y, width, height } = box.getBoundingClientRect();
      void window.turri.preview.place({ x: x + inset, y: y + inset, width: width - 2 * inset, height: height - 2 * inset });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [showing, testing]);
  // Gone from the window - another view, another file - the pane goes too.
  useEffect(() => () => void window.turri.preview.place(null), []);
  // Shown, and each page it goes to while it is: the page has the keyboard, as a browser's tab does - its focused control
  // (a game's start button) hears enter and space with no click to take the focus from it - unless the person is typing
  // somewhere else in the window, which keeps it: a field with something in it, or keys pressed a moment ago. A field the
  // window focused by itself - the chat's empty message box, as a chat is shown - is no one typing. The preview's own
  // address bar and terminal give it up.
  useEffect(() => {
    if (!showing) return;
    const active = document.activeElement as HTMLElement | null;
    const field = active !== null && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable) && active.closest(".preview") === null;
    const written = field && ((active as HTMLInputElement).value ?? active.textContent ?? "").trim() !== "";
    const typing = field && (written || Date.now() - lastKey < TYPING_MS);
    if (!typing) void window.turri.preview.go("focus");
  }, [showing, state.url]);

  const open = (typed: string) => {
    if (!typed.trim()) return;
    address.current?.blur();
    void window.turri.preview.open(addressOf(typed));
  };

  // Said in the bar, above the pane it is in.
  const badge = testing && (
    <span className="preview-testing" role="status">
      <Jellyfish size={14} swimming={false} /> turri is testing
    </span>
  );

  const switcher = (
    <div className="segmented" role="tablist">
      {PANES.map((name) => (
        <button
          key={name}
          role="tab"
          aria-selected={pane === name}
          className={`${pane === name ? "on" : ""} ${testingIn === name && pane !== name ? "testing" : ""}`}
          onClick={() => onPane(name)}
          title={testingIn === name && pane !== name ? `turri is testing in the ${name} - watch it` : undefined}
        >
          {name}
        </button>
      ))}
    </div>
  );

  if (pane === "home")
    return (
      <div className="preview">
        <div className="preview-bar">{switcher}</div>
        <PreviewHome specs={specs} sentinel={onSentinel !== undefined} onAsk={onTry} onSentinel={(module, names) => onSentinel?.(module, names)} />
      </div>
    );

  if (pane === "terminal") {
    return (
      <div className={`preview${testing ? " testing" : ""}`}>
        <div className="preview-bar">
          {switcher}
          <span className="preview-program" title="what runs in the terminal now">
            {shell.running ? shell.program : "no shell running"} · {dir.replace(/^\/Users\/[^/]+/, "~")}
          </span>
          {badge}
          <button className="icon-button" onClick={() => void window.turri.terminal.restart()} title="a new shell - whatever runs in this one is stopped">
            <Icon name="reload" />
          </button>
        </div>
        <TerminalPane onState={setShell} />
      </div>
    );
  }

  return (
    <div className={`preview${testing ? " testing" : ""}`}>
      <div className="preview-bar">
        {switcher}
        <button className="icon-button" disabled={!state.canGoBack} onClick={() => void window.turri.preview.go("back")} title="back">
          <Icon name="back" />
        </button>
        <button className="icon-button" disabled={!state.canGoForward} onClick={() => void window.turri.preview.go("forward")} title="forward">
          <Icon name="forward" />
        </button>
        <button className="icon-button" disabled={!state.url} onClick={() => void window.turri.preview.go(state.loading ? "stop" : "reload")} title={state.loading ? "stop" : "reload"}>
          <Icon name={state.loading ? "x" : "reload"} />
        </button>
        <form
          className="preview-address"
          onSubmit={(event) => {
            event.preventDefault();
            open(typed);
          }}
        >
          <input
            ref={address}
            value={typed}
            placeholder="localhost:8000"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTyped(state.url);
                event.currentTarget.blur();
              }
            }}
          />
        </form>
        <button className="icon-button" disabled={!state.url} onClick={() => void window.turri.preview.go("devtools")} title="developer tools for the page">
          <Icon name="code" />
        </button>
        {badge}
        {state.loading && <span className="preview-loading" />}
      </div>
      <div className="preview-page" ref={page}>
        {!state.url ? (
          <Empty icon="globe" title="open the app you are building">
            type its address above - <kbd>localhost:8000</kbd>, say. turri can open it here too, and see and try it as you watch.
            {last && (
              <span className="preview-retry">
                <button className="button" onClick={() => open(last)}>
                  <Icon name="globe" /> open {last.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </button>
              </span>
            )}
          </Empty>
        ) : state.error !== null ? (
          <Empty icon="warn" title="nothing answers there">
            {state.error}. Start the app - or ask turri to release it - then reload.
            <span className="preview-retry">
              <button className="button" onClick={() => void window.turri.preview.go("reload")}>
                <Icon name="reload" /> reload
              </button>
            </span>
          </Empty>
        ) : null}
      </div>
    </div>
  );
}
