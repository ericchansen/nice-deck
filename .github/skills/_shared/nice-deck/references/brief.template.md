# Deck brief

## Outcome

- Audience:
- Setting:
- Speaker:
- Desired reaction:
- What should change after the talk:

## Source material

- Notes, documents, or existing deck:
- Brand assets:
- Required ideas:
- Ideas that may be reshaped:

## Facts and sources

| Claim, number, name, URL, command, or quote | Source | Status |
|---|---|---|
| | | unverified |

Never place an unverified claim on a finished slide without showing the user.

## Outline gate

The content brainstorm comes first. Record it here after `outline.json` is
approved.

- Outline status: `draft`, `revise`, or `approved`
- Approved on:
- Frame count:
- Main frames / supporting frames:
- Evidence still outstanding:
- Frames cut, and why:

Direction work does not begin before this gate is `approved`.

## Constraints

- Duration:
- Slide count, if fixed:
- Accessibility:
- Confidentiality:
- Output path:
- Existing destination convention:
- Delivery formats:

Direct-file contract: the master HTML, runtime, fonts, scripts, styles, and
assets use relative local paths and must render from `file://` without a
preview-only route. Sync the workspace runtime from the pinned canonical
manifest before capture or portable export; missing runtime files must show a
visible failure state.

## Narrative map

The visible slide carries the title, the evidence, and its linked citation.
Question, answer, claim status, source IDs, transition, decision relevance, and
caveat are authoring and speaker fields; they are not printed on the slide.

| Slide | Question | Supported answer | Visible evidence | Claim status | Source IDs | Transition | Visual role and modality | Speaker-only relevance and caveat |
|---|---|---|---|---|---|---|---|---|
| | | | | unverified | | | | |

## Slide visual specifications

For every slide record:

- Slide identifier:
- Section: `main` or `supporting`
- Primary visual modality: `data`, `conceptual`, `hybrid`, or `native`
- Renderer or generated asset:
- Source data and transformation:
- Chart type and visible takeaway:
- Citation link targets: public URL or supporting-slide anchor
- Allowed interactions:
- Deterministic capture state:
- Generated-image prompt and intended composition:
- Generated-image text mode: `none` or `integrated`
- Exact baked text and whether extra text is forbidden:
- Accessible description for generated-image text:
- Asset provenance:
- Adversarial review path and status:
- Static-export fallback:
- Accessibility summary:

## Sources

Create `sources.json` with a stable source ID, title, publisher or owner,
retrieval/extraction date, source type, confidentiality classification, and a
link target.

Every source resolves to exactly one link target:

- `public-url` sources require a canonical HTTPS `url`.
- Every other type requires a `deckAnchor` naming the supporting slide that
  shows the extract, query, method, or calculation.

Internal locators stay in `sources.json`. They never appear on a slide.

## Supporting section

Supporting slides are the plain black-and-white evidence appendix at the end of
the same deck file. Read `references/supporting.md`.

| Supporting slide id | What it shows | Main slides that cite it |
|---|---|---|
| | | |

## Frozen direction-probe content

The same content appears in every direction. Styling may change; wording,
values, evidence, claim status, source IDs, and modality may not.

Choose probe content from approved outline frames.

Include one data-heavy proof for every chart archetype intended for the final
deck. Name additional roles `data-heavy-<chart-purpose>` and keep the chart
geometry and data identical across directions.

| Probe role | Slide | Content ID | Why it stresses the system | Primary modality |
|---|---|---|---|---|
| Figure-heavy | | | Tests image language, atmosphere, composition, and authoritative overlays. | |
| Text-heavy | | | Tests hierarchy, measure, density, pacing, and citation treatment. | |
| Data-heavy | | | Tests chart grammar, direct labels, units, and readability. | data |

## Directions considered

Record the directions in `directions/visual-direction-matrix.json`. Three is the
default; produce more only when the user asks.

Probes are typography and data. No imagery is generated for a direction unless
the user has explicitly approved imagery exploration, recorded in the matrix.

| Direction | Physical scene and medium | Type system | What it tests | User reaction |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

For each type system record its display and text families, weights, scale,
heading and body measure, casing, rhythm, specimen source, and local font assets
with license and public source URL. Read
`references/typography-directions.md` for contrast seeds and requirements.

## Direction feedback gate

- Review status: `pending`, `revise`, `approved`, or `combine`
- Reaction to direction 1:
- Reaction to direction 2:
- Reaction to direction 3:
- Selected direction IDs:
- Approved proof roles: figure-heavy, text-heavy, data-heavy
- Combination instructions, if any:

## Selected art direction

- Three concrete voice words:
- Physical scene:
- Color strategy:
- Color semantics:
- Typography:
- Composition and grid: one grid per layout, regions as real elements,
  horizontal rules avoided by default, purposeful exceptions recorded and
  placed on grid lines, shared column tracks across stacked bands
- Citation treatment: linked, inline `Label: content` fields with
  regular-weight, lighter text; light hairline or subtle tonal-background
  separation
- Graphic medium:
- Motion:
- Image-prompt recipe:
- Anti-references:

## Decisions and reactions

-
