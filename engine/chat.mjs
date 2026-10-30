// The conversations: pi's agent sessions with turri in them - the same chats `turri` opens in the terminal, their tools,
// slash commands, rules and skills - with the window in place of the terminal. A turri session holds several (its
// createTurri), each its own history and model on the session's one job registry and work loop; a turri without it
// (0.1.16 and before) has one, its extension loaded here. What turri would draw in the terminal (dialogs, notices, the
// working line) comes here as UI calls and goes to the window as events, each with the chat it is of.
import turri from "./turri.mjs";
import { browserExtension, browserTools } from "./browser.mjs";
import { terminalExtension, terminalTools } from "./terminal.mjs";
import { APP_SURFACE, SENTINEL, SENTINEL_SURFACE, withWhere } from "./app.mjs";
import { entryItem, normalise, transcript } from "./entries.mjs";

const { pi } = turri;

/** Whether the turri running holds several chats: the window offers them only then. */
export const MANY_CHATS = typeof turri.createTurri === "function";

export { SENTINEL };

/**
 * Start turri's session in `cwd`, with its first chat. `host` is what turri tells of its jobs (TurriHost); `emit`
 * sends an event to the window; `ask` puts a question of a chat's to the person there and resolves with the answer
 * (undefined when they dismiss it); `browser` and `terminal` ask the window's preview - its browser pane, its terminal -
 * for one of the browser or terminal tools' actions; `whereNow` says what the person has open in the window; `onStep`
 * is called as each tool of a chat ends, and as it settles; `onChats` with the chats, as they change.
 */
