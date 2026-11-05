// What a chat says, as the window draws it: pi's messages and the entries turri's extension writes - its terminal
// renderers' counterparts - each made the window's item, or nothing for what the person never sees. Plain data in and
// out, with nothing of turri's loaded: the tests map a transcript's entries with it, as the engine does.
import { retriedWithoutImages } from "./browser.mjs";

/**
 * A turn a button of the window's asks for in the person's place - try it, write testing scenarios, investigate: its
 * prompt goes to turri as the person's words, and the chat shows what was asked, by its kind, never the prompt as if
 * they had typed it.
 */
export const APP_ACTION = "turri_app_action";
/** The kinds of such buttons: each drawn its own way in the chat (src/actions.ts). */
export const ACTION_KINDS = new Set(["try", "convert", "scenarios", "start", "investigate", "conform", "regenerate"]);
/**
 * A button that runs one of turri's own commands - regenerate from scratch - rather than asking in words: the chat shows
 * its box, as an action's, then the command runs, its echo left out. An entry of the chat's, never sent to the model.
 */
export const APP_COMMAND = "turri_app_command";
/**
 * What the person decided of a notice - one of its actions, or their own words - that sets the chat to work: their box,
 * as a button's is, saying what they chose and what it was about. An entry of the chat's, never sent to the model:
 * turri's own message for the turn is hidden.
 */
export const APP_DECISION = "turri_app_decision";

/**
 * The person's decision on a notice, as the chat keeps it - or nothing for an answer that starts no work in the chat:
 * dismissed, ignored, a fix already made, or yes to starting the sentinel, which starts the sentinel, not the chat.
 */
export function noticeDecision(notice, answer) {
  if (notice === undefined || notice.state !== "open" || notice.kind === "fixed") return undefined;
  if (typeof answer?.steer === "string" && answer.steer.trim() !== "") return { title: answer.steer.trim(), detail: notice.summary, prompt: "", said: true };
  if (notice.kind === "sentinel-start" || typeof answer?.action !== "number") return undefined;
  const action = notice.actions?.[answer.action];
  return action === undefined ? undefined : { title: action.label, detail: notice.summary, prompt: action.task };
}

/**
 * A message turri sends a chat's agent: a note the person sees - or, hidden, nothing, but for the sentinel's brief of a
 * pulse, which marks where its work on that pulse starts: regen shows each pulse what the sentinel did of it - and the
 * test advisor's yes, which starts the turn that writes the scenarios: a mark of where it came from, `module:func-id`s - and
 * a background run that did not do its work, which starts the turn that says so: a mark of each run, its skill, the
 * testing script it was to write and the module it was for (on a turri before `runs`, its skill alone).
 */
function customItem(message) {
  if (message.customType === APP_ACTION) {
    const details = message.details ?? {};
    return { role: "action", kind: typeof details.kind === "string" ? details.kind : "start", title: String(details.title ?? ""), ...(typeof details.detail === "string" ? { detail: details.detail } : {}), prompt: textOf(message.content) };
  }
  if (message.customType === "turri_sentinel_pulse") return { role: "sentinelPulse", job: message.details?.jobId ?? null };
  // A check the person asked of it: where its work on a pulse ends - what follows is no pulse's.
  if (message.customType === "turri_sentinel_check") return { role: "sentinelPulse", job: null };
  if (message.customType === "turri_advisor_verdict") return { role: "advisorVerdict", specs: Array.isArray(message.details?.specs) ? message.details.specs : [] };
  if (message.customType === "turri_skill_run") {
    const details = message.details ?? {};
    const runs = Array.isArray(details.runs) ? details.runs : Array.isArray(details.skills) ? details.skills.map((skill) => ({ skill })) : [];
    return { role: "skillRun", runs };
  }
  return message.display === false ? null : { role: "note", customType: message.customType, text: textOf(message.content) };
}

