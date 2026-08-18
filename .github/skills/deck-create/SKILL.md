---
name: deck-create
description: Turn conversations, notes, documents, source material, or existing slides into a polished graphical web-native presentation. Use when the user asks to create, build, draft, finish, or transform material into a deck or presentation.
license: MIT
---

# deck-create

Create a complete, authored presentation from the context the user already
has. Own the work from source intake through narrative, visual direction,
production, review, and delivery.

This is the broad end-to-end workflow. For a request focused only on exploring
the visual system, use `deck-explore-direction`. For an audit or improvement of
an already implemented deck, use `deck-review`.

## Load before working

Read:

- `../_shared/nice-deck/references/foundation.md`
- `../_shared/nice-deck/references/principles.md`
- `../_shared/nice-deck/references/layout.md`
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

## 2. Shape the argument

Build a concise narrative map. Each slide has one job and one idea the audience
should retain.

For every slide, freeze the explanatory contract required by the shared
foundation. Delete filler, identify evidence gaps, and propose any material
addition, removal, or reorder before silently changing the user's intended
argument.

Choose a representative proof set:

- a figure-heavy slide that tests image language and authoritative overlays
- a text-heavy slide that tests hierarchy, measure, density, and citations
- a data-heavy slide that tests chart grammar, assumptions, annotation, and
  decision relevance
- one additional data-heavy slide for every other chart archetype intended for
  the final deck

A title slide is not automatically representative.

## 3. Establish the visual system

Follow the complete `deck-explore-direction` workflow. Every representative
content contract remains identical across every treatment.

If the user supplied no trusted visual reference, render exactly six materially
different directions containing the full proof set. If the user supplied a reference, still
produce multiple real paired treatments unless the user explicitly chooses to
apply that reference directly.

Do not propagate a direction until the user has reacted to every treatment,
approved every proof role, and selected one direction
or explicitly combined named parts.

Record the approved system in `brief.md`:

- physical viewing scene and three voice words
- palette mechanics and color semantics
- typography and hierarchy across all proof roles
- composition rules
- graphic medium and reusable image-prompt recipe
- chart grammar
- motion behavior
- anti-references

## 4. Produce the deck

Create `visual-manifest.json` before implementing slides. Extend the approved
grammar in small batches of one or a few slides. Consistency of voice matters
more than identical layouts.

Use graphics to carry meaning rather than adding prose to compensate for a weak
visual. Keep exact technical strings, citations, values, formulas,
recommendations, and links native and selectable.

After each batch, follow the shared rendered-truth loop and collect a reaction.
Do not continue from an unresolved representative system merely to make the
remaining deck acceptable.

Resource-directory slides may be denser than speaking slides, but every entry
keeps its useful description and written canonical URL.

## 5. Finish and deliver

Use the `deck-review` standard on the complete deck. Inspect every rendered
slide for:

- coherent argument and transitions
- visible answer, evidence, relevance, caveat, and reader-facing citations
- source fidelity and appropriately scoped claims
- purposeful graphics and readable chart annotations
- projection-scale hierarchy, contrast, overflow, and reduced motion
- asset, console, navigation, and chart-readiness failures

Synchronize the pinned runtime and follow the shared delivery contract. The
task is complete only when the artifacts in their final location visibly match
the approved deck.