export async function startSession({ cwd, harnessModel, host, emit, ask, browser, terminal, whereNow, onStep, onChats }) {
  process.env.PI_SKIP_VERSION_CHECK = "1";
  /** The chats the window is told of, by id. */
  const chats = new Map();
  /** A chat's events, each with its id. */
  const says = (id) => (event, data) => emit(event, { chat: id, data });
  // The window is told when a chat's model changes - /turri-config switches it as it runs.
  const modelWatch = (api) =>
    api.on("model_select", ({ model }, ctx) => {
      const chat = [...chats.values()].find((each) => each.session.sessionManager === ctx?.sessionManager) ?? (chats.size === 1 ? [...chats.values()][0] : undefined);
      if (chat !== undefined) says(chat.id)("chat:model", { model: `${model.provider}/${model.id}` });
    });
  // turri is told it is in the app: the window's views in place of the terminal's, and what the person has open now.
  const told = { surface: APP_SURFACE, systemPrompt: (prompt) => withWhere(prompt, whereNow()) };
  // The preview's tools, made once: every chat has them, and the sentinel - which turri refuses any tool not its own or
  // given it - is given the same, to test a release with. pi keeps the first registered under a name, so in its chat
  // the two are one.
  const browsing = browserTools(browser);
  const trying = terminalTools(terminal);
  const extensions = [browserExtension(browsing), terminalExtension(trying), modelWatch];
  const follow = (id, session, earlier) => {
    const chat = followChat({ id, session, harnessModel, emit: says(id), sendWhole: emit, onStep, earlier });
    chats.set(id, chat);
    return chat;
  };
  /**
   * A chat's session replaced, its id kept - the sentinel's, fresh for each pulse it checks: the new one followed in place
   * of the old, after what the old one said - its earlier pulses - which the window keeps showing in regen. The old one
   * is let go by then: what it said is read while it still can be, else left out.
   */
  const renewed = (id, fresh) => {
    const before = chats.get(id);
    let earlier = [];
    try {
      earlier = before?.history() ?? [];
    } catch {
      /* let go with nothing left to read */
    }
    if (before !== undefined) spentBefore[whose(id)] += before.spent();
    before?.stop();
    follow(id, fresh, earlier);
  };
  /**
   * What the chats let go of had spent - each closed, and the sentinel's conversations before its current one - by
   * whose it was: still what the session has spent.
   */
  const spentBefore = { chat: 0, sentinel: 0 };
  /** Each chat's role, as turri told of it: the sentinel's, or none - a chat the person talks in. */
  const roles = new Map();
  const whose = (id) => (roles.get(id) === "sentinel" ? "sentinel" : "chat");
  /** What the chats have spent since the session started - their own models' calls - the person's and the sentinel's. */
  const spending = () => {
    const now = { ...spentBefore };
    for (const chat of chats.values()) now[whose(chat.id)] += chat.spent();
    return now;
  };

  if (!MANY_CHATS) return oneChat({ cwd, host, told, extensions, ask, says, follow, onChats, spending });

  const session = await turri.createTurri({
    ...told,
    onJobChange: host.onJobChange,
    onPlanChange: host.onPlanChange,
    // A chat's questions, put in the window - a choice of options, or words to type - with the chat they are of. Each is
    // turri's to decline (ctrl+c), and over when its signal says so - declined, or its turn stopped.
    dialogs: (id) => ({
      select: (title, options, context, _at, given) => ask(id, { kind: "select", title, options, message: context }, { turri: true, signal: given?.signal }),
      input: (title, context, given) => ask(id, { kind: "input", title, message: context }, { turri: true, signal: given?.signal }),
    }),
    uiContext: (id) => uiContext({ emit: says(id), ask: (question, signal) => ask(id, question, { signal }) }),
    extensions,
    // The sentinel's notices - each drawn as a card in the chat it names, and answered there - and its conclusions.
    ...(SENTINEL
      ? {
          // Its tools, and where the person watches it use them: a turri before sentinel.surface takes the tools alone.
          sentinel: { tools: [...browsing, ...trying], surface: SENTINEL_SURFACE },
          onNotice: (notice) => emit("chat:notice", { chat: notice.chat, data: notice }),
          onNoticeOver: (notice) => emit("chat:noticeOver", { chat: notice.chat, data: notice }),
          onConcluded: (conclusion) => emit("chat:concluded", { chat: conclusion.chat, data: conclusion }),
          // The sentinel starting a pulse in a fresh conversation: its new session followed (a turri before it keeps one).
          onChatSession: renewed,
        }
      : {}),
  });
  // The chats as turri tells of them: one closed let go, and one opened followed - whoever opened it. turri opens the
  // sentinel's itself, in the background, as a pulse finishes: followed here, or the window would have its tab and none
  // of what it says. Its model is turri's to choose (models.sentinel), so it is not put on harness-model. One turri
  // lists while it is still opening - its session not made yet, and something else changing meanwhile - is left out:
  // the window hears of it once it is followed, and asks of it only then.
  const followed = () => session.chats().filter((chat) => chats.has(chat.id));
  const tell = () => {
    const now = session.chats();
    for (const [id, chat] of chats) {
      if (now.some((each) => each.id === id)) continue;
      spentBefore[whose(id)] += chat.spent();
      chats.delete(id);
    }
    for (const info of now) {
      roles.set(info.id, info.role);
      const opened = chats.has(info.id) ? undefined : session.session?.(info.id);
      if (opened !== undefined) follow(info.id, opened);
    }
    onChats(followed());
  };
  session.onChats(tell);

  const open = async () => {
    const info = await session.openChat();
    const chat = chats.get(info.id) ?? follow(info.id, info.session);
    await chat.onHarnessModel({ quiet: false });
    tell();
    return info.id;
  };
  // Made after the session tells of its chats: each is followed as it is opened.
  await open();
  return {
    jobs: () => session.jobs,
    loop: () => loopOf(session),
    canOpen: true,
    chats: followed,
    chat: (id) => chats.get(id),
    shown: () => chats.get(followed().find((chat) => chat.shown)?.id) ?? [...chats.values()][0],
    open,
    close: (id) => session.closeChat(id),
    focus: (id) => session.focus(id),
    // ctrl+c, as turri's terminal has it - on a turri without it (before its interrupt), what a turn's stop does.
    interrupt: (id) => (typeof session.interrupt === "function" ? session.interrupt(id) : stopOnly(chats.get(id))),
    // ctrl+c at a question of turri's: declined - on a turri that can (its decline), else not at all.
    canDecline: typeof session.decline === "function",
    decline: (id) => session.decline(id),
    notices: () => (SENTINEL ? session.notices() : []),
    // The test advisor asked about functional specs, as a host asks it: at once, the verdicts coming to the chat shown.
    evaluateTests: typeof session.evaluateTests === "function" ? (funcIds, options) => session.evaluateTests(funcIds, options) : undefined,
    answerNotice: (id, answer) => session.answer(id, answer),
    // A setting's values whole - every model signed in to, not the forty a terminal's autocomplete shows - on a turri
    // that gives them (its settingChoices).
    settingChoices: typeof session.settingChoices === "function" ? (key, typed) => session.settingChoices(key, typed) : undefined,
    // Conformance tests turned on, as the chat's turn_on_conformance_tests does - where the module's value comes from, every
    // chat's tools switched - on a turri that can (its turnOnConformanceTests).
    turnOnConformanceTests: typeof session.turnOnConformanceTests === "function" ? (plainFile) => session.turnOnConformanceTests(plainFile) : undefined,
    spending,
    dispose: () => session.dispose(),
  };
}

