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

## Load before working

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

Render the current deck before diagnosing it. View every exact screenshot and
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
- whether empty space completes rather than avoids the thought
- keyboard navigation, reduced motion, and WCAG AA contrast

Reject generic SaaS cards, repeated gray containers, decorative glass,
gradient text, colored card stripes, tiny tracked kickers, absolutely
positioned content strips, and topic-reflex imagery.

For data slides, verify the sanctioned ECharts SVG renderer, direct labels,
units, takeaway, deterministic capture state, and useful no-hover default.
Explain or remove legends, dashed reference lines, and silent empty regions.

For conceptual and hybrid slides, verify the generated visual and matching
provenance sidecar. Keep authoritative content native.

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

After every slide change, follow the shared rendered-truth loop. Re-review
adjacent slides when the change affects narrative pacing or visual continuity.

Do not call a redesign complete without paired figure-, text-, and data-heavy
proofs approved through `deck-explore-direction`, and do not restructure the
argument without going back through `deck-outline`.

## 6. Verify delivery readiness

Inspect the final complete deck and confirm:

- no console, page, asset, navigation, or chart-lifecycle errors
- no clipping, overflow, stale screenshots, or missing fonts
- no layout-audit findings for misaligned regions or broken citation anchors
- exact factual text and source fidelity
- canonical URLs and working links, including in-deck anchors
- coherent narrative and visual grammar
- crisp generated graphics without garbled text
- direct-file, static-server, and sanctioned-preview behavior

When delivery is requested, synchronize the pinned runtime and follow the
shared packaging and PDF contract. Report unresolved evidence or design
decisions plainly rather than producing a success-shaped fallback.