/** An entry turri's extension writes into the chat, as the window shows it - its terminal renderers' counterparts. */
export function entryItem(entry) {
  if (entry?.type === "custom_message") return customItem(entry);
  if (entry?.type !== "custom") return null;
  const data = entry.data ?? {};
  switch (entry.customType) {
    case APP_COMMAND:
      return { role: "action", kind: typeof data.kind === "string" ? data.kind : "start", title: String(data.title ?? ""), ...(typeof data.detail === "string" ? { detail: data.detail } : {}), prompt: String(data.command ?? ""), command: String(data.command ?? "") };
    case APP_DECISION:
      return { role: "action", kind: data.said ? "said" : "chose", title: String(data.title ?? ""), ...(typeof data.detail === "string" ? { detail: data.detail } : {}), prompt: String(data.prompt ?? "") };
    case "turri_command_outcome":
      // The command as typed, then what it showed - the two in one entry when it was not echoed first.
      if (data.text === undefined) return { role: "command", text: data.command };
      return { role: "note", customType: entry.customType, level: data.level, text: data.echoed ? data.text : `${data.command}\n\n${data.text}` };
    case "turri_job":
      return { role: "job", id: data.id, summary: data.summary, status: data.incomplete ? "incomplete" : data.status, duration: data.duration, spent: data.spent, text: data.text };
    case "turri_history":
      return { role: "note", customType: entry.customType, text: `History of ${data.module}\n\n\`\`\`\n${data.text}\n\`\`\`` };
    case "turri_skill_message":
      // Said while a skill ran, and read by the skill's own agent: the person's message, where it was heard.
      return { role: "user", text: data.text };
    case "turri_btw":
      return { role: "note", customType: entry.customType, text: `**By the way:** ${data.question}\n\n${data.answer}` };
    case "turri_exchange":
      return { role: "note", customType: entry.customType, text: `**${data.question}**\n\n${data.answer}` };
    // The test advisor's no, and a background run that wrote its testing script: one line of turri's, starting no turn.
    case "turri_advisor":
    case "turri_skill_run":
      return { role: "note", customType: entry.customType, text: data.text };
    // The sentinel's: a notice put in this chat - the whole of it - and how one ended, which its card says; and the
    // sentinel done with a pulse.
    case "turri_notice":
      return { role: "notice", notice: data };
    case "turri_notice_over":
      return { role: "noticeOver", state: data.state, summary: data.summary };
    case "turri_sentinel_concluded":
      return { role: "concluded", conclusion: data };
    default:
      return null;
  }
}

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** A message as the window shows it - or several, or nothing for what the person never sees. */
export function normalise(message) {
  if (message === undefined || message === null || retriedWithoutImages(message)) return null;
  switch (message.role) {
    case "user": {
      // The images attached to it, as the window draws them.
      const images = Array.isArray(message.content) ? message.content.filter((part) => part.type === "image").map((part) => `data:${part.mimeType};base64,${part.data}`) : [];
      return { role: "user", text: textOf(message.content), ...(images.length > 0 ? { images } : {}) };
    }
    case "assistant": {
      const parts = Array.isArray(message.content) ? message.content : [];
      return {
        role: "assistant",
        text: parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
        // What it thought, as the model gave it - none of a part its provider redacted, which pi keeps as a placeholder.
        thinking: parts.filter((part) => part.type === "thinking" && part.redacted !== true).map((part) => part.thinking).join(""),
        tools: parts.filter((part) => part.type === "toolCall").map((part) => ({ id: part.id, name: part.name, args: part.arguments })),
        error: message.stopReason === "error" ? (message.errorMessage ?? "The model returned an error.") : undefined,
      };
    }
    case "toolResult": {
      // What turri saw, when it was an image - the preview, as browser_screenshot or terminal_screenshot took it.
      const image = Array.isArray(message.content) ? message.content.find((part) => part.type === "image") : undefined;
      // A skill cultivate started in the background: the testing script it writes and the module it is for, or that it
      // was running already.
      const details = message.details ?? {};
      const background =
        details.background === true
          ? { ...(typeof details.kind === "string" ? { kind: details.kind } : {}), ...(typeof details.plainFile === "string" ? { plainFile: details.plainFile } : {}), ...(details.started === false ? { already: true } : {}) }
          : undefined;
      return {
        role: "toolResult",
        id: message.toolCallId,
        name: message.toolName,
        text: textOf(message.content).slice(0, 4000),
        isError: message.isError === true,
        ...(image !== undefined ? { image: `data:${image.mimeType};base64,${image.data}` } : {}),
        ...(background !== undefined ? { background } : {}),
        // The file a tool wrote, as its result says it: turn_on_conformance_tests's config.
        ...(typeof details.file === "string" ? { file: details.file } : {}),
        // What an edit changed, as a patch: the chat shows it under the edit of a .plain file.
        ...(message.toolName === "edit" && typeof details.patch === "string" ? { patch: details.patch.slice(0, 100_000) } : {}),
      };
    }
    case "custom":
      return customItem(message);
    default:
      return null;
  }
}

/**
 * A chat's transcript as the window draws it again: its entries in the conversation's order - pi's messages and what
 * turri wrote between them, a pulse's end, a notice - from the session's context (pi's own, for its terminal). On a pi
 * without it, its messages alone.
 */
export function transcript(session) {
  const manager = session.sessionManager;
  if (typeof manager?.buildContextEntries !== "function") return session.messages.flatMap((message) => [normalise(message)].flat()).filter(Boolean);
  return withoutEchoes(
    manager
      .buildContextEntries()
      .flatMap((entry) => [entry.type === "message" ? normalise(entry.message) : entryItem(entry)].flat())
      .filter(Boolean),
  );
}

/** A command a button ran, said once: its box - the echo turri writes right under it, the command as typed, left out. */
export function withoutEchoes(items) {
  return items.filter((item, index) => !(item.role === "command" && index > 0 && items[index - 1].role === "action" && items[index - 1].command === item.text));
}
