# Contributing to turri desktop

Thank you for helping. turri desktop is [turri](https://github.com/turri-oss/turri) as a native app, for people who do not live in a terminal - a proof of concept, open source under the [MIT licence](LICENSE). Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for something

Open an [issue](https://github.com/turri-oss/turri-desktop/issues/new/choose). For a bug, say which app and which turri you are on - both are at the foot of the window's sidebar - your system, what you did, and what you saw. A screenshot helps.

A security problem is not an issue: report it privately, as [SECURITY.md](SECURITY.md) says.

## Where a change belongs

The app runs turri's own conversation and work loop and shows them in native UI. What turri knows - the \*\*\*plain grammar and parser, its modules, the standard library, the work loop - is turri's, and the app takes all of it from turri's host entry (`@turri-dev/cli/host`). A change there goes to [turri](https://github.com/turri-oss/turri) first; the app uses it once a turri that has it is published. If you are not sure which side something is on, open an issue and ask.

## Making a change

Fork the repository, make a branch, and open a pull request against `main`.

```bash
git clone git@github.com:<you>/turri-desktop.git && cd turri-desktop
npm install
npm run dev        # Vite with hot reload, Electron on it
```

You need Node 22.19 or newer and git; on Linux, a C++ toolchain and bubblewrap too - the [README](README.md#or-run-it-from-source) says what to install. [docs/development.md](docs/development.md) says how the app is put together, how to run it on a turri clone of your own, and how to look at the real window.

Before you open the pull request:

```bash
npm run typecheck
npm test           # the real window, driven by Playwright - calls no model
```

Add a test in `tests/` for what you change, as long as it calls no model. The same tests run on macOS and Linux for every pull request; for a contribution from outside, the maintainer starts them, and they must pass before it is merged.

The tests spend nothing, but the app itself does: Regenerate, Preview plan and every chat message call the project's models with your keys. Check what you can with what calls none - opening a project, the \*\*\*plain, slash commands that only print.

## Conventions

- **Commits and pull request titles** follow [Conventional Commits](https://www.conventionalcommits.org/), as in turri: `feat(ui): ...`, `fix(editor): ...`, the description lowercase and saying what the app now does. A pull request lands on `main` squashed into one commit, its title the message, or rebased, its commits as they are - so each of them is a Conventional Commit too.
- **Names**: turri is written lowercase, even at the start of a sentence; \*\*\*plain is written `***plain`, never "spec" in what the person reads.
- **The window's own words are lowercase** - buttons, labels, headings, tooltips, notices. What it shows as it is keeps its case: the \*\*\*plain, code, file names, product names, keys.
- **Prose** - docs, comments, strings - uses British spelling and a spaced hyphen ` - `, not an em dash.
- **Docs move with the code**: when what the window offers or how the app is set up changes, update [docs/window.md](docs/window.md) or [docs/development.md](docs/development.md) - and the README's tour, if it says it - in the same pull request.
- **Look**: colours, fonts and shapes are turri's design system, as tokens in `src/styles.css` - use the tokens.

## Conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE), as the rest of the app is.
