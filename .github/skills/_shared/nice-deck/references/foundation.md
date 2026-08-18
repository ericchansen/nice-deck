# nice-deck shared foundation

These are the non-negotiable rules shared by `deck-create`,
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

## Explanatory contract

Before implementing a slide, declare in `brief.md` and
`visual-manifest.json`:

- question
- supported answer
- visible evidence
- decision relevance
- caveat or uncertainty
- claim status
- source IDs
- talk-track transition
- primary visual modality: `data`, `conceptual`, `hybrid`, or `native`

The visible slide must carry the answer, evidence, relevance, caveat, and
reader-facing citations. Speaker notes may deepen the reasoning but may not
rescue an unexplained slide.

Do not convert timing, correlation, or missing observations into causal event
or launch language. Use evidence-led, collaborative recommendations rather
than customer-facing commands.

## Facts and sources

Every number, name, quote, URL, and command must resolve through `sources.json`
and be recorded in `brief.md`. Mark gaps as unverified and surface them instead
of inventing plausible specifics.

Source IDs such as `[S1]` remain internal to validation data and are not shown
to the audience. Visible citations use concise human-readable source names.
Public sources use canonical HTTPS URLs. Internal extracts remain non-linkable
and use safe human-readable locators. Never expose internal URLs, artifact IDs,
subscription IDs, tokens, or private paths.

### Reader-facing citations

Keep citations minimal and subordinate to the main composition. Use
regular-weight text in a lighter, WCAG-compliant color. Do not bold labels,
source names, or links unless the user explicitly requests emphasis.

Format each field inline as `Label: content`. Prefer one compact citation strip
over a multi-column ledger or grid of labeled blocks. Include only the fields
the slide needs: claim description, readable source names, and an optional
calculation-record link. Material caveats and decision reasoning stay in the
main slide content.

Separate citations from the main slide with either a light one-pixel rule or a
subtle background-color change. Never use a bold horizontal divider. If a
citation wraps, use a hanging continuation that preserves the inline label.

## Visual modalities

Declare the primary modality before implementation:

- `data`: measured or modeled evidence rendered with the sanctioned Apache
  ECharts SVG runtime.
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

Data slides require direct labels, visible units, assumptions, a takeaway,
decision relevance, reader-facing citations, and source IDs in validation
data. Decision-critical facts remain visible without hover. Legends, dashed
reference lines, and empty chart regions must be explained or removed.

For final generated assets, run `scripts/image.py` with `--intended-slide` and
`--visual-role`. Keep its provenance sidecar beside the image.

## Workspace and runtime

Create confidential and dogfood decks outside this public repository unless
the user explicitly requests a committed example.

The normal workspace contains:

```text
brief.md
deck.html
deck.js
sources.json
visual-manifest.json
assets/
directions/
_renders/
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
