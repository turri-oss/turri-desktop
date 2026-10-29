// turri's host entry as the engine loads it - for the tests that call turri as the engine does: what they use of it.
declare const turri: { textHash(text: string): string };
export default turri;
export const turriFrom: string;
