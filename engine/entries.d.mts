// For the tests, which map a transcript's entries as the engine does: what entries.mjs gives, loosely typed.
export function entryItem(entry: { type: string; customType?: string; data?: unknown; content?: unknown; display?: boolean; details?: Record<string, unknown> }): unknown;
export function normalise(message: { role: string; [key: string]: unknown } | null | undefined): unknown;
export const APP_COMMAND: string;
export function withoutEchoes<T>(items: T[]): T[];
export const APP_DECISION: string;
export function noticeDecision(
  notice: { state: string; kind?: string; summary: string; actions?: Array<{ label: string; task: string }> } | undefined,
  answer: unknown,
): { title: string; detail: string; prompt: string; said?: true } | undefined;