/** ctrl+c on a turri that cannot end its session from it: a chat at work stopped, one doing nothing left as it is. */
async function stopOnly(chat) {
  if (chat === undefined) return "missing";
  if (!busy(chat.session)) return "ignored";
  await chat.abort();
  return "stopped";
}

/** Whether a chat is doing something ctrl+c would stop: a turn, a ! command, a compaction, a retry. */
export function busy(session) {
  return session.isStreaming || session.isBashRunning || session.isCompacting || session.isRetrying;
}

/** The session's work loop, once a chat has made it - undefined before. */
function loopOf(session) {
  try {
    return session.loop;
  } catch {
    return undefined;
  }
}

/** A turri of 0.1.16 and before: one chat, turri's extension loaded into it, its job registry and work loop handed over. */
async function oneChat({ cwd, host, told, extensions, ask, says, follow, onChats, spending }) {
  const ID = "1";
  let registry;
  let loop;
  const extension = turri.createTurriExtension({
    ...told,
    onJobs: (made) => (registry = made),
    onWorkLoop: (made) => {
      loop = made;
      host.onPlanChange?.();
    },
    onJobChange: host.onJobChange,
    onPlanChange: host.onPlanChange,
    dialogs: {
      select: (title, options, context) => ask(ID, { kind: "select", title, options, message: context }, { turri: true }),
      input: (title, context) => ask(ID, { kind: "input", title, message: context }, { turri: true }),
    },
  });
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir: pi.getAgentDir(), extensionFactories: [extension, ...extensions] });
  await loader.reload();
  const { session } = await pi.createAgentSession({ cwd, resourceLoader: loader, sessionManager: pi.SessionManager.create(cwd) });
  const chat = follow(ID, session);
  await chat.onHarnessModel({ quiet: false });
  // "tui": jobs run in the background and the chat stays free, as in the terminal.
  await session.bindExtensions({
    uiContext: uiContext({ emit: says(ID), ask: (question, signal) => ask(ID, question, { signal }) }),
    mode: "tui",
    onError: (error) => says(ID)("chat:notify", { level: "error", text: `${error.extensionPath ?? "extension"}: ${error.error ?? error.message ?? error}` }),
  });
  const info = () => [{ id: ID, title: "chat", status: session.isStreaming ? "working" : "idle", shown: true }];
  session.subscribe((event) => (event.type === "agent_start" || event.type === "agent_settled") && onChats(info()));
  onChats(info());
  const one = () => {
    throw new Error("This turri has one chat: a newer one opens more.");
  };
  return {
    jobs: () => registry,
    loop: () => loop,
    canOpen: false,
    chats: info,
    chat: (id) => (id === ID ? chat : undefined),
    shown: () => chat,
    open: one,
    close: one,
    focus: () => {},
    interrupt: (id) => stopOnly(id === ID ? chat : undefined),
    canDecline: false,
    notices: () => [],
    spending,
    dispose: async () => session.dispose(),
  };
}

/**
 * One chat, as the window follows it: what its session does, sent as events, and what the window asks of it. `emit`
 * says an event of this chat's; `sendWhole` one of the window's own.
 */
