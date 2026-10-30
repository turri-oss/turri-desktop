<p align="center"><img src="docs/images/turri-desktop-banner.gif" alt="turri desktop, beside its mark - the first coding agent with the power of regenerative software - and a pixel jellyfish regenerating, from a polyp on the sea floor"></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="macOS and Linux">
  <a href="https://www.npmjs.com/package/@turri-dev/cli"><img src="https://img.shields.io/badge/turri-0.2.0-ff5fa2" alt="runs turri 0.2.0"></a>
  <a href="https://discord.com/invite/REJzFmVQfC"><img src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Join the turri Discord"></a>
</p>

**turri** builds regenerative software: what lasts is the system's intent, and the code is derived from it - cheap to throw away and build again. You tell **turri** what the system should do; **turri** writes that down as durable intent, with the tests that say when it is met, and builds the code from it. From then on the durable intent is the source of truth: as it changes, the code is regenerated from it rather than patched in place, and never left to drift from it.

**turri desktop** is turri as a desktop app for macOS and Linux. It runs turri's own conversation and work loop - the same chat, tools, slash commands, skills and pulses as `turri` on the command line - and shows them in native UI: the \*\*\*plain beside the chat, every pulse live, and the app being built, tried in a browser or a terminal of its own. turri itself, the command line, is at [turri-oss/turri](https://github.com/turri-oss/turri).

<p align="center"><img src="docs/images/turri-desktop.png" alt="turri desktop with the guestbook project open: the project's files and settings on the left, backend.plain in the middle with each functional spec's state, and the chat with turri on the right"></p>

## Quick start

### Install it

