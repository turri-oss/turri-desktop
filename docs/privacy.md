# Privacy

What turri desktop sends, and where - and what stays on your machine. The window says the same, in Help > What turri Sends, and Where… (About's privacy tab).

**The app collects no telemetry**: no analytics, no crash reports, nothing of how you use it.

## To the model providers you choose

turri is an agent: to write your \*\*\*plain with you and build its code, it sends what it works on to the models your project's `config.turri.yaml` names - with your subscription or API key, under that provider's terms:

- what you say in the chat, and the conversation so far - with the images you attach to it, and the files you attach when turri reads them;
- your \*\*\*plain files, and the files of the project turri and its agents read - code, tests, templates, config;
- what commands and test runs print, and what the preview's terminal shows when turri reads it;
- the preview's pages when turri tries them - their text, controls and console, and screenshots of them.

Nothing of your \*\*\*plain goes to a model in the background: with conformance tests on, the chat itself judges which functional specs need testing scenarios, and writes them as any \*\*\*plain change, in the conversation.

Check This Machine's **ask the models too** sends each model a word, to see that it answers.

## To the web

- turri's agents can search the web, through DuckDuckGo, and read public pages - documentation, say (`web_search`, `web_fetch`). They never reach this machine's own servers that way.
- turri's browser tools in the preview go only to this machine's own servers (localhost), never the web.
- Signing in to a provider opens its page in your browser.
- The app looks on GitHub for a newer release of itself, as it starts and every four hours - unless that is turned off in the settings (⌘,). pi, which turri runs on, may ask pi.dev for its latest list of models; nothing of yours goes with it.

## On this machine only

- What you sign in with - tokens and API keys - in pi's `auth.json` (`~/.pi/agent/`), where the turri command line keeps it too.
- The conversations, in pi's sessions there; each pulse's ledger and logs, and why each pulse that failed or did not land did (`.turri/pulses/<id>.md`, whatever the debug setting), in the project's `.turri` folder.
- The preview's cookies and storage, in memory - gone when the project closes.
- The app's own settings (`settings.json`, `appearance.json`) and recent projects, in its folder of the system's application support (`turri-app`).
