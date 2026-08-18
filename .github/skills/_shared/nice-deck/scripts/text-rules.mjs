// Shared text rules for slide prose, outline frames, and direction probes.

// Speculation about cause, intent, future behavior, or what another
// observation would show. Interpretation belongs to the speaker, not the slide.
export const conjecturePattern = new RegExp([
  "\\b(?:cannot|can't|can not|could not|couldn't)\\s+(?:distinguish|separate|tell|rule out|confirm)\\b",
  "\\bwould\\s+(?:separate|distinguish|confirm|show|tell|reveal|indicate|suggest|prove)\\b",
  "\\b(?:may|might|could)\\s+(?:indicate|mean|suggest|imply|reflect|point)\\b",
  "\\b(?:suggests?|suggesting|implies|implying|indicates that|hints at|points to)\\b",
  "\\b(?:likely|unlikely|probably|presumably|arguably|plausibly)\\b",
  "\\b(?:appears|seems)\\s+to\\b",
  "\\bwe\\s+(?:believe|expect|assume|suspect|think)\\b",
  "\\b(?:is|are)\\s+expected\\s+to\\b",
].join("|"), "i");

// Visible prose words allowed on one slide, outside the title, direct labels,
// values, and the citation line.
export const proseBudget = 40;

export function findConjecture(text) {
  return String(text ?? "").match(conjecturePattern)?.[0] ?? null;
}

export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export function sentenceCount(text) {
  return String(text ?? "").split(/[.!?](?:\s|$)/).map((part) => part.trim()).filter(Boolean).length;
}
