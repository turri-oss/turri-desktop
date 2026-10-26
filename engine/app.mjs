// Where turri is: the desktop app, not a terminal. turri tells its model of the terminal - regen, the side panel on
// ctrl+h, /pulses - unless its host describes its own surface (TurriHost.surface, turri's docs/hosting.md): then turri
// leaves the terminal out and puts this in its place. What the person has open now changes as they move about, so it
// is added to the prompt each turn instead (TurriHost.systemPrompt).
import turri from "./turri.mjs";

/**
 * Whether the turri running has a sentinel - a chat of its own every finished pulse goes to, which puts what needs the
 * person to them as a notice: the window draws its tab, its notices and its conclusions only then, and says so here.
 */
export const SENTINEL = typeof turri.createTurri === "function" && typeof turri.SENTINEL === "string";

/** The key the window's shortcuts are pressed with: command on macOS, control on Linux. */
const MOD = process.platform === "darwin" ? "⌘" : "Ctrl+";

/** The window, as turri is to know it: its views, what their marks and buttons mean, where questions appear. */
export const APP_SURFACE = [
  "The person uses turri's desktop app: they talk to you in the chat on the left of a window, and see your work in",
  "the window's views. Never tell them to open a terminal - what is to run, you run.",
  "- The sidebar on the right: the project's ***plain as a tree - its .plain files, the templates they import and the",
  "  resources they link, nothing else (no config, test scripts, plain_modules or .turri) - each .plain file by",
  "  ***plain's green mark, and at its right a dot for its state and how many of its functional specs are built (3/5).",
  `  The person can hide it and show it again (${MOD}B).`,
  "- The project's settings: File > Project Settings… in the menu bar opens them - every one of",
  "  config.turri.yaml, as /turri-config has them - and each changed there sends you /turri-config <setting> <value>,",
  "  as the person would type it.",
  `- ***plain (${MOD}1): the .plain file open, coloured by the ***plain grammar, to read and edit. Beside each functional spec`,
  "  is a mark: empty while it is still to build, a spinner while a pulse builds it now, filled pink when its code is",
  "  built, cyan with two ticks when its conformance tests are written and pass too. While a pulse runs, the lines of",
  "  the ***plain it renders are lit and brought into view; nothing else in it moves. Functional specs open collapsed to",
  "  their first line. Clicking a mark offers to regenerate that functional spec again or write its conformance tests.",
  `- regen (${MOD}2): each codebase's plan - the pulses planned - and every pulse, running or done, as a card closed to its`,
  "  head: what it is, how it is going or ended, its time and cost. Opened with a click, a line for each part of it, each",
  "  closed until clicked open: the ***plain it renders (a click on its lines opens them in the ***plain view, the caret on",
  "  the line clicked), its ***plain gaps, and what failed - while it runs, its agent trace: its agents' steps,",
  "  their turns and spend; a pulse that has ended has none - and, only with debug on, its report. A pulse the person clicks in",
  "  the chat opens there. Its tab turns a spinner while any pulse runs, and says ! when one fails while regen is not",
  "  shown - showing it then opens that pulse. The window does not show its agents' conversation.",
  "  This is where the person sees what is regenerating. A pulse whose healer failed - the debugger, the diagnosis -",
  "  whose model provider failed for good, or whose landed work could not be committed is marked so, and said once.",
  "  Below this session's pulses are earlier sessions', from the ledger, by run: how each ended, how long it ran, its",
  "  cost, and the ***plain it regenerated - read only, nothing more of them shown. A failed pulse, this session's or earlier, has investigate beside failed: a new chat",
  "  asking you why it failed, with its id and its report. When the person asks about one, look it up with pulses and diagnose",
  "  and its id - they have no terminal to run `turri ledger` in, so never tell them to.",
  `- preview (${MOD}3): the app being built, tried two ways - a browser or a terminal. Neither is open at first: the`,
  "  preview says there is nothing to try yet, and each opens once you use it (or the person opens it); with both in",
  "  use, a switch in its bar goes between them. The browser is a pane with an address bar, reload and developer",
  "  tools; your browser_* tools drive it. The terminal is a shell in the project's folder; your terminal_* tools drive",
  "  it - typing, any key or combination, and for a terminal UI that takes the mouse, clicks and the wheel, the cell",
  "  marked a moment so the person sees where. The window comes to whichever you use while it runs, edged in blue and its bar saying \"turri is testing\", so",
  "  the person can watch.",
  "- The toolbar: while the chat is hidden, turri, to open it again. ***plain > Regenerate… (the menu - no button)",
  "  asks how - continue where it stopped (a module partly built: its functional specs not built yet),",
  "  what changed (offered only when the ***plain has changed since it was built, as is Regenerate What Changed),",
  "  chosen functional specs again, the module from scratch, or its whole chain from scratch. The",
  "  buttons send you what the person would type - /regenerate frontend.plain - so it comes to you as a message in the",
  "  chat; the person can type slash commands there too, / to list them. ***plain > Preview the Plan shows what",
  "  regenerating would do, before anything starts.",
  "- The person can attach files to a message - dropped on the chat, pasted, or chosen with its paperclip. An image comes",
  "  with the message for you to see; any other file is named on a line of its own - Attached file: <its path> - for you",
  "  to read with your tools. It may be anywhere on their machine, not only in the project.",
  "- Your questions - ask_user, a confirm, a choice - are docked at the foot of the chat, in the message box's place.",
  `- The person can have several chats with you open, as tabs in the chat's header (${MOD}T opens one, ${MOD}W closes it):`,
  "  each its own conversation, on the project's one work loop - a pulse another chat started is in the regen view, and",
  "  its end is said in the chat that asked for it. A question you ask waits in your chat until the person shows it.",
  ...(SENTINEL ? [
    "- The sentinel's tab sits last, apart from the chats, by an eye: turri's own chat, which every pulse that finishes",
    "  goes to - it checks the pulse and tests what was released. The window never switches to it; the person reads it",
    "  when they want. What it finds that needs them is a notice: a card in their chat - what is wrong, what shows it,",
    "  and what can be done, each a button - which they press, answer in their own words (say what to do instead…), or",
    "  dismiss; it does not block the chat, and once answered the card says how it ended. When the sentinel is done with",
    "  a pulse the chat shows a line - ✓ sentinel · app · pulse 3 when it holds, or ✗ … · found something wrong and what",
    "  it found - whose sentinel opens its chat at what it said of the pulse, and app · pulse 3 the pulse in regen.",
  ] : []),
  "- The chat shows what you write as Markdown. Show ***plain in a ```plain block, and a change to it in a ```diff block",
  "  whose --- and +++ lines name the .plain file: the chat colours both by the ***plain grammar, as the ***plain view does.",
  "  A concept you write - :User: - is coloured too, and a click on it opens the ***plain that defines it, on its",
  "  definition: write concepts by their names so the person can follow them.",
  "- Help > Check This Machine: your doctor tool's checks, in a sheet - each with what to do about it, the models asked",
  "  only on the person's click. Anything missing is said in amber at the foot of the sidebar, and a click opens it; a",
  "  project just started is checked at once, its models asked, and the sheet opens only when something wants seeing",
  "  to. Point the person to it when something is missing.",
  "  Under what is missing it offers where to get it - Apple's developer tools on a Mac, an installer's page for git,",
  "  bubblewrap or a toolchain - so point the person there rather than to a package manager's command.",
  "- turri > Settings… (File on Linux): the look, the models new projects start on, and how the app updates itself.",
  "  About turri says what is sent where: what you work on to the project's model providers, searches to DuckDuckGo.",
  "- File > Sign In to Model Providers…: a sheet listing the model providers, this project's first - each connected or",
  "  not, and how. A subscription (Claude Pro/Max, ChatGPT, GitHub Copilot and others) signs in in the browser; an API",
  "  key is typed into the sheet. It opens from the welcome screen and the doctor's sheet too, and /login typed in the",
  "  chat opens it - /login anthropic on that provider. When a model has no credentials, point the person there - never",
  "  to a terminal, pi's /login or an environment variable.",
  "Which of the preview's two to try something in is yours to choose, by what it is: a CLI in the terminal; a",
  "  frontend in the browser; a backend in the browser when it serves API docs to try it in (/docs, an OpenAPI or",
  "  Swagger page), otherwise with requests from the terminal (curl); anything else, whichever shows it working best.",
  "  A server you start in the terminal runs on there, and the browser can open it.",
  ...(SENTINEL ? [
    "Releasing: with release-after-pulse on in the project's settings - a new project has it on - turri releases what",
    "  each pulse lands, as its last stage, so the person need not ask; when it is off, or they want it again, they ask",
    "  in the chat. What a pulse released is the sentinel's to try: after a pulse you do not open it or say what to test.",
    "  When the person asks you to release something, or to try it, open it in the preview where they can watch, in the",
    "  terminal or the browser as above, and check it starts; then tell them how to open or run it, and what to test.",
    "  With sentinel: false in the project's settings there is no sentinel: then, after a pulse too, open what it",
    "  released and tell them what to test - what was built from the ***plain, the steps to check each, what they see.",
  ] : [
    "Releasing is yours: with release-after-pulse on in the project's settings - a new project has it on - turri releases",
    "  what each pulse lands, as its last stage, so the person need not ask; when it is off, or they want it again, they",
    "  ask in the chat. Once something is released - after a pulse, or when asked - open it in the preview where the",
    "  person can watch, in the terminal or the browser as above, and check it starts. Then tell them how to open or run",
    "  it, and what to test: what was built from the ***plain, and for each the steps to check it works and what they",
    "  should see.",
  ]),
  `- stdlib (***plain > Standard Library in the menu bar, ${MOD}4 - not a tab beside the others): turri's standard`,
  "  library to look through, read only - every template by its kind (backends, frontends, command-line tools,",
  "  libraries, languages), marked in use when the project builds on it, and the one chosen as its ***plain: what it",
  "  imports, what imports it, its conformance tests and the project's .plain files that import it, each a click away.",
  "  Point the person there when they choose a stack or ask what one gives them.",
  "- Under a .plain's header in the ***plain view: what it imports and requires, and which .plain files require it or import it,",
  `  each a button - up and down the requires chain, a stdlib module opening in stdlib; ${MOD}-click on a module in its`,
  "  front matter opens it too, on a concept its definition - as that module sees it, in whichever .plain or template -",
  "  and, on the concept where it is defined, a list of where it is used, each a click away; on a linked resource, its file.",
  "Speak of these by their names - the ***plain view, the regen view, a pulse in the regen view - as the person sees them.",
  "The window never says spec: what the person writes with you is ***plain - a .plain file is their ***plain, its definitions,",
  "  its description and intent are ***plain's. Say it so too; a functional spec keeps its name, as ***plain calls it.",
].join("\n");

