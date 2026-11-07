import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import type { TerminalState } from "../electron/terminal.ts";
import { MAC } from "./platform.ts";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** The terminal's colours, from the theme's tokens: xterm.js draws on a canvas, so it is given them as values. */
function themeNow(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const theme: Record<string, string> = { background: token("bg"), foreground: token("fg"), cursor: token("accent"), cursorAccent: token("bg"), selectionBackground: token("selected") };
  for (const name of ANSI) {
    theme[name] = token(`ansi-${name}`);
    theme[`bright${name[0]!.toUpperCase()}${name.slice(1)}`] = token(`ansi-bright-${name}`) || token(`ansi-${name}`);
  }
  return theme as ITheme;
}

/**
 * The preview's terminal: a shell in the project's folder, run by the main process (electron/terminal.ts) on a pty, and
 * drawn here with xterm.js from what it says. It is the same shell however often it is drawn - another view and back -
 * so it opens on what it has said so far. turri types into it too, with its terminal tools, as the person watches.
 */
export function TerminalPane({ onState }: { onState: (state: TerminalState) => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let gone = false;
    const offs: Array<() => void> = [];
    const term = new XTerm({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim(),
      fontSize: 12,
      lineHeight: 1.25,
      theme: themeNow(),
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.onData((data) => void window.turri.terminal.write(data));
    // On Linux ctrl+c is the shell's, so the terminal copies and pastes on ctrl+shift+c and ctrl+shift+v, as Linux
    // terminals do; macOS has ⌘C and ⌘V.
    if (!MAC)
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey || event.altKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c" && term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
        else if (key === "v") void navigator.clipboard.readText().then((text) => term.paste(text));
        else return true;
        event.preventDefault();
        return false;
      });

    // The theme changed - chosen, or the system's when it follows it - and the terminal's colours with it.
    const recolour = () => (term.options.theme = themeNow());
    const themeWatch = new MutationObserver(recolour);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

    const resize = () => {
      if (gone || element.clientWidth === 0) return;
      fit.fit();
      void window.turri.terminal.resize(term.cols, term.rows);
    };
    const sizeWatch = new ResizeObserver(resize);

    // Where turri clicks or turns the wheel: the cell marked a moment, so the person sees where.
    const point = ({ row, column, kind }: { row: number; column: number; kind: "click" | "scroll" }) => {
      const screen = element.querySelector(".xterm-screen");
      if (screen === null) return;
      term.scrollToBottom();
      const box = screen.getBoundingClientRect();
      const outer = element.getBoundingClientRect();
      const width = box.width / term.cols;
      const height = box.height / term.rows;
      const mark = document.createElement("div");
      mark.className = `terminal-pointer ${kind}`;
      Object.assign(mark.style, { left: `${box.left - outer.left + (column - 1) * width}px`, top: `${box.top - outer.top + (row - 1) * height}px`, width: `${width}px`, height: `${height}px` });
      element.appendChild(mark);
      setTimeout(() => mark.remove(), 900);
    };

    void (async () => {
      if (gone) return;
      term.open(element);
      // What the shell says from here on. What it said before the answer to open came is in what open replays:
      // the main process sends both on one channel, in order.
      let replayed = false;
      offs.push(window.turri.on("terminal:data", (data: string) => replayed && term.write(data)));
      offs.push(window.turri.on("terminal:reset", () => term.reset()));
      offs.push(window.turri.on("terminal:state", (state: TerminalState) => onState(state)));
      offs.push(window.turri.on("terminal:pointer", (at: { row: number; column: number; kind: "click" | "scroll" }) => point(at)));
      const opened = await window.turri.terminal.open();
      if (gone) return;
      replayed = true;
      term.write(opened.replay);
      onState(opened);
      resize();
      sizeWatch.observe(element);
      term.focus();
    })();

    return () => {
      gone = true;
      offs.forEach((off) => off());
      sizeWatch.disconnect();
      themeWatch.disconnect();
      term.dispose();
    };
  }, []);

  return <div className="preview-terminal" ref={host} />;
}
