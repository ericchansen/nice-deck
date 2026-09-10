# Adversarial visual review

Adversarial review is an opt-in assurance workflow, not the default feedback,
presentation, or delivery gate. Use it only when the user requests independent
adversarial review. Routine revisions use `feedback.md`: the author inspects
the changed slides and shows the result without review agents or review JSON.

## Canonical evidence

For this strict workflow, run `nice_deck_preview` with `mode: "audit"` and
review its exact 1600×900 screenshots. Every
review record is bound to:

- the complete deck source hash
- each canonical screenshot SHA-256
- each generated asset SHA-256

Any changed hash makes this optional review stale. That does not block ordinary
feedback or delivery, and does not automatically trigger another review.

## Independent roles

When this four-role workflow is requested, run each role independently. A reviewer sees the screenshots before the
author's rationale or the other reviewers' findings.

### Cold read

- State the perceived message and reading order.
- Identify the dominant evidence and intended action.
- Reject a graphic that does not speak for itself.

### Art direction

- Judge hierarchy, scale, balance, composition, crop, and occlusion.
- Identify generic imagery, competing focal points, and unexplained blank space.
- Compare trusted visual references when one exists.

### Image-text proof

- For `imageText.mode: integrated`, compare every generated string character by
  character with `bakedText`.
- Reject misspellings, substitutions, duplicates, extra pseudo-text, weak
  contrast, ambiguous mappings, or text unreadable at on-slide size.
- Confirm the image carries its idea without redundant native labels.

### Geometry and citations

- Confirm canonical and off-aspect viewport checks pass.
- Confirm no evidence is obscured or accidentally cropped.
- Verify citations are linked, subordinate, and separate from integrated image
  text.

For exact diagrams, apply
[architecture-diagrams.md](architecture-diagrams.md) within these existing
roles. After the screenshot-first read, geometry/citations compares the
node/edge/boundary model with sources and checks ports, conditions, containment,
crossings, and standalone/offline output. For sequences, also compare message
occurrences and order, group nesting, parallel/alternative branch membership,
guards, repetition bounds, and message/group counts against the approved model.
Image-text proof checks native SVG
strings against the packet rather than requiring generated `bakedText`.
Art direction judges labels at actual on-slide size. Keep model metadata in
`visual-manifest.json` and diagram SVGs under `assets/` so changes invalidate
the source hash; a clean scanner is not a topology or SVG-safety approval.

## Verdict

Every role records `approve` or `revise` and concrete findings. Approval requires
all roles to approve with no unresolved findings.

Review artifacts live under:

```text
reviews/<source-hash>/
  review.json
  slide-01.png
  ...
```

Initialize and validate against a full audit (not a scoped feedback preview):

```powershell
npm run preview -- <workspace>\deck.html --audit
npm run review:init -- <workspace>
npm run validate:review -- <workspace>
```

`review:init` creates a draft record from the latest preview. Reviewers inspect
the copied screenshots and complete their role entries. `validate:review`
rejects missing, rejected, malformed, or stale records.

## Export policy

Ordinary PDF and portable exports do not require formal review. Add
`--require-review` when the user wants exports gated on this strict approval.
Explicit draft exports still carry a `.draft` suffix. A missing or stale review
does not turn an ordinary export into a draft.
