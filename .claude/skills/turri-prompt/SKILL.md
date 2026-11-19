---
name: turri-prompt
description: Writes the prompt for an agent session in the turri repo, for the person to paste there. Use whenever turri must change - something the app needs that turri's host entry lacks, or a turri bug or behaviour found from the app.
---

# A prompt for turri

turri is changed in its own repo (`../turri`), by an agent session there that the person runs: never from here. This skill writes that session's prompt, and ends with the person pasting it.

The prompt is a **requirement**, never a solution. It says what happens now, what must hold instead and how to tell, and leaves the how to the turri session, which knows turri's code and works it out with the person. A prompt that names a function to add, a field, a file to edit or an approach has decided for them: rewrite that sentence as the outcome it is after.

## 1. Gather the evidence

Collect what shows the problem or the need, from what actually happened - nothing assumed:

- what was done, with what turri (`TURRI_DEV` clone at which commit, or the pinned package) and on which project;
- what was seen: output, log lines, ledger entries, transcript turns, ids, timestamps, the text the person read - quoted, short;
- what turri's own docs say should happen (`docs/*.md` in `../turri`), when they say it.

Code locations go in only as what the code says now, quoted - never as the place to change. Done when every claim in the prompt rests on something seen or quoted.

## 2. Write the requirement

For each problem or need, the outcome that must hold, as the app or the person sees it: what a host must be able to know or do, what the person must be told, what must never happen. Say what the app needs, not the shape of the API that gives it. Name the constraints that bind any answer - the app reaches turri only through `@turri-dev/cli/host`; turri's docs stay true to what it does - and how to tell it is met, as observable checks. Done when each requirement can be met in more than one way and none is preferred.

## 3. Check it for solutions

Read the draft sentence by sentence. Any that proposes - "add", "make X do Y by Z", "consider", "should use", "e.g. a field" - is rewritten as the outcome it serves, or cut. Done when nothing left could be lifted into the code as written.

## 4. Assemble it

One code block, in this shape:

```
You are in the turri repo. <One or two lines: what the person or the desktop app (turri-app, ../turri-app) ran into, or needs.>

## What happens now
<The evidence, problem by problem.>

## What is required
<The requirements, each with how to tell it holds.>

## Boundaries
- Never write anything in turri-app (../turri-app) - no file, no commit: the app's side is changed in its own session.
<Any other constraint the requirements carry.>

Think this through before changing anything: read what turri has around it, find the cause, and weigh the ways to meet each requirement. Then resolve it with the person - say what you found and the options you see, and agree the way with them before you build it.
```

## 5. Hand it over

Give the person the block whole, and ask them to paste it into an agent session in the turri repo. Write nothing in `../turri` yourself.
