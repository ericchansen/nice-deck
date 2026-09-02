---
name: deck-explore-direction
description: Explore and obtain approval for a presentation's visual direction by rendering multiple coherent treatments of the same representative figure-heavy, text-heavy, and data-heavy slides. Use when the user asks to explore styles, art-direct, choose a look, compare visual directions, create design options, or establish a deck system. Requires an approved outline from deck-outline first.
license: MIT
---

# deck-explore-direction

Develop the visual world of a deck through comparable rendered evidence. This
skill ends with an approved or explicitly combined proof system; it does
not propagate that system through the full deck.

It is the second brainstorm. The first is `deck-outline`, which agrees the
content. Do not start here until `outline.json` records `status: "approved"`.

## Load before working

Read:

- `../_shared/nice-deck/references/foundation.md`
- `../_shared/nice-deck/references/principles.md`
- `../_shared/nice-deck/references/layout.md`
- `../_shared/nice-deck/references/typography-directions.md`
- `../_shared/nice-deck/references/profile.hansen.md` when working for Eric
  Hansen
- `../_shared/nice-deck/references/visual-direction-matrix.template.json`

Use the shared runtime and scripts under `../_shared/nice-deck/`.

## 1. Freeze comparable proof content

Confirm the outline is approved. Choose proof content from approved frames; do
not invent new content here. Ask whether the user has visual references they
already trust, but do not require them and do not ask the user to design the
system.

Freeze one figure-heavy, one text-heavy, and at least one data-heavy content
contract. Each contract includes the authoring contract and primary modality
from the shared foundation.

Use one data-heavy proof per chart archetype intended for the final deck. If the
deck will use multiple chart forms, add roles named
`data-heavy-<chart-purpose>` and include every role in every direction. Do not
change chart form inside one frozen proof and call it styling.

The wording, values, evidence, claim status, source IDs, and modality remain
identical across every direction. The user must compare visual systems rather
than changing content.

## 2. Author the direction matrix

Create three treatments by default. With one chart archetype, each treatment
has three slides for nine rendered proofs. Each additional intended chart
archetype adds one frozen data-heavy proof to every treatment. Produce up to
six treatments when the user asks for a wider comparison.

Probes are typography and data. Do not generate imagery to explore a direction:
it is slow, it buys a look before the argument is settled, and it makes the
comparison about one lucky picture. If the user explicitly wants image-led
directions, record `"imageryApproved": true` in the matrix first.

Create `directions/visual-direction-matrix.json` from the shared template
before implementing any treatment. For every direction declare:

- a one-sentence physical scene
- three concrete voice words
- color strategy and semantics
- a distinct type system
- composition, grid, and information hierarchy
- graphic medium
- chart grammar
- motion behavior
- the specific generic-AI risk it avoids
- each proof slide's primary modality

Directions must differ in medium, composition, hierarchy, and typography—not
merely palette. Reject both the topic-literal reflex and its obvious
second-order alternative.

Each type system must materially differ in display and text families, weight
contrast, scale, heading and body measure, casing, and rhythm. Package fonts
locally and record their licenses and public source URLs.

Run:

```powershell
npm run validate:directions -- <workspace>
```

Do not implement a treatment until its matrix and treatment manifest agree on
every modality.

## 3. Build real paired treatments

Each treatment is self-contained:

```text
brief.md
treatment.html
slide-contracts.json
visual-manifest.json
sources.json
assets/
runtime/
```

Use the sanctioned ECharts SVG runtime for measured or modeled data. Keep
authoritative overlays native.

Every treatment follows the shared slide-structure rule: one grid per layout,
regions as real `data-region` elements, horizontal rules avoided by default,
purposeful boundaries on grid lines, and no absolutely positioned content
strips. A light separator above citations is the standard horizontal rule;
other uses must carry meaning.

Mark visible question, answer, and evidence with `data-contract-field`. Add
`data-claim-status`, `data-source-ids`, and `data-type-system-id`. Mark
representative display and text elements with `data-type-role`.

Do not print decision-relevance or caveat lines, and do not write conjecture.

## 4. Render and inspect all proofs

Run `nice_deck_preview` for every treatment. Record each source hash, preview
record, role-specific screenshot path, and screenshot SHA-256 in the matrix.

View all screenshots. Judge each complete proof system as a unit and fix:

- contrast, clipping, overflow, and projection-scale readability
- weak hierarchy or unresolved empty space
- misaligned region boundaries reported by the layout audit
- generic or decorative graphics
- typographic collisions and improperly loaded local fonts
- chart failures, legends, units, labels, and silent regions
- missing evidence or unlinked citations

Record completed visual-inspection roles and hashes, then run:

```powershell
npm run validate:directions -- <workspace> --review
```

Refresh Browser Canvas to each exact cache-busted treatment URL. Present every
direction together with all proof roles aligned.

## 5. Obtain direction approval

Collect a reaction to every direction. Ask whether to select one, combine
named parts, or revise. Do not defend an unsuccessful visual.

Stop propagation until all proof roles are approved. Record reactions,
selected direction IDs, and combination instructions in both `brief.md` and
the direction matrix.

Run:

```powershell
npm run validate:directions -- <workspace> --approved
```

An approval-validation failure blocks handoff. Return an approved representative
system and its recorded rules, not an unchosen gallery of options.
