// The app's icon: turri's logo mark (public/jellyfish/logo-mark.svg) on turri-dark's abyss, in macOS's icon grid - an 824px tile
// in a 1024px canvas. Writes build/icon.png and build/icon.icns: `npx electron scripts/icon.cjs`.
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const logo = readFileSync(join(ROOT, "public/jellyfish/logo-mark.svg")).toString("base64");

app.dock?.hide();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL("about:blank");
  const png = await window.webContents.executeJavaScript(`new Promise((done) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const g = canvas.getContext("2d");
      g.fillStyle = "#0a0f1a";
      g.beginPath();
      g.roundRect(100, 100, 824, 824, 185);
      g.fill();
      // The mark in the tile's middle, its pixels whole - 7 of them across and 8 down, 72 each.
      const width = 7 * 72;
      const height = 8 * 72;
      g.imageSmoothingEnabled = false;
      g.drawImage(image, (1024 - width) / 2, (1024 - height) / 2, width, height);
      done(canvas.toDataURL("image/png").split(",")[1]);
    };
    image.src = "data:image/svg+xml;base64,${logo}";
  })`);
  const out = join(ROOT, "build");
  writeFileSync(join(out, "icon.png"), Buffer.from(png, "base64"));
  // An iconset at every size macOS asks for, then iconutil's .icns.
  const set = join(out, "icon.iconset");
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [factor, suffix] of [[1, ""], [2, "@2x"]]) {
      execFileSync("sips", ["-z", String(size * factor), String(size * factor), join(out, "icon.png"), "--out", join(set, `icon_${size}x${size}${suffix}.png`)], { stdio: "ignore" });
    }
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", join(out, "icon.icns")]);
  rmSync(set, { recursive: true, force: true });
  app.quit();
});
