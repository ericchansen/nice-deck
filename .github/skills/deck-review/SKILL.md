---
name: deck-review
description: Audit and improve an existing presentation's argument, evidence, visual design, accessibility, rendering, and delivery readiness. Use when the user asks to review, critique, polish, fix, validate, improve, or prepare an existing deck or set of slides.
license: MIT
---

# deck-review

Review the rendered presentation as an audience would experience it, then make
the requested improvements. Preserve the deck's titles, structure, argument,
and visual framing unless the user explicitly asks for a redesign.

If the work needs a fundamentally new visual system, use
`deck-explore-direction` before propagating a reskin.

## Small changes: take the fast path

For user feedback on one or a few slides, read
`../_shared/nice-deck/references/feedback.md` and the affected source only.
Edit, build once if needed, preview the changed `slideIds`, inspect those
images yourself, and show the result. No review subagents, full-deck audit,
pre-edit baseline render, review records, or unchanged calculator checks.
Do not run the checklist below for routine feedback.

## Full audit: only when requested

The remaining sections apply to a requested whole-deck review, not every
revision. Keep evidence work and behavioral checks proportional to the change.

Read as needed for the audit:

Read:

- `../_shared/nice-deck/references/foundation.md`
- `../_shared/nice-deck/references/principles.md`
- `../_shared/nice-deck/references/layout.md`
- `../_shared/nice-deck/references/supporting.md`
- `../_shared/nice-deck/references/profile.hansen.md` when working for Eric
  Hansen

Use the shared preview and delivery scripts under
`../_shared/nice-deck/`.

## 1. Establish review scope

Inspect the source deck, assets, `brief.md`, `outline.json`, `sources.json`,
`visual-manifest.json`, and any requested delivery location. Do not assume the
framework, runtime, or intended output format.

Reuse a current render when one exists. For a requested mechanical audit, call
`nice_deck_preview` with `mode: "audit"` once. View the relevant screenshots and
open the exact cache-busted URL in Browser Canvas.

Distinguish:

- mechanical failures that can be corrected directly
- reasoning or evidence gaps that require source work
- visual-system changes that require user co-direction
- intentional choices that should be preserved

## 2. Review the argument

For every slide, verify that the visible composition supplies:

- a clear title and one idea
- evidence that actually supports it
- a linked citation
- a coherent transition from and to adjacent slides

Flag filler, duplication, unsupported specificity, causal overstatement, and
recommendations stronger than the evidence.

Remove printed reasoning and conjecture: decision-relevance lines, caveat
lines, "why this matters" strips, and any sentence stating what another
observation would show or what a number implies about cause or intent. Those
belong to the speaker. Cut visible prose to the shared budget.

## 3. Review the visual system

Judge the whole deck and each slide:

- visual hierarchy and projection-distance readability
- one grid per layout, real `data-region` elements, and boundaries that align
- meaningful use of color and consistent category semantics
- typography, line length, wrapping, clipping, and overflow
- whether graphics explain, orient, or create intentional emotion
- whether every element earns its place
- whether empty space is used confidently rather than filled reflexively
- keyboard navigation, reduced motion, and WCAG AA contrast

Reject generic SaaS cards, repeated gray containers, decorative glass,
gradient text, colored card stripes, tiny tracked kickers, absolutely
positioned content strips, and topic-reflex imagery. Treat horizontal rules in
main-slide content as a presumptive issue: remove routine rules and recover
hierarchy with spacing, alignment, typography, or background change. Keep a
light separator above citations by default, while allowing purposeful
exceptions that carry meaning.

For data slides, verify the sanctioned ECharts SVG renderer, direct labels,
units, takeaway, deterministic capture state, and useful no-hover default.
Explain or remove legends, dashed reference lines, and silent empty regions.

For exact native architecture, topology, trust, sequence, or flow diagrams,
read `../_shared/nice-deck/references/architecture-diagrams.md`. Compare the
rendered topology against the source-backed packet, not just its geometry;
check the containing slide and the standalone/exported artifact. Do not demand
image-generation provenance for authored SVG or assume the scanner verifies
its internal topology.

For conceptual and hybrid slides, verify the generated visual and matching
provenance sidecar. When image text is integrated, compare every rendered string
with the declared `bakedText`, reject extra pseudo-text, and judge the image at
its actual on-slide size. Do not add redundant native labels. Keep citations,
source IDs, URLs, and provenance native and linked.

## 4. Review citations and supporting material

Every visible citation is a link. Verify that:

- public sources link to their canonical HTTPS URL
- internal, derived, and calculated sources link to a supporting slide anchor
  that exists in this deck
- no slide prints a bare source name or an `[S1]` marker
- every `sources.json` entry carries a `url` or a `deckAnchor`

Verify the supporting section is the last part of the same deck, plain black
and white, data only, with no imagery, motion, or art direction. Read
`references/supporting.md`.

## 5. Correct and re-render

Make precise fixes that preserve approved intent. If a fix changes the primary
visual modality, update `brief.md` and `visual-manifest.json` before editing the
slide.

After a batch of fixes, follow the fast feedback loop. Re-review
adjacent slides when the change affects narrative pacing or visual continuity.

The author performs the visual review. Independent reviewers and formal review
records are optional, not presentation or delivery gates. Use
`references/adversarial-review.md` only when the user requests that workflow.

Do not call a redesign complete without paired figure-, text-, and data-heavy
proofs approved through `deck-explore-direction`, and do not restructure the
argument without going back through `deck-outline`.

## 6. Verify delivery readiness

For a requested full audit, inspect the complete deck once for:

- no console, page, asset, navigation, or chart-lifecycle errors
- no clipping, overflow, stale screenshots, or missing fonts
- no layout-audit findings for misaligned regions or broken citation anchors
- exact factual text and source fidelity
- canonical URLs and working links, including in-deck anchors
- coherent narrative and visual grammar
- crisp generated graphics without garbled text
- behavior in the intended viewing surface

When delivery is requested, use the existing package and destination, and open
the changed content there once. Synchronize runtime files only if they changed
or are missing; do not retest every viewing surface. Report unresolved evidence
or design decisions plainly.
