// For the tests, which map a transcript's entries as the engine does: what entries.mjs gives, loosely typed.
export function entryItem(entry: { type: string; customType?: string; data?: unknown; content?: unknown; display?: boolean; details?: Record<string, unknown> }): unknown;
