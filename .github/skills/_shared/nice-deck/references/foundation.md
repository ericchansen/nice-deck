# nice-deck shared foundation

These are the non-negotiable rules shared by `deck-outline`, `deck-create`,
`deck-explore-direction`, and `deck-review`. The user-facing skill owns the
workflow; this file owns the production contract.

## Product contract

- The HTML deck is the source of truth. PPTX is an optional lossy export.
- Slides support a speaker instead of becoming documents to read aloud.
- The user controls meaning, mood, metaphor, and the final visual world.
- The agent owns implementation quality after the user approves the direction.
- Do not use a fixed theme or template library. Derive the visual grammar from
  the argument, audience, setting, source material, and user reaction.

Read `principles.md` and `layout.md` before working on a deck. Read `profile.hansen.md` when
working for Eric Hansen.

## Order of work

1. **Outline.** Agree the content first, as plain frames. See `outline.md` and
   the `deck-outline` skill. No color, no imagery, no chart, no type system.
2. **Direction.** Explore the visual system only after the outline is approved.
   Three directions by default; typography and data only. Generate no imagery
   until content and direction are both approved. See
   `deck-explore-direction`.
3. **Production.** Build the deck from approved frames in the approved system.

Expand beyond the defaults when the user asks for it. Do not expand by reflex.

## Explanatory contract

Every slide is authored against a contract recorded in `outline.json`,
`brief.md`, and `visual-manifest.json`:

- question
- supported answer
- visible evidence
- claim status
- source IDs
- talk-track transition
- primary visual modality: `data`, `conceptual`, `hybrid`, or `native`
- optional decision relevance and caveat, for the speaker

What the audience sees is much smaller:

- the title
- the evidence itself, with direct labels and visible units
- the linked citation

Decision relevance and caveats are speaker material. Do not print a
decision-relevance line or a caveat line on a slide. Do not add a "why this
matters" strip, a "what would change this" strip, or a reasoning column.

### No conjecture

Slides carry evidence, not interpretation. Do not write what another
observation would show, what a number implies about cause or intent, what the
audience should conclude, or what a measurement cannot rule out. Do not convert
timing, correlation, or missing observations into causal or event language.

Banned on a slide: "cannot distinguish", "would separate", "suggests",
"likely", "may indicate", "could mean", "appears to", "we expect". A factual
scope statement is not conjecture: "Jul 1-31 2026" and "billions of tokens"
belong on the slide.

The speaker interprets. The slide shows.

### Less text

Keep visible prose under 40 words per slide, outside the title, direct labels,
values, and the citation line. If an idea needs more, it is either a chart, a
supporting slide, or two slides.

## Facts and sources

Every number, name, quote, URL, and command must resolve through `sources.json`
and be recorded in `brief.md`. Mark gaps as unverified and surface them instead
of inventing plausible specifics.

Source IDs such as `S1` are authoring identifiers. They never appear on a
slide. Never expose internal URLs, artifact IDs, subscription IDs, tokens, or
private paths.

### Reader-facing citations

Every visible citation is a link. There are exactly two kinds:

- A public source links to its canonical HTTPS URL.
- An internal, derived, or calculated source links to the in-deck supporting
  slide that shows the extract, query, method, or calculation, using its `#id`
  anchor.

There is no third kind. A source name printed as plain text is a failure, and
so is a `[S1]` marker on a slide. Every `sources.json` entry therefore carries
either a public `url` or a `deckAnchor` naming a supporting slide.

Keep citations minimal and subordinate. Use regular-weight text in a lighter,
WCAG-compliant color. Do not bold labels, source names, or links unless the
user explicitly requests emphasis. Format each field inline as
`Label: content`, and prefer one compact strip over a grid of labeled blocks.

Main-slide content avoids horizontal rules by default. Use spacing, alignment,
typography, or background change to establish hierarchy. The standard horizontal
rule is a light one-pixel separator above the citation area; a subtle citation
background may replace it. A purposeful exception must carry meaning. If a
citation wraps, use a hanging continuation that preserves the inline label.

## Slide structure

