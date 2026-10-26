# Development

How the app is put together, and how to run it from source. For what the window offers, see [the window](window.md).

## How it is put together

```
electron/main.ts     the windows - one per project - native menus, dock - and the bridge to each window's engine
electron/preview.ts  the preview pane, and what turri's browser tools do in it
electron/terminal.ts the preview's terminal - a shell on a pty - and what turri's terminal tools do in it
electron/terminal-input.ts  the keys and the mouse as an xterm sends them, the modes a program turns on, text found on the screen
electron/preload.ts  what the window may ask of the app (window.turri)
electron/settings.ts the app's settings beyond its look: settings.json in its userData
scripts/notices.mjs  the third-party notices About lists, written to dist-electron/ as the app is built
engine/engine.mjs    a Node process per open project that imports turri's src/: the chats, the ***plain, the work
engine/chat.mjs      turri's session (createTurri) and its chats, each pi's agent session; their dialogs and notices become window events
engine/browser.mjs   the browser tools, a pi extension of the app's own beside turri's
engine/terminal.mjs  the terminal tools, another
src/                 the window: React, no UI kit
tests/               the window's tests, on a fixture project
```

turri comes from npm, as `@turri-dev/cli` - its host entry, `@turri-dev/cli/host` (turri's [docs/hosting.md](https://github.com/turri-oss/turri/blob/main/docs/hosting.md)): the session (`createTurri`) - its chats, each a pi session with turri in it, on one job registry and work loop the engine is told of, their questions put in the window's dialogs by chat - and what the window shows beside it. A turri without `createTurri` (0.1.16 and before) has its one chat made from its extension (`createTurriExtension`), and the window offers no more. It is compiled JavaScript, so the engine runs on Electron's own Node; nothing else need be installed. The terminal's pty is node-pty, which ships built for macOS: `npm install` makes its helper executable (`scripts/pty.mjs`), as npm holds back its own install script. Models and credentials are turri's as usual: the project's `config.turri.yaml` and pi's auth. turri's session records what it does in the project's ledger on its own, as a `host` run; the engine reads it back (`runViews`) when a project opens and as each pulse ends, for the regen view's earlier pulses, and hears it live (`onLedgerEvent`) for the failures it says - for looking up only: what runs and what is planned are the work loop's. A turri with no ledger shows neither.

The window is sandboxed (`sandbox: true`, `contextIsolation`), as any web page: its preload bundles to one file that requires only `electron`, and the window reaches the app only through `window.turri`, each call a message the main process checks - a path to open or reveal must be in the window's project, a folder to take away only the one the new-project sheet made, a sign-in only one of the sign-in methods, a setting only one there is. The window never navigates: a web link goes to the browser, nothing else is opened, and its page is granted only the clipboard. The preview's pages are sandboxed too, with no preload and sessions of their own. A new `window.turri` method is a new door: say in the main process what it accepts.

The third-party notices (`scripts/notices.mjs`, run by `npm run build` and `npm run dev`) are every package the app carries - `package.json`'s dependencies and theirs, what Vite bundles into the window, Electron - with its licence and its licence files' text, in `dist-electron/notices.json`; Chromium's `LICENSES.chromium.html` is copied beside it, as every build must carry it. A package bundled into the window that is new goes into the script's `IN_THE_WINDOW`.

## Running it

```bash
npm install
npm install-scripts approve electron esbuild   # if npm held back their install scripts; then npm rebuild
npm run dev        # Vite with hot reload, Electron on it
npm start          # a production build of the window, in Electron
```

On Linux, `npm install` builds node-pty for Linux, which needs a C++ toolchain (`build-essential` and `python3` on Debian and Ubuntu), and turri sandboxes its agents with bubblewrap (`bubblewrap`). Where the system confines unprivileged namespaces - Ubuntu 24.04 and later - Electron run from `node_modules` may stop with "the SUID sandbox helper binary was found, but is not configured correctly": give its helper to root, `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`, once after each install.

macOS names an app in the menu bar, the Dock and ⌘-Tab, and draws its icon, from its bundle - in development, the `Electron.app` in `node_modules`. `npm install` runs `scripts/brand.mjs`, which calls it turri - in the menu bar, and in the Dock and ⌘-Tab through a localised display name, as they read the bundle's folder name, `Electron.app`, otherwise - and gives it turri's icon and an identifier of its own (`dev.turri.app`: the Dock remembers the name it saw for Electron's), then signs it again ad hoc; `npm run brand` does it by hand. The icon is turri's logo on turri-dark (`build/icon.png`, `build/icon.icns`); `npm run icon` draws it again from `public/jellyfish/logo.svg`.

`npm run dev` runs the app on a turri clone's own sources when there is one beside this one (`../turri`) - for working on turri and the app together; `TURRI_DEV=<path to a clone> npm run dev` takes any other, and `npm run dev:npm` the package from npm, as `npm start` and a release do. Nothing is built or released for it - Node runs turri's TypeScript as it is - so a change to turri is in the app as soon as a project is opened again: each opens an engine of its own. Which turri runs is said on the welcome screen and at the foot of the sidebar - `turri 0.1.10 · npm`, or `turri local · main @ e553476 · 3 uncommitted` - and in the terminal where the app started. A clone without the commit the pinned version was published from is behind what this app is built against: the window says so, in amber, with what to do - `git pull` and `npm install` in it, or `npm run dev:npm` - and runs on it all the same; so does a package other than the pinned one, until `npm install`. The clone needs its own `npm install`.

Run from source, the app is Electron started by your terminal, and macOS's privacy protection asks about that terminal, not turri: a project in Desktop, Documents, Downloads or iCloud Drive opens only once the terminal (or the editor it runs in) is allowed there - System Settings > Privacy & Security > Files and Folders, then start it again. Until then a process there cannot even ask where it is (`EPERM: process.cwd failed ... uv_cwd`); the window says so in words, as it does for a folder gone or not readable. Projects kept elsewhere - `~/Work/...` - are never asked about.

To try a turri not yet on npm as a package, pack it and install the tarball: `npm pack` in the turri clone, then `npm install <path to the .tgz>` here.

## Packaging it

```bash
npm run dist       # release/: turri-<version>-mac-<arch>.dmg and .zip on macOS, an AppImage and a .deb on Linux
npm run dist:dir   # only the app, unpacked - release/mac-arm64/turri.app - quicker, for trying it
```

electron-builder packages it, as `electron-builder.yml` says: the window (`dist/`), the main process (`dist-electron/`), the engine and the dependencies - not the devDependencies, as Vite and esbuild bundle what the window and the main process use. The dependencies are copied by `scripts/after-pack.cjs`, every package `npm ls --omit=dev` lists and where npm put it: electron-builder's own collector hoists the tree again and drops peer dependencies and nested versions (`@langchain/core`, pi's `typebox`), and the engine stops at an import. Nothing is in an archive (`asar: false`) - the engine is forked as a file, and turri and pi read and start files beside their code - so the app is `Resources/app` as it is here. node-pty is Node-API, so it runs on Electron as npm installed it: nothing is rebuilt, and `npm run dist` makes its helper executable first. Each system is packaged on itself - the Linux one on Linux, where node-pty is built for Linux - for the machine's own architecture.

On macOS it is signed ad hoc - Apple silicon runs nothing unsigned - with no Developer ID or notarisation yet, so Gatekeeper asks before it first opens. It declares folders as documents it opens: a project dropped on the Dock icon, or opened with turri from Finder, opens in a window (`open-file`). Its userData is the same folder as in development (`turri-app`): the recent projects, appearance and settings are shared. That folder is named by `package.json`'s `name`, which stays `turri-app` though the repo is `turri-desktop` - renamed, the app would start with none of what it remembers; so do the window's own `turri-app.*` keys in localStorage.

As installed (`app.isPackaged`), the development hooks are not heard: TURRI_DEV - turri is always the package it was built with, and a TURRI_DEV in the person's shell is not passed to the engine - VITE_DEV_SERVER_URL, and TURRI_APP_OPEN, TURRI_APP_VIEW, TURRI_APP_SCREENSHOT and TURRI_APP_HIDDEN. To look inside a packaged window, start its binary with `--remote-debugging-port=<port>` and open a project from Finder - `open -a release/mac-arm64/turri.app <project dir>`.

## Releasing it

turri is pinned exactly, so a new turri is a new release of the app: pin it (`npm install --save-exact @turri-dev/cli@<version>`), raise `version` in `package.json`, commit, and push a tag of that version:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` checks that the tag is `package.json`'s version, makes a draft release of it on GitHub, and builds the app on macOS and Linux (`npm run release`), each uploading its builds and the `latest-mac.yml` or `latest-linux.yml` installed apps read. Publish the draft, by hand, to put it out.

Installed apps update themselves (`electron/updates.ts`, electron-updater): they check a while after they start and every four hours - unless turned off in the settings, and pre-releases only when the settings take them (`allowPrerelease`) - download what is newer on their own, and say so in the menu (turri > Restart to Update on macOS, Help on Linux) - and install it on that restart or the next time they quit, asking first while pulses run. Check for Updates… asks at once. Only as installed - from source, git pull is the update - and on macOS only when signed with a Developer ID, as Squirrel.Mac takes an update only from the app's own signer: an ad hoc build says it cannot update itself. `npm run dist:dir` leaves out the feed's `app-update.yml`; `npm run dist` has it.

## Checking a change

`npm run typecheck`, then `npm test`: it builds the app and runs its tests (`tests/`) - the real window, driven by Playwright's Electron support. Each test launches the app from the build on a copy of a fixture project (`tests/fixture/hello`), with its userData (`--user-data-dir`) and pi's folder (`PI_CODING_AGENT_DIR`) in a scratch folder of its own and a dummy `ANTHROPIC_API_KEY`, so it touches neither the person's recents nor their credentials - and calls no model: the welcome screen opening a recent project, the \*\*\*plain editor (its two layers measured alike, a save, a change on disk) and slash commands that only print. Its windows are drawn as ever but never shown nor brought forward, and the app keeps out of the Dock (`TURRI_APP_HIDDEN=1`), so a run takes neither the screen nor the focus from whoever is at the machine. `tests/app.ts` is the launch; `npx playwright test -g <name>` runs one, and a failure leaves a trace in `test-results/` (`npx playwright show-trace <it>`). A new test of the window goes there too, as long as it calls no model. `.github/workflows/test.yml` runs them on macOS and Linux - under a virtual display there - for each push to main and each pull request, and keeps a failure's traces as the run's artifact.

What a test does not reach, look at in the real window. `electron/main.ts` has hooks for that - `TURRI_APP_OPEN=<project dir>` opens a project at start, `TURRI_APP_VIEW=spec|work|stdlib` switches to a view, and `TURRI_APP_SCREENSHOT=<file.png>` captures the window after about 2.5s and quits:

```bash
npm run build && TURRI_APP_OPEN=../turri-projects/guestbook TURRI_APP_SCREENSHOT=/tmp/shot.png npx electron .
```

An app opened from Finder, the Dock or a desktop launcher is given launchd's or the session's few variables - `/usr/bin:/bin:/usr/sbin:/sbin`, no API keys - not the person's shell's. So as it starts, `electron/shell-env.ts` runs their login shell once, interactive (`$SHELL -ilc`, so `~/.zshrc` and `~/.bashrc` are read), takes its environment - its PATH in place of the app's, and every variable the app was not given - and every engine waits for it, so turri, its agents and the testing scripts find the toolchains and credentials the person's terminal has. Started from a terminal (`TERM` set), the app keeps the environment it was given; `TURRI_APP_SHELL_ENV=1` reads the shell's all the same. A shell that takes longer than 10 seconds is given up on, said in the terminal, and the app goes on with what it has. To try it as Finder starts it: `env -i HOME=$HOME USER=$USER SHELL=$SHELL PATH=/usr/bin:/bin:/usr/sbin:/sbin node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`

What differs between macOS and Linux is said in one place on each side: `MAC` in `electron/main.ts` - the window's chrome, the menus, the Dock - and `src/platform.ts` in the window - shortcuts as each system writes them, the key they are pressed with, the file manager's name. To look at the Linux window from a Mac, run it in a container under a virtual display (Xvfb): Debian with Electron's libraries (`libgtk-3-0 libnss3 libgbm1 libasound2`, ...), `npm ci` and `npm run build` in it, then `xvfb-run npx electron --no-sandbox .` with the hooks above. A project opens only with its model's credentials there - dummy ones will do, as opening calls no model.

Signing in writes pi's `auth.json` - the person's own, `~/.pi/agent/auth.json`, which the turri CLI reads too. To try the sign-in sheet, start the app with `PI_CODING_AGENT_DIR=<a scratch folder>`: pi then keeps its credentials, settings and device id there, every engine inherits it, and a fake API key can be saved and signed out of without touching the real file. A subscription's sign-in opens the provider's page in the browser; nothing is stored until it is completed there.

Regenerate, Preview plan and every chat message call the project's models and spend money; check with what calls none - opening a project, the \*\*\*plain, slash commands that only print - where you can.
