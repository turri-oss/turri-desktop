import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthEvent, AuthPrompt, AuthProvider } from "../electron/preload.ts";
import { Icon, Spinner } from "./ui.tsx";

type Method = "oauth" | "api_key";

/** A sign-in going on: what pi has asked and said so far. */
interface Login {
  id: number | null;
  provider: AuthProvider;
  method: Method;
  prompt: { id: number; prompt: AuthPrompt } | null;
  url: { url: string; instructions?: string } | null;
  device: { userCode: string; verificationUri: string } | null;
  lines: Array<{ text: string; links?: Array<{ url: string; label?: string }> }>;
  error: string | null;
}

/** How a provider is connected now, in a few words - or null when it is not. */
function connection(provider: AuthProvider): string | null {
  if (!provider.connected) return null;
  switch (provider.source) {
    case "stored":
      return provider.how === "oauth" ? "signed in" : "API key saved";
    case "environment":
      return provider.label ? `from ${provider.label}` : "from the environment";
    case "models_json_key":
    case "models_json_command":
      return "from models.json";
    case "runtime":
      return "for this session";
    default:
      return provider.label ? `from ${provider.label}` : "connected";
  }
}

/**
 * The words for signing in in the browser: pi's own label where it has one ("Sign in with ChatGPT"), lowercased; else
 * the subscription its name gives - "OpenAI (ChatGPT Plus/Pro)" is your ChatGPT Plus/Pro - or the name itself.
 */
function signInWith(provider: AuthProvider): string {
  const oauth = provider.oauth!;
  if (oauth.label) return oauth.label.charAt(0).toLowerCase() + oauth.label.slice(1);
  const subscription = /\(([^)]+)\)/.exec(oauth.name)?.[1];
  return subscription !== undefined && provider.subscription ? `sign in with your ${subscription}` : `sign in with ${subscription ?? oauth.name}`;
}

/** The ways a provider can be signed in to here. */
function methodsOf(provider: AuthProvider): Method[] {
  return [...(provider.oauth ? (["oauth"] as const) : []), ...(provider.apiKey?.interactive ? (["api_key"] as const) : [])];
}

/** A provider's ways in, said under its name. */
function waysIn(provider: AuthProvider): string {
  const ways = [provider.oauth && signInWith(provider), provider.apiKey && (provider.apiKey.interactive ? (provider.oauth ? "an API key" : provider.apiKey.name) : `${provider.apiKey.name}, set up outside turri`)];
  return ways.filter(Boolean).join(" · or ");
}