function followChat({ id, session, harnessModel, emit, sendWhole, onStep, earlier = [] }) {
  // The chat runs on harness-model, as `turri` starts pi with it - and is put on it after a sign-in, when it could not
  // be before.
  let onHarness = false;
  const onHarnessModel = async ({ quiet = true } = {}) => {
    if (!harnessModel || onHarness) return;
    const [spec, level] = splitLevel(harnessModel);
    const slash = spec.indexOf("/");
    const found = slash > 0 ? new pi.ModelRegistry(session.modelRuntime).find(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
    if (found !== undefined) {
      await session.setModel(found);
      onHarness = true;
    } else if (!quiet) emit("chat:notify", { level: "warning", text: `harness-model ${spec} was not found: the chat uses pi's default model.` });
    if (level && (found !== undefined || !quiet)) session.setThinkingLevel(level);
  };

  let lastDelta = 0;
  /** What it had cost when last read: what it spent, once its session is let go and can be read no more. */
  let lastCost = 0;
  /** How full the conversation's context is, and what it has cost - its own model's calls, not the pulses'. */
  const stats = () => {
    const usage = session.getContextUsage();
    const { cost, tokens } = session.getSessionStats();
    lastCost = cost;
    return { percent: usage?.percent ?? null, tokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null, cost, spent: tokens.total };
  };
  /** What its model's calls have cost so far. */
  const spent = () => {
    try {
      lastCost = session.getSessionStats().cost;
    } catch {
      /* let go: what it had spent when last read */
    }
    return lastCost;
  };
  const tellStats = () => emit("chat:stats", stats());
  /** What waited to be heard, when the turn is stopped: never heard, but put back in the message box, as pi's terminal puts it back in its editor. */
  const restore = () => {
    const { steering, followUp } = session.clearQueue();
    const texts = [...steering, ...followUp];
    if (texts.length > 0) emit("chat:restore", { text: texts.join("\n\n") });
  };
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        emit("chat:busy", { busy: true });
        break;
      case "agent_settled":
        emit("chat:busy", { busy: false });
        onStep?.();
        tellStats();
        break;
      case "message_update": {
        // The reply as it is written: sent whole, at most ten times a second.
        const now = Date.now();
        if (now - lastDelta > 100) {
          lastDelta = now;
          emit("chat:streaming", normalise(event.message));
        }
        break;
      }
      case "message_end":
        tellStats();
        emit("chat:streaming", null);
        for (const item of [normalise(event.message)].flat()) if (item) emit("chat:message", item);
        break;
      case "tool_execution_start":
        emit("chat:tool", { id: event.toolCallId, name: event.toolName, running: true });
        break;
      case "tool_execution_end":
        emit("chat:tool", { id: event.toolCallId, name: event.toolName, running: false, isError: event.isError === true });
        onStep?.();
        break;
      case "queue_update":
        // What was said while it answered, waiting for its turn to end: shown at once, as pi's terminal shows it.
        emit("chat:queued", { texts: [...event.steering, ...event.followUp] });
        break;
      case "entry_appended": {
        // What the extension puts in the chat outside a turn: a slash command's echo and outcome, a job's announcement.
        const item = entryItem(event.entry);
        if (item) emit("chat:message", item);
        break;
      }
    }
  });

  return {
    id,
    session,
    /** What it said - after what its sessions before said, the sentinel's earlier pulses: each a session of its own. */
    history: () => [...earlier, ...transcript(session)],
    /** Followed no more: its session replaced by a new one, under the same id. */
    stop: () => unsubscribe(),
    /** What was said while it answered and it has not heard yet: it hears each after its turn. */
    queued: () => [...session.getSteeringMessages(), ...session.getFollowUpMessages()],
    /**
     * Say something to turri: a slash command runs at once, even while it is answering, as in pi's terminal; anything
     * else said while it answers waits, and it hears it after its turn. /login
     * and /logout are pi's terminal's alone - typed here they would go to the model as words - so they open the
     * window's sign-in sheet instead, on the provider named if one is. /pulses opens turri's side panel, drawn only in a
     * terminal: the window shows its regen view instead. Images attached go with it, for the model to see.
     */
    send: (text, images = []) => {
      const signIn = /^\/(?:login|logout)(?:\s+(\S+))?\s*$/.exec(text.trim());
      if (signIn !== null) return sendWhole("auth:open", { provider: signIn[1] ?? null });
      if (text.trim() === "/pulses") return sendWhole("regen:open", null);
      const run = session.prompt(text, { streamingBehavior: "followUp", ...(images.length > 0 ? { images } : {}) });
      Promise.resolve(run).catch((error) => emit("chat:notify", { level: "error", text: error instanceof Error ? error.message : String(error) }));
    },
    /**
     * The commands typing / offers, as pi has them: the extension's - /turri-config, /regenerate, /stack - its prompt
     * templates, and its skills as /skill:<name>. /halt is left out: halting a pulse is turri's alone, not the window's.
     * So is /pulses, whose description speaks of the terminal's side panel and its key: the regen view is the window's.
     */
    commands: () =>
      [
        ...session.extensionRunner.getRegisteredCommands().map((command) => ({ name: command.invocationName, description: command.description })),
        ...session.promptTemplates.map((template) => ({ name: template.name, description: template.description })),
        ...session.resourceLoader.getSkills().skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
      ]
        .filter((command) => command.name !== "halt" && command.name !== "pulses")
        .map((command) => ({ name: `/${command.name}`, description: command.description ?? "" }))
        .concat({ name: "/login", description: "sign in to a model provider - with an API key, or a subscription in the browser" }),
    /** What a command offers as its argument is typed - /turri-config's settings and their values - as pi's editor has it. */
    completions: async (name, prefix) => {
      const command = session.extensionRunner.getRegisteredCommands().find((each) => each.invocationName === name);
      return (await command?.getArgumentCompletions?.(prefix)) ?? [];
    },
    abort: async () => {
      await session.abort();
      restore();
    },
    restore,
    onHarnessModel,
    model: () => (session.model ? `${session.model.provider}/${session.model.id}` : null),
    stats,
    spent,
  };
}

