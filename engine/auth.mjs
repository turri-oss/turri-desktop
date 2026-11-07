// Signing in to the model providers, in the window: pi's own logins - an API key, or a subscription's sign-in in the
// browser - as pi's terminal runs them on /login, with the window's sign-in sheet in place of its dialogs. pi does the
// whole flow and keeps the credential where the turri CLI keeps it (auth.json in pi's agent folder); the window is sent
// what it asks and says, and answers by id, as it answers turri's questions in the chat. The OAuth callback server
// listens on localhost here, in the engine.
import { readFileSync } from "node:fs";
import { ServerResponse } from "node:http";
import { join } from "node:path";
import turri from "./turri.mjs";

const { pi } = turri;

// ---------- the page the browser ends on ----------

// A subscription's sign-in ends in the browser, on a page pi's callback server sends from here: pi's own, its logo and
// words, with no way given to change it. The engine runs turri alone, so the page is told by its markup as it is sent
// and turri's sent in its place - pi's message kept, said in turri's look: turri-dark, whatever the system's.

/** turri's logo mark, as the window has it. */
const LOGO = (() => {
  try {
    return readFileSync(join(import.meta.dirname, "..", "public", "jellyfish", "logo-mark.svg"), "utf8");
  } catch {
    return "";
  }
})();

