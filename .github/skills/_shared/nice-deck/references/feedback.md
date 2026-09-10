# Fast feedback

User-requested changes to an existing deck take the fast path by default.
This scope rule takes precedence over the new-deck and full-audit checklists.
The user should see the revision before time is spent on optional assurance.

## The normal loop

1. Read the affected slide and only the source, style, or logic needed to edit it.
   Reuse the approved content and direction; a concrete edit request authorizes
   that revision without restarting outline or direction approval.
2. Batch the edits and build once, if the deck has a builder.
3. Call `nice_deck_preview` once with `slideIds` naming the affected slides.
   The default `mode: "feedback"` captures those slides without running a
   full-deck audit. Inspect their returned images yourself, including any new
   generated text. Fix a visible defect if present.
4. Refresh Browser Canvas to the returned URL, focused on the changed slide.
   Deliver the requested revision. Stop.

No automatic renders after individual file writes. No before-edit baseline
render when current content is already available. No review subagents,
four-role sign-off, review JSON, full-deck screenshot comparisons, or repeated
proof files for routine feedback. Do not gate the revision on unchanged
appendix slides, calculator scenarios, or delivery surfaces.

## Match scope to the change

| Change | Additional work, only when relevant |
|---|---|
| Wording, spacing, color, or image | Inspect the changed slide; proof new image text in the same pass. |
| A fact, price, citation, or formula | Check that changed claim against its source or calculation. |
| Calculator behavior or shared inputs | Exercise the affected control and dependent result once. |
| Shared style, runtime, or navigation | Include affected representative layouts or transitions; broaden if a defect appears. |
| Requested delivery copy | Save to the existing destination and open the changed content there once. |

Do not rerun extraction, synchronize an unchanged runtime, exercise every
interactive state, or test file/static/preview three times for a local copy edit.
Do not add hash-based carry-forward machinery just to avoid a needless audit.
Preserve source fidelity, accessibility, and honest scope: a focused visual
check is not a claim that the entire deck passed an audit.

## Optional assurance

Use `mode: "audit"` only for an explicitly requested full audit or a concrete
cross-deck problem that a focused check cannot diagnose. It runs the complete
mechanical checks and captures every slide. A new deck needs a complete visual
read-through once, not repeated full audits after each batch.

Independent adversarial review is opt-in when the user requests it. Do not
launch review agents simply because an image was generated or a file is being
delivered. The strict four-role workflow remains available in
`adversarial-review.md`; export enforces it only with `--require-review`.
Missing or stale optional reviews do not block ordinary preview or delivery.

If the user asks to cut checks, reduce work immediately rather than announcing
another validation phase. Reuse the live preview tool; do not build parallel
servers or delivery harnesses for a small edit.
