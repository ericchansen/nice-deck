---
name: deck-create
description: Turn conversations, notes, documents, source material, or existing slides into a polished graphical web-native presentation. Use when the user asks to create, build, draft, finish, or transform material into a deck or presentation.
license: MIT
---

# deck-create

Create a complete, authored presentation from the context the user already
has. Own the work from source intake through narrative, visual direction,
production, review, and delivery.

This is the broad end-to-end workflow. For the content brainstorm alone, use
`deck-outline`. For a request focused only on exploring the visual system, use
`deck-explore-direction`. For an audit or improvement of an already implemented
deck, use `deck-review`.

## Load before working

Read:

- `../_shared/nice-deck/references/foundation.md`
- `../_shared/nice-deck/references/principles.md`
- `../_shared/nice-deck/references/layout.md`
- `../_shared/nice-deck/references/outline.md`
- `../_shared/nice-deck/references/supporting.md`
- `../_shared/nice-deck/references/profile.hansen.md` when working for Eric
  Hansen
- `../_shared/nice-deck/references/brief.template.md`

Use the shared runtime and scripts under `../_shared/nice-deck/`.

## 1. Understand the presentation

Accept whatever context the user supplies: a conversation, rough notes,
documents, URLs, source extracts, screenshots, an existing deck, or a partial
slide list.

Inspect the material before asking questions. Gather only consequential gaps:

- audience and physical setting
- argument or desired outcome
- desired audience reaction
- required ideas and source material
- verified facts and unresolved claims
- duration and delivery constraints
- brand or accessibility constraints
- optional visual references the user already trusts

Ask one focused question at a time. Do not ask the user to choose fonts,
colors, layouts, or chart styles. Bring rendered proposals for those choices.

Create `brief.md` from the shared template and create `sources.json`. Treat a
provided slide list as intent, not immutable prose. When adapting an existing
deck, preserve its titles, structure, and visual framing unless the user asks
for a redesign.

## 2. Agree the content

Run the complete `deck-outline` workflow before any design work.

Inventory the data first. Find how it was actually retrieved and record what it
can answer — range, finest grain, dimensions, scope, and what is missing — in
`outline.json` under `available`. Report that inventory to the user before
writing frames; it routinely contains more than a previous deck used.

Then produce the frames, generate the plain slides, render them, and iterate
with the user until the argument, order, and evidence are right. Lead with data,
use the finest grain the source provides, keep one idea per frame, and cut
rather than improve a weak frame.

Record supporting frames for every internal source that a main frame will cite.

Do not proceed until `outline.json` records `status: "approved"` and the outline
gate in `brief.md` is filled in. `npm run validate:outline` must pass.

## 3. Shape the proof set

From the approved frames, choose a representative proof set:

- a figure-heavy slide that tests image language and authoritative overlays
- a text-heavy slide that tests hierarchy, measure, density, and citations
- a data-heavy slide that tests chart grammar, direct labels, and annotation
- one additional data-heavy slide for every other chart archetype intended for
  the final deck

A title slide is not automatically representative. Supporting slides are never
proof content.

## 4. Establish the visual system

Follow the complete `deck-explore-direction` workflow. Every representative
content contract remains identical across every treatment.

Render three materially different directions by default, containing the full
proof set, using typography and data only. Produce up to six when the user asks
for a wider comparison. If the user supplied a trusted reference, still produce
multiple real treatments unless the user explicitly chooses to apply that
reference directly.

Do not propagate a direction until the user has reacted to every treatment,
approved every proof role, and selected one direction or explicitly combined
named parts.

Record the approved system in `brief.md`:

- physical viewing scene and three voice words
- palette mechanics and color semantics
- typography and hierarchy across all proof roles
- composition rules and the slide grid
- graphic medium and reusable image-prompt recipe
- chart grammar
- motion behavior
- anti-references

## 5. Produce the deck

Create `visual-manifest.json` before implementing slides. Extend the approved
grammar in small batches of one or a few slides. Consistency of voice matters
more than identical layouts.

Build the main slides first, then the supporting section at the end of the same
file, following `references/supporting.md`. Link every citation: public sources
to their canonical HTTPS URL, internal and derived sources to their supporting
slide anchor.

Use graphics to carry meaning rather than adding prose to compensate for a weak
visual. Generate imagery only for slides whose approved frame declares a
conceptual or hybrid modality, and only after the direction is approved.
Self-contained generated infographics may integrate concise explanatory text.
Declare their image-text mode and exact baked strings before generation, then
proofread the final pixels. Do not repeat integrated strings as native labels.
Keep citations, source IDs, URLs, and provenance native and linked.

Make every visible element earn its place. Do not fill open space reflexively:
one meaningful image, value, phrase, or chart may carry an otherwise blank slide
when it completes the thought and preserves required sourcing.

Print no decision-relevance lines, no caveat lines, and no conjecture. Keep
visible prose under the shared budget.

After each batch, follow the shared rendered-truth loop and collect a reaction.
Do not continue from an unresolved representative system merely to make the
remaining deck acceptable.

Resource-directory slides may be denser than speaking slides, but every entry
keeps its useful description and written canonical URL.

## 6. Finish and deliver

Use the `deck-review` standard on the complete deck. Inspect every rendered
slide for:

- coherent argument and transitions
- a clear title, real evidence, and a linked citation on every slide
- source fidelity and appropriately scoped claims
- purposeful graphics and readable chart annotations
- aligned region boundaries and a single grid per layout
- projection-scale hierarchy, contrast, overflow, and reduced motion
- a plain, data-only supporting section whose anchors all resolve
- asset, console, navigation, and chart-readiness failures

Run the adversarial-review workflow from
`references/adversarial-review.md`. Draft preview remains available, but do not
present or deliver the deck until `npm run validate:review -- <workspace>`
reports a current approved review bound to the exact screenshot and generated
asset hashes.

Synchronize the pinned runtime and follow the shared delivery contract. The
task is complete only when the artifacts in their final location visibly match
the approved deck.