Download it from the [latest release](https://github.com/turri-oss/turri-desktop/releases/latest) - turri comes with it, so there is nothing else to install for the app itself. You need git, which turri works with, and on Linux bubblewrap, turri's sandbox there. Once installed, the app updates itself on Linux; on macOS it does not yet.

**macOS** (Apple silicon) - `turri-<version>-mac-arm64.dmg`: open it and drag turri into Applications. The app is not signed with a Developer ID or notarised yet, so the first time you open it macOS says it cannot check it: choose Done, then System Settings > Privacy & Security > Open Anyway beside turri, and open it again. Or, in a terminal, once:

```bash
xattr -dr com.apple.quarantine /Applications/turri.app
```

**Debian, Ubuntu** (x64) - `turri-<version>-linux-amd64.deb`:

```bash
sudo apt install bubblewrap git ./turri-*-linux-amd64.deb
```

**Other Linux** (x64) - `turri-<version>-linux-x86_64.AppImage`: make it executable and run it, with bubblewrap and git installed. AppImages need FUSE 2 (`libfuse2`).

```bash
chmod +x turri-*-linux-x86_64.AppImage && ./turri-*-linux-x86_64.AppImage
```

### Or run it from source

On macOS or Linux. You need [Node](https://nodejs.org/en/download) 22.19 or newer to build it, and git. On Linux, also a C++ toolchain - the preview's terminal (node-pty) is built for Linux as it installs, where macOS has it ready - and bubblewrap, turri's sandbox there:

```bash
sudo apt install build-essential python3 bubblewrap   # Debian, Ubuntu; dnf install gcc-c++ make python3 bubblewrap on Fedora
```

```bash
git clone git@github.com:turri-oss/turri-desktop.git && cd turri-desktop
npm install
npm start
```

turri itself comes with it, from npm, and runs on Electron's own Node: nothing else is installed. If npm held back Electron's or esbuild's install scripts, run `npm install-scripts approve electron esbuild` and `npm rebuild`.

`npm run dist` packages it as the release does, into `release/`: a `.dmg` and a `.zip` on macOS, an AppImage and a `.deb` on Linux.

### Your first project

On the welcome screen, **start a new project** - name its folder, choose its models: Anthropic, OpenAI, Google, Amazon Bedrock or any other pi supports - or **open** a folder that has turri's `config.turri.yaml` in it. Models are reached as in turri: the provider's API key exported in your shell (`ANTHROPIC_API_KEY`, ... - the app reads your login shell's environment as it starts, so it has your keys and PATH even opened from Finder or the Dock), a sign-in from the window - File > Sign In to Model Providers…, with a subscription in your browser or an API key - which is what pi has from a `/login` in turri too, or a cloud account - see turri's [models](https://github.com/turri-oss/turri#models).

Then tell turri what to build:

> a small API where people can register and sign in

## A tour

- **turri**, on the left (⌘J) - the conversation. It writes the \*\*\*plain with you and regenerates the code from it; tool calls show as what they do, and turri's questions are docked in the chat as buttons. Type `/` for its commands. ⌘T opens another chat beside it, as a tab, ctrl+tab goes between them - and, with the focus in the views, between \*\*\*plain and preview - and ⌘W closes one - each its own conversation, on the project's one work loop. The sentinel, turri's own, works in the background with no tab: it checks every pulse that finishes and tests what was released, in the preview - what it did of each pulse is in that pulse's card in the dive - and what needs you comes to your chat as a notice - a card, its actions as buttons.
- **files**, on the right - the project's \*\*\*plain: each with how much of it is built, its test plain files - each functional spec's scenarios - the templates it imports and the resources it links, nothing else - or, with debug on, every file of the project. File > Project Settings… in the menu bar opens the project's settings, every one of its config.turri.yaml.
- **\*\*\*plain** (⌘1) - the `.plain` file, coloured by turri's \*\*\*plain grammar, with each functional spec's state beside it: pink when its code is built, cyan when its conformance tests pass too - and its scenarios counted at its heading, or, with none, whether it needs them, evaluated in the background. Click a mark to regenerate that functional spec, conform it, or have its testing scenarios evaluated - only that one; with conformance tests off (`conformance-tests:`, off unless set), its scenarios show untested and **turn on** turns them on, testing at once what has scenarios and code; **regenerate** asks how much to rebuild.
- **problems and notifications**, along the bottom of every view - as an IDE's: the \*\*\*plain that does not parse and the conformance tests waiting on a step of adding tests, each with its file, what the window was told - a pulse's end among it, shown in the \*\*\*plain from there - kept until you dismiss it, and the sentinel's notices, answered there. A new error or notice opens the panel; nothing floats over the window.
- **regen** (⌘2) - the dive, a screen of its own in the window's place - no chat, no preview - opened by the dive button at the toolbar's right: every pulse live, each a card closed to its head - how it is going, what it cost - that opens on its report and the \*\*\*plain it works on; earlier sessions' pulses from turri's ledger below.
- **preview** (⌘3) - the app you are building, in a browser pane or a terminal in the project's folder - whichever is in use, empty until one is, and a switch between them once both are. turri tries it there too - opening pages, clicking, running commands - and the preview glows while it does, inviting you to watch, without the window ever taking you there; there, the pane is edged in blue while turri is testing. After each pulse - with release-after-pulse on, as a new project has it - turri releases what it built into `dist/`, starts it, opens it here and tells you what to test.
- **stdlib** (\*\*\*plain > Standard Library, ⌘4) - turri's standard library, to look through: every template by its kind, the ones the project builds on marked, each as its \*\*\*plain with what it imports and its conformance tests. In the \*\*\*plain view, every \*\*\*plain says what it imports and requires and what requires or imports it, each a button - up and down the requires chain, a stdlib module opening there - or ⌘-click a module in its front matter.
- **Sign in to your models** (File menu, the welcome screen, or `/login` in the chat) - every model provider pi knows, searchable, each connected or not and how: sign in with a subscription in your browser - Claude Pro/Max, ChatGPT, GitHub Copilot - or type an API key. No terminal needed; it is kept where the turri CLI keeps it.
- **Check this machine** (Help menu) - `turri doctor` in the window: bash, git, the OS sandbox, a model provider, and in a project its toolchains and what its testing scripts run - each with what to do about it, and the models asked only when you say. Anything missing is said on the welcome screen and at the foot of the sidebar; a project just started is checked at once, its models asked too, and the checks shown only when something wants seeing to.
- **Getting started** - just installed, the welcome screen leads the way to your first project: the machine - with where to get git, the sandbox and each toolchain, or Apple's developer tools on a Mac - signing in, and the project.
- **Settings** (⌘,) - the look, the models new projects start on, how the app updates itself. **About** has the versions, what turri sends and where - [privacy](docs/privacy.md): no telemetry - and the third-party notices.
- A window for each project, native menus and shortcuts, turri's dark and light themes.

Shortcuts are written here as on macOS; on Linux Ctrl takes ⌘'s place - Ctrl+J, Ctrl+S - and the preview's terminal copies and pastes with Ctrl+Shift+C and Ctrl+Shift+V, leaving Ctrl+C to the shell.

Every detail: [the window](docs/window.md).

## What is not here yet

- **A signed Mac app** - the macOS build is not signed with a Developer ID or notarised, so macOS asks before it first opens, and it cannot update itself there. Nor is there an Intel Mac or arm64 Linux build yet.
- **Resuming a conversation** - each project opened starts a new one.
- **turri's terminal panels** - the side panel, `/lineage`'s picker - have no window form yet; the regen view takes the side panel's place.
- **Stacks, \*\*\*plain conflicts and start-overs** as dialogs.
- **Windows** - the app runs on macOS and Linux.

## Documentation

| | |
| --- | --- |
| [The window](docs/window.md) | everything the window offers, view by view |
| [Development](docs/development.md) | how the app is put together, running it on a turri clone, checking a change |
| [Privacy](docs/privacy.md) | what turri sends, and where - and what stays on your machine |
| [turri](https://github.com/turri-oss/turri#readme) | turri itself: regenerative software, \*\*\*plain, models, skills |

## Licence

turri desktop is open source, under the [MIT licence](LICENSE).