/** An error as the main process said it, without Electron's wrapping. */
const plain = (failure: unknown) => String((failure as Error).message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/**
 * Signing in to the model providers turri's models come from - pi's own sign-ins, as /login runs them in a terminal: a
 * subscription in the browser (ChatGPT, GitHub Copilot - never a Claude subscription, which the engine leaves out), or an API key typed here. Opened on a provider
 * (`initial`, its id or name) it goes straight to it. `dir` is the project whose models' providers are listed first;
 * `onSignedIn` hears of each sign-in that stored a credential.
 */
export function AuthSheet({ dir, initial, onSignedIn, onClose }: { dir?: string; initial?: string | null; onSignedIn?: (provider: string) => void; onClose: () => void }) {
  const [providers, setProviders] = useState<AuthProvider[] | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [choosing, setChoosing] = useState<AuthProvider | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loginRef = useRef<Login | null>(null);
  loginRef.current = login;

  const load = async () => {
    try {
      const { kept: where, providers: all } = await window.turri.auth.providers(dir);
      setKept(where.replace(/^\/(Users|home)\/[^/]+/, "~"));
      setProviders(all);
      return all;
    } catch (failure) {
      setError(plain(failure));
      return null;
    }
  };

  useEffect(() => {
    void load().then((all) => {
      if (all === null || !initial) return;
      const wanted = initial.toLowerCase();
      const found = all.find((provider) => provider.id.toLowerCase() === wanted || provider.name.toLowerCase() === wanted);
      if (found !== undefined) choose(found);
      else setQuery(initial);
    });
  }, []);

  // What pi asks and says during the sign-in going on.
  useEffect(() => {
    const ours = (data: { login: number }) => loginRef.current !== null && loginRef.current.id === data.login;
    const update = (change: (now: Login) => Login) => setLogin((now) => (now === null ? now : change(now)));
    const off = [
      window.turri.on("engine:auth:prompt", (data: { login: number; id: number; prompt: AuthPrompt }) => ours(data) && update((now) => ({ ...now, prompt: { id: data.id, prompt: data.prompt } }))),
      window.turri.on("engine:auth:withdrawn", (data: { login: number; id: number }) => ours(data) && update((now) => (now.prompt?.id === data.id ? { ...now, prompt: null } : now))),
      window.turri.on("engine:auth:event", (data: { login: number; event: AuthEvent }) => {
        if (!ours(data)) return;
        const { event } = data;
        if (event.type === "auth_url") update((now) => ({ ...now, url: { url: event.url, instructions: event.instructions } }));
        else if (event.type === "device_code") update((now) => ({ ...now, device: { userCode: event.userCode, verificationUri: event.verificationUri } }));
        else update((now) => ({ ...now, lines: [...now.lines, { text: event.message, links: event.type === "info" ? event.links : undefined }] }));
      }),
      window.turri.on("engine:auth:done", (data: { login: number; provider: string; ok: boolean; cancelled: boolean; error: string | null }) => {
        if (!ours(data)) return;
        const now = loginRef.current!;
        if (data.ok) {
          setLogin(null);
          setChoosing(null);
          setNotice(now.method === "oauth" ? `signed in to ${now.provider.name}.` : `the API key for ${now.provider.name} is saved.`);
          void load();
          onSignedIn?.(data.provider);
        } else if (data.cancelled) {
          setLogin(null);
        } else update((was) => ({ ...was, prompt: null, error: data.error }));
      }),
    ];
    return () => off.forEach((stop) => stop());
  }, [onSignedIn]);

  // Closed while signing in: the sign-in stops with it.
  useEffect(
    () => () => {
      const now = loginRef.current;
      if (now?.id != null && now.error === null) void window.turri.auth.cancel(now.id);
    },
    [],
  );

  const start = async (provider: AuthProvider, method: Method) => {
    setNotice(null);
    setError(null);
    const fresh: Login = { id: null, provider, method, prompt: null, url: null, device: null, lines: [], error: null };
    setLogin(fresh);
    try {
      const { login: id } = await window.turri.auth.login(provider.id, method);
      setLogin((now) => (now === null ? now : { ...now, id }));
      // Ids are only known from here: the ref is set at once, so the events that follow find it.
      if (loginRef.current !== null) loginRef.current = { ...loginRef.current, id };
    } catch (failure) {
      setLogin({ ...fresh, error: plain(failure) });
    }
  };

  /** A provider chosen: signed in to at once if it has one way in, or asked which. */
  function choose(provider: AuthProvider) {
    setNotice(null);
    const methods = methodsOf(provider);
    if (methods.length === 1) void start(provider, methods[0]!);
    else setChoosing(provider);
  }

  const signOut = async (provider: AuthProvider) => {
    setNotice(null);
    setError(null);
    try {
      await window.turri.auth.logout(provider.id);
      setNotice(provider.stored === "oauth" ? `signed out of ${provider.name}.` : `the API key for ${provider.name} is removed.`);
      await load();
    } catch (failure) {
      setError(plain(failure));
    }
  };

  const signingIn = login !== null && login.error === null;
  const close = () => !signingIn && onClose();

  return createPortal(
    // A sheet inside another - the doctor's, a new project's - is not clicked through to the one under it.
    <div className="sheet-backdrop" onClick={(event) => (event.stopPropagation(), close())}>
      <div className="sheet auth" onClick={(event) => event.stopPropagation()}>
        {login !== null ? (
          <SigningIn login={login} onAnswer={(value) => {
            if (login.prompt === null) return;
            void window.turri.auth.answer(login.prompt.id, value);
            setLogin({ ...login, prompt: null });
          }} onCancel={() => (login.id !== null ? void window.turri.auth.cancel(login.id) : setLogin(null))} onBack={() => setLogin(null)} />
        ) : choosing !== null ? (
          <ChooseMethod provider={choosing} onChoose={(method) => void start(choosing, method)} onBack={() => setChoosing(null)} />
        ) : (
          <>
            <h2>sign in to your models</h2>
            <p className="muted small">
              turri's models come from these providers: sign in with a subscription in your browser, or type an API key. what you sign in to is kept in{" "}
              <code>{kept ?? "pi's auth.json"}</code>, for every project.
            </p>
            {notice && <p className="auth-notice">{notice}</p>}
            {error && <p className="error-text">{error}</p>}
            {providers === null ? (
              !error && (
                <p className="muted">
                  <Spinner /> looking at the providers…
                </p>
              )
            ) : (
              <ProviderList providers={providers} query={query} onQuery={setQuery} onChoose={choose} onSignOut={(provider) => void signOut(provider)} />
            )}
            <div className="sheet-actions">
              <button className="button primary" onClick={onClose}>
                done
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The providers, searchable: the project's first, then those with a subscription to sign in with, then API keys. */
function ProviderList({ providers, query, onQuery, onChoose, onSignOut }: { providers: AuthProvider[]; query: string; onQuery: (query: string) => void; onChoose: (provider: AuthProvider) => void; onSignOut: (provider: AuthProvider) => void }) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const matching = providers
    .filter((provider) => words.every((word) => `${provider.name} ${provider.id} ${waysIn(provider)}`.toLowerCase().includes(word)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sections: Array<[string, AuthProvider[]]> = [
    ["this project's models", matching.filter((provider) => provider.project)],
    ["subscriptions", matching.filter((provider) => !provider.project && provider.oauth !== null)],
    ["API keys", matching.filter((provider) => !provider.project && provider.oauth === null)],
  ];
  return (
    <>
      <input
        className="recents-search auth-search"
        type="search"
        value={query}
        placeholder={`search ${providers.length} providers`}
        spellCheck={false}
        autoFocus
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter signs in to the first that matches; Escape clears the search.
          const first = sections.flatMap(([, listed]) => listed)[0];
          if (event.key === "Enter" && first !== undefined) onChoose(first);
          if (event.key === "Escape" && query !== "") (event.stopPropagation(), onQuery(""));
        }}
      />
      {matching.length === 0 && <p className="muted">no provider matches “{query}”.</p>}
      <div className="auth-providers">
        {sections
          .filter(([, listed]) => listed.length > 0)
          .map(([title, listed]) => (
            <section key={title}>
              <div className="sidebar-section">{title}</div>
              <ul>
                {listed.map((provider) => {
                  const connected = connection(provider);
                  const canSignIn = methodsOf(provider).length > 0;
                  return (
                    <li key={provider.id} className={connected ? "connected" : ""}>
                      <button className="auth-provider" onClick={() => onChoose(provider)} disabled={!canSignIn} title={canSignIn ? `sign in to ${provider.name}` : `${provider.apiKey?.name ?? provider.name} is set up outside turri`}>
                        <span className="auth-dot" aria-hidden />
                        <span className="auth-provider-text">
                          <strong>{provider.name}</strong>
                          <span className="option-detail">{waysIn(provider)}</span>
                        </span>
                      </button>
                      {connected && <span className={`auth-status ${provider.source === "stored" ? "stored" : ""}`}>{connected}</span>}
                      {provider.stored !== null && (
                        <button className="link auth-sign-out" onClick={() => onSignOut(provider)} title={`remove what signing in to ${provider.name} stored`}>
                          sign out
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>
    </>
  );
}

/** A provider with a subscription and API keys both: which to sign in with. */
function ChooseMethod({ provider, onChoose, onBack }: { provider: AuthProvider; onChoose: (method: Method) => void; onBack: () => void }) {
  const methods = methodsOf(provider);
  return (
    <>
      <h2>sign in to {provider.name}</h2>
      {connection(provider) && <p className="muted small">connected now: {connection(provider)}. signing in again replaces what a sign-in stored.</p>}
      {methods.length === 0 ? (
        <p className="muted">{provider.apiKey?.name ?? provider.name} is set up outside turri - in the environment or the provider's own tools - and turri finds it there.</p>
      ) : (
        <div className="options">
          {methods.includes("oauth") && (
            <button className="option" onClick={() => onChoose("oauth")} autoFocus>
              <strong>{signInWith(provider)}</strong>
              <span className="option-detail">in your browser{provider.subscription ? " - the models come with your subscription" : ""}</span>
            </button>
          )}
          {methods.includes("api_key") && (
            <button className="option" onClick={() => onChoose("api_key")}>
              <strong>use an API key</strong>
              <span className="option-detail">{provider.apiKey!.name}, typed here - each call paid for by the key's account</span>
            </button>
          )}
        </div>
      )}
      <div className="sheet-actions">
        <button className="button" onClick={onBack}>
          back
        </button>
      </div>
    </>
  );
}

/** Copy a text, and say so for a moment. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied((now) => (now === text ? null : now)), 1500);
  };
  return { copied, copy };
}

/** A sign-in going on: the address to open, a device code to type, what pi asks - each as the window draws it. */
function SigningIn({ login, onAnswer, onCancel, onBack }: { login: Login; onAnswer: (value: string | null) => void; onCancel: () => void; onBack: () => void }) {
  const { copied, copy } = useCopy();
  const { prompt, url, device, lines, error } = login;
  // The browser's sign-in races a pasted code: while either can win, the window waits for the browser beside the field.
  const waitingForBrowser = error === null && url !== null && (prompt === null || prompt.prompt.type === "manual_code");
  return (
    <>
      <h2>
        {login.method === "oauth" ? signInWith(login.provider) : `an API key for ${login.provider.name}`}
      </h2>
      {url !== null && (
        <div className="auth-url">
          <p className="muted small">your browser opened to sign in. if it did not, open this address:</p>
          <div className="auth-url-row">
            <code title={url.url}>{url.url}</code>
            <button className="button small" onClick={() => copy(url.url)}>
              <Icon name="copy" size={13} /> {copied === url.url ? "copied" : "copy"}
            </button>
            <button className="button small" onClick={() => window.open(url.url)}>
              <Icon name="globe" size={13} /> open
            </button>
          </div>
          {/* Said again by the field for the code, while there is one. */}
          {url.instructions && prompt?.prompt.type !== "manual_code" && <p className="muted small">{url.instructions}</p>}
        </div>
      )}
      {device !== null && (
        <div className="auth-device">
          <p className="muted small">
            type this code at{" "}
            <a href={device.verificationUri} target="_blank" rel="noreferrer">
              {device.verificationUri}
            </a>
            :
          </p>
          <div className="device-code">{device.userCode}</div>
          <button className="button primary" onClick={() => (copy(device.userCode), window.open(device.verificationUri))}>
            <Icon name="copy" size={13} /> {copied === device.userCode ? "copied - now paste it there" : "copy the code and open the page"}
          </button>
        </div>
      )}
      {lines.length > 0 && (
        <ul className="auth-lines">
          {lines.map((line, index) => (
            <li key={index}>
              {line.text}
              {line.links?.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                  {" "}
                  {link.label ?? link.url}
                </a>
              ))}
            </li>
          ))}
        </ul>
      )}
      {waitingForBrowser && (
        <p className="muted auth-waiting">
          <Spinner /> waiting for the browser…
        </p>
      )}
      {device !== null && error === null && prompt === null && (
        <p className="muted auth-waiting">
          <Spinner /> waiting for you to type the code…
        </p>
      )}
      {prompt !== null && <PromptField key={prompt.id} prompt={prompt.prompt} onAnswer={onAnswer} />}
      {error === null && prompt === null && url === null && device === null && (
        <p className="muted auth-waiting">
          <Spinner /> signing in…
        </p>
      )}
      {error !== null && <p className="error-text">{error}</p>}
      <div className="sheet-actions">
        {error !== null ? (
          <button className="button primary" onClick={onBack} autoFocus>
            back
          </button>
        ) : (
          <button className="button" onClick={onCancel}>
            cancel
          </button>
        )}
      </div>
    </>
  );
}

/** One of pi's prompts as a form field: a password field for a secret, buttons for a choice, a field for the rest. */
function PromptField({ prompt, onAnswer }: { prompt: AuthPrompt; onAnswer: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  if (prompt.type === "select") {
    return (
      <div className="auth-prompt">
        <p>{prompt.message}</p>
        <div className="options">
          {prompt.options.map((option, index) => (
            <button key={option.id} className="option" onClick={() => onAnswer(option.id)} autoFocus={index === 0}>
              <strong>{option.label}</strong>
              {option.description && <span className="option-detail">{option.description}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form
      className="auth-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "" || prompt.type === "text") onAnswer(value.trim());
      }}
    >
      <label>
        <span>{prompt.message}</span>
        <input
          className="recents-search"
          type={prompt.type === "secret" ? "password" : "text"}
          value={value}
          placeholder={prompt.placeholder}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {/* Text may be left blank - pi says what blank means: "blank for github.com". */}
      <button className="button primary" type="submit" disabled={value.trim() === "" && prompt.type !== "text"}>
        {prompt.type === "secret" ? "save" : "continue"}
      </button>
    </form>
  );
}