function splitLevel(spec) {
  const match = /^(.*):(off|minimal|low|medium|high|xhigh|max)$/.exec(spec);
  return match ? [match[1], match[2]] : [spec, undefined];
}

/** What turri's extension asks of the UI, answered by the window - and what only a terminal could do, let pass. */
function uiContext({ emit, ask }) {
  /** The components the extension has drawn, by their widget's key: each stopped when it is replaced or cleared. */
  const widgets = new Map();
  const theme = new Proxy(
    {},
    { get: (_target, key) => (key === "fg" || key === "bg" ? (_colour, text) => text : (text) => text) },
  );
  const known = {
    theme,
    // Each put away when its signal says so - pi's dialogs' own - as pi's terminal closes them.
    select: (title, options, given) => ask({ kind: "select", title, options }, given?.signal),
    confirm: async (title, message, given) => (await ask({ kind: "confirm", title, message }, given?.signal)) === true,
    input: (title, placeholder, given) => ask({ kind: "input", title, placeholder }, given?.signal),
    editor: (title, prefill) => ask({ kind: "editor", title, prefill }),
    notify: (message, type = "info") => emit("chat:notify", { level: type, text: message }),
    setStatus: (key, text) => emit("chat:status", { key, text: text ?? null }),
    setWorkingMessage: (message) => emit("chat:working", { text: message ?? null }),
    setWidget: (key, content) => {
      widgets.get(key)?.();
      widgets.delete(key);
      if (key === SKILL_WIDGET) {
        if (typeof content === "function") widgets.set(key, skillProgress(content, theme, emit));
        else emit("chat:progress", null);
        return;
      }
      if (content === undefined || Array.isArray(content)) emit("chat:widget", { key, lines: content ?? null });
    },
    setTitle: () => {},
    getToolsExpanded: () => false,
    getEditorText: () => "",
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    onTerminalInput: () => () => {},
    /**
     * A component of the extension's own, drawn in the terminal - a panel, a picker. ask_user's questions come through
     * the host's dialogs instead (engine.mjs); the rest have no window form yet, and are closed at once.
     */
    custom: () => Promise.resolve(undefined),
  };
  return new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => undefined) });
}

/** The widget turri's extension draws above the input while a skill runs: its phases, and where it is in them. */
const SKILL_WIDGET = "turri-skill";
/** Wide enough that the line has every phase, not the compact form a narrow terminal gets. */
const WIDE = 1000;

/**
 * A skill's progress, as the window draws it: the extension draws it as a terminal component - one line of its phases,
 * done, current and to come, and one of what the phase it is in does - so the component is drawn here, plain, and its
 * lines read back. It is drawn again whenever it asks to be (its spinner, once a second), and the window told when
 * what it says changes: the skill, its phases and their state, where it is, and what that phase does.
 */
function skillProgress(factory, theme, emit) {
  let said;
  let component;
  const draw = () => {
    let lines;
    try {
      lines = component.render(WIDE);
    } catch {
      return;
    }
    const progress = readProgress(lines);
    const text = JSON.stringify(progress);
    if (text === said) return;
    said = text;
    emit("chat:progress", progress);
  };
  component = factory({ requestRender: draw }, theme);
  draw();
  return () => {
    component.dispose?.();
    emit("chat:progress", null);
  };
}

/**
 * The progress line read back: `release   ✓ check ━━━━ ⠋ build ──── ○ publish   phase 2 of 3`, and
 * under it `build - what this phase does`. A skill of one phase is its spinner and name.
 */
function readProgress([line = "", under = ""]) {
  const [head = "", bar, where] = line.trim().split(/\s{3,}/);
  if (where === undefined) return { skill: head.replace(/^\S+\s+/, ""), phases: [], where: bar ?? null, about: null };
  const phases = bar.split(/ [━─]+ /).map((step) => ({
    name: step.slice(2),
    state: step.startsWith("✓") ? "done" : step.startsWith("○") ? "todo" : "now",
  }));
  return { skill: head, phases, where: where ?? null, about: under.trim() || null };
}
