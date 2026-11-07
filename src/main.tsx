import { createRoot } from "react-dom/client";
import type { ResolvedTheme } from "../electron/themes.ts";
import { App } from "./App.tsx";
import "./pixels/turri-pixels.css";
import "./styles.css";
import "./types.ts";

// Dark until the app says otherwise: no light flash before the choice arrives.
document.documentElement.dataset.theme = "dark";
// macOS draws the window to its top edge, under the traffic lights; Linux has its window manager's title bar.
document.documentElement.dataset.platform = window.turri.platform;

/**
 * The theme: dark or light - the stylesheet's turri-dark or turri-light - and, for any other, its colour tokens set over
 * them on :root, those of the theme before taken away.
 */
let themed: string[] = [];
function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  for (const name of themed) root.style.removeProperty(`--${name}`);
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
  themed = Object.keys(theme.tokens);
  root.dataset.theme = theme.appearance;
  root.dataset.themeId = theme.id;
}
void window.turri.theme().then(applyTheme);
window.turri.on("theme", applyTheme);
// Full screen: no traffic lights, so nothing to leave room for.
window.turri.on("fullscreen", (on: boolean) => (document.documentElement.dataset.fullscreen = String(on)));

createRoot(document.getElementById("root")!).render(<App />);
