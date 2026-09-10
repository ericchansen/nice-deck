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
- `../_shared/nice-deck/references/adversarial-review.md`
- `../_shared/nice-deck/references/profile.hansen.md` when working for Eric
  Hansen

Use the shared preview and delivery scripts under
`../_shared/nice-deck/`.

## Live source and wording edits

When the user wants to change text directly on an existing HTML slide, use
`nice_deck_edit` to open the local source-preserving editor in Browser Canvas.
If the repo-local tool is unavailable, run `npm run edit -- <HTML>` from the
shared toolkit and open its printed local URL.
Use a separate copy for experiments. The tool's launch URL authorizes writes;
open it in Canvas but do not share or persist the token.

The editor has exactly three primary regions: content left, editable visible
slide HTML right, and a compact toolbar with status and secondary disclosures.
Pure HTML text edits inline, including table cells, prices, scope notes, citation
labels and supporting slides. Edit mixed-format fragments, SVG labels, markup
and attributes in the source pane; there is no separate text-editing panel.
Source drafts validate after a short pause and update the preview without saving.
Invalid syntax retains the last good preview. Navigation retains drafts and
history. Keep the single slide boundary, container tag, id and data-slide-id;
close non-void HTML elements explicitly. Duplicate IDs and locked-source changes
are rejected. All source bytes outside the bounded patches remain untouched;
source-edited slides use textarea-normalized LF line endings.
Unchanged runtime nodes/calculators remain live. Changed scripts, handlers and
embedded application elements are inactive in drafts: save and reopen the saved
HTML to test them. Image-baked text and generated data still require their
authoring sources. Changing visible wording or prices does not update evidence
or calculator data.
Explicit Save updates bounded text or whole-slide source ranges, never live DOM,
and requests a canonical render, not
presentation approval. Preserve unsaved work on conflicts. After a save, inspect
the exact fresh screenshots, reconcile the source records, and apply the normal
review gate. Standalone imports without authoring metadata remain drafts.

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

After every slide change, follow the shared rendered-truth loop. Re-review
adjacent slides when the change affects narrative pacing or visual continuity.

Run four independent screenshot-first adversarial roles: cold read, art
direction, image-text proof, and geometry/citations. Record findings against the
exact source, screenshot, and generated-asset hashes. Drafts may render before
approval; presentation and delivery may not.

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
- a current approved adversarial review
- direct-file, static-server, and sanctioned-preview behavior

When delivery is requested, synchronize the pinned runtime and follow the
shared packaging and PDF contract. Report unresolved evidence or design
decisions plainly rather than producing a success-shaped fallback.