/** turri's page for pi's - the sign-in done, or why not - or undefined for any other page. */
export function turriCallbackPage(html) {
  const outcome = /<title>Authentication (successful|failed)<\/title>/.exec(html)?.[1];
  if (outcome === undefined || !html.includes('<div class="logo">')) return undefined;
  // Already escaped by pi: put in as it is.
  const message = /<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  const details = /<div class="details">([\s\S]*?)<\/div>/.exec(html)?.[1];
  const done = outcome === "successful";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${done ? "signed in - turri" : "not signed in - turri"}</title>
  <style>
    :root { color-scheme: dark; --bg: #0a0f1a; --fg: #f4f7f9; --fg-2: #85a3b2; --card: #142030; --line: #22344a; --mark: #ff5c8d; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--bg);
      color: var(--fg);
      font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
      text-align: center;
    }
    main { max-width: 480px; display: flex; flex-direction: column; align-items: center; }
    .logo svg { width: 72px; height: 72px; display: block; margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: 26px; font-weight: 500; }
    h1 span { color: var(--mark); }
    p { margin: 0; color: var(--fg-2); }
    .said {
      margin-top: 18px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      color: var(--fg-2);
      font: 12.5px/1.5 ui-monospace, Menlo, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main>
    <div class="logo">${LOGO}</div>
    ${
      done
        ? `<h1>signed in<span>.</span></h1>
    <p>you can close this tab and go back to turri - it has your models now.</p>`
        : `<h1>the sign-in did not work</h1>
    <p>go back to turri to try again.</p>
    <div class="said">${message}${details ? `\n${details}` : ""}</div>`
    }
  </main>
</body>
</html>`;
}

/** Every page sent from the engine passes here: pi's sign-in page goes out as turri's. Once per engine. */
let branded = false;
function brandCallbackPages() {
  if (branded) return;
  branded = true;
  const end = ServerResponse.prototype.end;
  ServerResponse.prototype.end = function (chunk, ...rest) {
    const page = typeof chunk === "string" ? turriCallbackPage(chunk) : undefined;
    return end.call(this, page ?? chunk, ...rest);
  };
}

/**
 * A Claude subscription is left out of the app: Claude Code's provider (`claude-code`, a pi extension's, which turri's
 * Claude subscription vendor runs on) and Anthropic's own sign-in with Claude Pro/Max. The one needs Claude Code and a pi
 * extension installed from a terminal, and a project on a model its chat could not reach ran on whichever provider had
 * credentials instead; switching between the two routes to the same models mixed them up. Anthropic's models stay, with
 * an API key - and so do the other subscriptions: ChatGPT, GitHub Copilot.
 */
export const CLAUDE_CODE = "claude-code";
/** The providers whose subscription sign-in the app leaves out, keeping their API keys. */
const NO_SUBSCRIPTION = new Set(["anthropic"]);
/** Whether a model spec - provider/id, a thinking level after it - is Claude Code's, which the app does not offer. */
export const viaClaudeCode = (spec) => typeof spec === "string" && spec.startsWith(`${CLAUDE_CODE}/`);

/** What pi said when a prompt was refused or a login aborted: not a failure, the person changed their mind. */
const CANCELLED = "Login cancelled";

/**
 * The sign-ins of one engine. `runtime` resolves pi's model runtime to sign in through - the open chat's, so the
 * conversation has a credential as soon as it is stored - `projectDir` names the project open, if any, and `signedIn`
 * is called once a credential is stored or removed.
 */
export function createAuth({ emit, runtime, projectDir, signedIn }) {
  brandCallbackPages();
  /** Logins in progress, by id: each stopped by its controller. */
  const logins = new Map();
  let nextLogin = 0;
  /** pi's prompts waiting for the person, by id. */
  const prompts = new Map();
  let nextPrompt = 0;
  let settings;

  /** The providers whose models the project uses - harness-model's and coding-model's - for the sheet to list first. */
  function projectProviders(dir) {
    if (dir === undefined || !turri.hasProjectConfig(dir)) return [];
    try {
      const models = turri.projectModels(turri.readProjectConfig(dir));
      return [models.harness, models.coding].map((model) => turri.modelSpec(model)?.split("/")[0]).filter((provider) => provider !== undefined);
    } catch {
      return [];
    }
  }

  /**
   * Every provider pi knows - each with how it can be signed in to, and whether and how it is connected now. Another
   * window's sign-in reaches this runtime's credentials at once, but not what it says is connected: that is checked
   * again first.
   */
  async function providers({ dir = projectDir() }) {
    const models = await runtime();
    await models.refresh({ allowNetwork: false, signal: AbortSignal.timeout(5_000) }).catch(() => {});
    const stored = new Map((await models.listCredentials({ signal: AbortSignal.timeout(15_000) })).map((credential) => [credential.providerId, credential.type]));
    const used = projectProviders(dir);
    return {
      kept: join(pi.getAgentDir(), "auth.json"),
      providers: models.getProviders().filter((provider) => provider.id !== CLAUDE_CODE).map((provider) => {
        const status = models.getProviderAuthStatus(provider.id);
        const { apiKey } = provider.auth;
        const oauth = NO_SUBSCRIPTION.has(provider.id) ? undefined : provider.auth.oauth;
        return {
          id: provider.id,
          name: provider.name,
          subscription: oauth?.isSubscription === true,
          oauth: oauth !== undefined ? { name: oauth.name, label: oauth.loginLabel ?? null } : null,
          // Not interactive: configured outside pi only - an AWS profile, a credentials file.
          apiKey: apiKey !== undefined ? { name: apiKey.name, interactive: typeof apiKey.login === "function" } : null,
          connected: status.configured,
          how: status.configured ? (models.isUsingOAuth(provider.id) ? "oauth" : "api_key") : null,
          source: status.source ?? null,
          label: status.label ?? null,
          stored: stored.get(provider.id) ?? null,
          project: used.includes(provider.id),
        };
      }),
    };
  }

  /** This installation's id, as pi's terminal has it: some providers' sign-ins send it. */
  function deviceId() {
    settings ??= pi.SettingsManager.create(process.cwd(), pi.getAgentDir());
    return settings.getOrCreateDeviceId();
  }

  /** One of pi's prompts, put to the person: answered through `answer`, or withdrawn when the browser wins the race. */
  function prompt(login, { signal, ...shown }) {
    const id = ++nextPrompt;
    return new Promise((resolve, reject) => {
      const settle = () => {
        prompts.delete(id);
        signal?.removeEventListener("abort", withdrawn);
      };
      const withdrawn = () => {
        settle();
        emit("auth:withdrawn", { login, id });
        reject(new Error(CANCELLED));
      };
      if (signal?.aborted) return withdrawn();
      signal?.addEventListener("abort", withdrawn, { once: true });
      prompts.set(id, {
        login,
        answer: (value) => {
          settle();
          if (typeof value === "string") resolve(value);
          else reject(new Error(CANCELLED));
        },
      });
      emit("auth:prompt", { login, id, prompt: shown });
    });
  }

  /**
   * A sign-in started: its id at once, and the rest as events - auth:prompt, auth:event (the address to open, a device
   * code, progress) and auth:done once it is stored, failed or cancelled. Stored, the provider's models are looked up
   * again, as pi's terminal does after /login.
   */
  function login({ provider, method }) {
    if (provider === CLAUDE_CODE || (NO_SUBSCRIPTION.has(provider) && method === "oauth")) throw new Error("A Claude subscription is not offered here: sign in to Anthropic with an API key.");
    const id = ++nextLogin;
    const controller = new AbortController();
    logins.set(id, controller);
    // Begun once its id is sent: the window knows the sign-in before it hears anything of it.
    setImmediate(async () => {
      try {
        const models = await runtime();
        await models.login(
          provider,
          method,
          { signal: controller.signal, prompt: (asked) => prompt(id, asked), notify: (event) => emit("auth:event", { login: id, event }) },
          { getDeviceId: deviceId },
        );
        await models.refresh({ providers: [provider], signal: AbortSignal.timeout(15_000) }).catch(() => {});
        await signedIn(provider);
        emit("auth:done", { login: id, provider, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = controller.signal.aborted || message === CANCELLED;
        emit("auth:done", { login: id, provider, ok: false, cancelled, error: cancelled ? null : message });
      } finally {
        logins.delete(id);
        for (const waiting of [...prompts.values()]) if (waiting.login === id) waiting.answer(undefined);
      }
    });
    return { login: id };
  }

  /** A prompt answered - with what was typed or chosen, or null to cancel the sign-in it belongs to. */
  function answer({ id, value }) {
    prompts.get(id)?.answer(value ?? undefined);
    return true;
  }

  function cancel({ login }) {
    logins.get(login)?.abort();
    return true;
  }

  /** A stored credential removed. What the environment or models.json gives stays: it is not pi's to remove. */
  async function logout({ provider }) {
    const models = await runtime();
    await models.logout(provider, { signal: AbortSignal.timeout(15_000) });
    await signedIn(provider);
    return true;
  }

  return { authProviders: providers, authLogin: login, authAnswer: answer, authCancel: cancel, authLogout: logout };
}
