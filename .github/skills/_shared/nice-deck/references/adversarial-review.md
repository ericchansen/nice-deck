# Adversarial visual review

Adversarial review is the presentation and delivery gate. Preview remains
available for drafts, but a mechanically clean render is not approved design.

## Canonical evidence

Review the exact 1600×900 screenshots returned by `nice_deck_preview`. Every
review record is bound to:

- the complete deck source hash
- each canonical screenshot SHA-256
- each generated asset SHA-256

Any changed hash makes the review stale.

## Independent roles

Run each role independently. A reviewer sees the screenshots before the
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

Initialize and validate:

```powershell
npm run review:init -- <workspace>
npm run validate:review -- <workspace>
```

`review:init` creates a draft record from the latest preview. Reviewers inspect
the copied screenshots and complete their role entries. `validate:review`
rejects missing, rejected, malformed, or stale records.

## Drafts and delivery

Draft preview and explicit draft exports are allowed before approval. Draft
exports carry a `.draft` suffix and are not deliverables. Final PDF and portable
exports require a current approved review.