A slide is a fixed box with hidden overflow, so layout is a constraint problem,
not a flow problem. Read `layout.md`; it is the authority on slide geometry.

The rules that the explanatory contract depends on:

- Each slide layout declares exactly one grid, and every visible region is a
  real element, a direct child of that grid, carrying `data-region`.
- Avoid dividers. When a necessary boundary cannot be carried by spacing,
  alignment, typography, or background change, it is a border on a grid child.
  A rule that implies alignment must be produced by a shared grid line.
- Do not position content regions absolutely inside a slide. An absolutely
  positioned strip cannot align with the grid above it, and will not stay
  aligned across viewports. Visually hidden helpers and `data-bleed`
  backgrounds are the only exceptions.
- Sibling bands share column tracks. Two stacked bands with different
  `grid-template-columns` produce boundaries that almost line up, which reads as
  a defect. Declare a deliberate exception with `data-grid-exception` when a
  band genuinely needs its own tracks.

Preview measures rendered region edges and reports boundaries that are close
but unequal. Fix the grid; do not nudge the offset.

## Supporting section

Supporting slides are the plain black-and-white evidence appendix at the end of
the same deck file. They are the link target for every internal citation. Read
`supporting.md` before authoring them.

They are exempt from the deck's art direction and are never used as direction
proof content.

## Visual modalities

Declare the primary modality before implementation:

- `data`: measured or modeled evidence rendered with the sanctioned Apache
  ECharts SVG runtime. This is the default for evidence.
- `conceptual`: a generated visual metaphor or explanatory image with valid
  provenance.
- `hybrid`: a generated or chart-rendered visual foundation with authoritative
  native overlays.
- `native`: exact text, a table, a formula, a simple separator, or an
  accessibility fallback. Do not use it to avoid generating the primary visual.

Never build a primary quantitative visual from CSS widths, hand-built SVG bars,
rails, gates, or pseudo-charts. Generated imagery must not contain
authoritative text, values, formulas, logos, URLs, commands, quotes, or
fabricated product interfaces.

Generate no imagery before the outline and the direction are approved. A
`conceptual` slide must justify itself in one sentence against a `data` or
`native` alternative.

Data slides require direct labels, visible units, a takeaway, and a linked
citation. Decision-critical facts remain visible without hover. Legends, dashed
reference lines, and empty chart regions must be explained or removed.

For final generated assets, run `scripts/image.py` with `--intended-slide` and
`--visual-role`. Keep its provenance sidecar beside the image.

## Workspace and runtime

Create confidential and dogfood decks outside this public repository unless
the user explicitly requests a committed example.

The normal workspace contains:

```text
brief.md
outline.json
outline.html
deck.html
deck.js
sources.json
visual-manifest.json
assets/
directions/
_renders/
```

`outline.html` is generated. Never hand-edit or style it:

```powershell
npm run outline -- <workspace>
```

Copy `runtime/deck.js` into the workspace. Synchronize chart files with:

```powershell
npm run sync-runtime -- <workspace>
```

The master HTML, runtime, fonts, scripts, styles, and assets use relative local
paths and must open directly from `file://`. Missing runtime files produce a
visible failure state. Preview-only routes are not part of the delivery
contract.

## Rendered truth

After every slide edit:

1. Run `nice_deck_preview` on the changed deck or treatment.
2. View every exact returned screenshot with an image-capable tool.
3. Fix visual and mechanical failures.
4. Refresh Browser Canvas to the exact cache-busted URL.
5. Only then present the work or request feedback.

A clean scanner result is not visual inspection. Never report completion from
code inspection alone.

Every deck must preserve keyboard navigation, reduced-motion behavior,
projection-scale type, WCAG AA contrast, selectable authoritative text, and
content that does not clip or overflow.

## Delivery

Inspect the user's existing presentation directory before choosing names or
locations. Keep the source HTML, local assets, and requested exports together.

For an email-safe PDF:

```powershell
npm run export:pdf -- <deck.html> [deck.pdf]
```

Read the packaged HTML from its final location. Test the direct file, an
ordinary static server, and sanctioned preview without capture mode. Inspect
every PDF page, verify external links, and remove duplicate session copies.
