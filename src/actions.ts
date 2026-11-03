// A button that asks turri something in the person's place - try it, write testing scenarios, investigate - sends its
// prompt as theirs, and the chat shows the button's own message, by its kind: what it asked, never the prompt as if they
// had typed it. Each kind has its name, icon and colour here; the engine (engine/entries.mjs) and the main process
// (electron/main.ts) know the same kinds.

/** The kinds of a button's action. */
export type ActionKind = "try" | "convert" | "scenarios" | "start" | "investigate" | "conform";

/** What a button asks: its kind, what the chat shows of it - a title and, if it says more, a detail - and the prompt turri hears. */
export interface Action {
  kind: ActionKind;
  title: string;
  detail?: string;
  prompt: string;
}

/** How the chat shows each kind: its name, its icon and the colour it is edged and named in (a token of styles.css). */
export const ACTION_LOOK: Record<ActionKind, { name: string; icon: string; tone: string }> = {
  try: { name: "try it", icon: "play", tone: "var(--testing)" },
  convert: { name: "convert", icon: "reload", tone: "var(--amber)" },
  scenarios: { name: "write testing scenarios", icon: "test", tone: "var(--tested)" },
  start: { name: "work out what to build", icon: "spark", tone: "var(--accent)" },
  investigate: { name: "investigate", icon: "eye", tone: "var(--red)" },
  conform: { name: "conform", icon: "checks", tone: "var(--tested)" },
};

/** The look of a kind the window may not know - one a newer engine sends: as a plain request. */
export const lookOf = (kind: string) => ACTION_LOOK[kind as ActionKind] ?? { name: kind, icon: "spark", tone: "var(--accent)" };