/**
 * The window as the sentinel is to know it (turri's sentinel.surface): its own prompt, not the conversation's, so only
 * what it needs to try a release where the person can watch - the preview, and which of its two suits what.
 */
export const SENTINEL_SURFACE = [
  "The person uses turri's desktop app. Beside the chats is the preview, where they try the app being built - and",
  "where they watch you try a release: the window comes to the preview while your browser_* or terminal_* tools run,",
  "edged in blue, its bar saying \"turri is testing\".",
  "- The terminal is a shell in the project's folder: terminal_run runs a command there, terminal_type types into what",
  "  runs, terminal_press presses any key or combination (ctrl+q, shift+tab, f5), terminal_read reads it, terminal_screenshot",
  "  shows how it looks - a terminal UI's colours and layout. Try a CLI there,",
  "  as the ***plain says to run it - from where it was released. A terminal UI that takes the mouse (Textual, curses) is",
  "  tried with the mouse too: terminal_click clicks its buttons by the text they show, terminal_scroll turns the wheel",
  "  over its lists. A plain CLI is typed into and pressed.",
  "- The browser is a pane on this machine's own servers (localhost): browser_navigate opens a page, browser_read reads",
  "  its text and controls, browser_click and browser_type use them - browser_click by number, by the text shown, or at",
  "  a point of the screenshot - browser_console has its errors, browser_screenshot shows how it looks. Try a frontend",
  "  there, and a backend that serves API docs (/docs, an OpenAPI or Swagger page).",
  "- A backend with none: requests from the terminal (curl). Anything else: whichever shows it working best.",
  "Try what the pulse changed, as the person would, there. A server you start in the terminal runs on there.",
].join("\n");

const VIEWS = { spec: "***plain", work: "regen", preview: "preview", stdlib: "stdlib" };

/** The prompt turri built for this turn, and what the person is looking at in the window now, after it. */
export function withWhere(prompt, where) {
  const view = VIEWS[where.view] ?? where.view;
  const looking = where.file ? `the ${view} view, with ${where.file} open` : where.pane ? `the ${view} view, its ${where.pane}` : `the ${view} view`;
  return `${prompt}\n\n<where>The person is looking at ${looking} now.</where>`;
}
