---
name: nice-deck
description: Build graphical, web-native presentation decks from rough notes through collaborative art direction, original AI graphics, and visually inspected Playwright previews. Use for decks, slides, presentations, slide prototypes, or reskinning an existing deck.
license: MIT
---

# nice-deck

Turn a loose presentation brief into an authored web-native deck. The user
directs meaning, mood, metaphor, and the final visual world. The agent shapes
the story, brings strong visual proposals, creates the graphics, implements the
slides, and owns production quality.

This is not a template picker. Do not choose a theme from a library. Discover a
visual grammar from the actual content and the user's reaction to rendered work.

The website is the product. PPTX is an optional lossy export and never drives a
design decision.

## Load before building

Read:

- `references/principles.md`
- `references/typography-directions.md`
- `references/profile.hansen.md` when working for Eric Hansen
- `references/brief.template.md` before creating a deck workspace

Use `scripts/image.py` for generated graphics and `nice_deck_preview` for every
visual checkpoint. If the extension tool is unavailable, run
`npm run preview -- <deck.html>` from this skill directory.

## Workspace

Create the deck outside the nice-deck repository unless the user explicitly
wants an example committed here:

```text
brief.md
deck.html
deck.js
visual-manifest.json
assets/
directions/
  visual-direction-matrix.json
_renders/
```

Copy `runtime/deck.js` to the workspace as `deck.js`. It supplies navigation,
not aesthetics. Each deck owns its HTML and CSS.

Never put confidential source material or dogfood decks in this public repo.

## Process

### 1. Understand the talk

Gather only what is missing:

- audience and physical setting
- argument or outcome
- desired audience reaction
- rough slide ideas or source material
- verified facts and claims
- constraints such as duration, brand assets, accessibility, and output path
- the existing destination structure and required delivery formats
- optional visual references the user already trusts

Ask one focused question at a time. Do not ask the user to choose fonts, colors,
or layouts. Those are proposals the agent should show.

Create `brief.md` from `references/brief.template.md`. Treat the user's slide
list as intent, not immutable prose. Propose narrative changes and get agreement
before silently adding, dropping, or reordering ideas.

### 2. Map the narrative

Write a concise slide map. For each slide, state its job in the argument and the
one idea the audience should retain.

Also record the explanatory contract for every slide:

- question
- supported answer
- visible evidence
- decision relevance
- caveat or uncertainty
- claim status
- source IDs
- talk-track transition

Data slides must state why the evidence changes the decision. Do not turn
timing, correlation, or absence in an extract into a causal event or launch
claim. Speaker notes may add depth but may not introduce the reasoning required
to understand the slide.

Choose three representative slides for art-direction discovery:

- one figure-heavy slide that tests image language, atmosphere, composition,
  and authoritative overlays;
- one text-heavy slide that tests hierarchy, measure, density, pacing, and
  citation treatment;
- one data-heavy slide that tests chart grammar, annotation, sourcing,
  interaction, assumptions, and decision relevance.

A title slide is not automatically representative. Freeze the content contract
for all three probes before styling: wording, values, evidence, decision
relevance, caveat, claim status, source IDs, and primary modality remain
identical across every direction.

### 3. Render art-direction probes

Create exactly six three-slide treatments under `directions/`, for 18 rendered
slides total. Each treatment applies one coherent visual direction to the same
frozen figure-heavy, text-heavy, and data-heavy content. The user must be
comparing visual systems rather than copy, evidence, or chart values.

Create `directions/visual-direction-matrix.json` before implementing the
treatments. It declares the frozen content contracts, all six directions, their
type systems, treatment paths, render hashes, screenshot paths, and feedback.
Start from `references/visual-direction-matrix.template.json`, replacing its
placeholders and changing its typography seeds when the brief supports a
stronger set.
Run:

```powershell
npm run validate:directions -- <workspace>
```

before implementing the treatments. Do not implement a probe until its primary
visual modality is declared both in the matrix and in that treatment's
`visual-manifest.json`.

Each treatment lives in its own self-contained directory with `brief.md`,
`treatment.html`, `slide-contracts.json`, `visual-manifest.json`,
`sources.json`, local runtime, local fonts, generated assets, and provenance.
The treatment-local slide contracts repeat the frozen matrix fields exactly;
review validation rejects any rewritten question, answer, evidence, relevance,
caveat, claim status, source IDs, or modality. The preview server intentionally
refuses arbitrary workspace files and blocks network requests, so download
fonts and images into the treatment instead of depending on remote URLs. Mark
the visible question, answer, evidence, decision relevance, and caveat with
`data-contract-field`; put claim status and source IDs on the slide as
`data-claim-status` and `data-source-ids`. Review validation compares the
rendered DOM to the frozen matrix.

The treatments must differ in medium and composition, not merely palette.
Derive each from the brief. Reject topic reflexes and their obvious
second-order alternatives.

Each treatment also uses a distinct typographic system across its three slides.
The six systems must materially differ in display and text families, weight
contrast, scale, heading and body measure, casing, and rhythm. Changing only
font family, color, tracking, or one headline face is not a new direction.
Use `references/typography-directions.md` and its Beautiful Web Type specimens
as references when the brief does not provide stronger typographic objects.
Package every font locally and record its license and public source URL.
Declare the direction on the treatment with `data-type-system-id`. On every
probe slide, mark one representative heading with `data-type-role="display"`
and one representative reading or annotation element with
`data-type-role="text"`. Review validation opens the treatment and confirms all
three slides actually render the declared families and weights from local
`@font-face` sources. Network font requests are blocked during validation.

For each direction decide:

- a one-sentence physical scene
- three concrete voice words
- color strategy
- type system: families, weights, scale, measure, casing, rhythm, and specimen
- composition and information hierarchy
- graphic medium
- motion behavior
- the specific AI-slop risk it avoids
- primary visual modality: `data`, `conceptual`, `hybrid`, or `native`

When generated imagery is part of a direction, generate a real draft graphic
for the probe. Do not use a placeholder and ask the user to imagine it.

Use the sanctioned Apache ECharts runtime with the SVG renderer for measured or
modeled data. Do not build primary quantitative visuals from CSS widths, native
SVG bars, or decorative rails. Use generated raster graphics as the starting
point for conceptual diagrams and visual metaphors. Never ask an image model to
render authoritative text, values, formulas, logos, product UI, URLs, commands,
or quotes.

Native HTML/SVG is for exact overlays, simple separators, tables, formulas, and
accessibility fallbacks. Hybrid composition is normal: an ECharts or generated
visual foundation plus precise native labels and decision text.

### 4. Inspect before showing

Run `nice_deck_preview` on all six treatments. It produces six source hashes,
18 screenshots, and six exact cache-busted URLs. Record the hashes and
role-specific screenshot paths and SHA-256 hashes, preview record paths, and
completed visual inspection roles and screenshot hashes in
`visual-direction-matrix.json`, then run:

```powershell
npm run validate:directions -- <workspace> --review
```

Then:

1. View all 18 screenshots with an image-capable tool.
2. Judge each three-slide system against `references/principles.md`.
3. Fix contrast, overflow, weak hierarchy, generic graphics, chart failures,
   typesetting collisions, and obvious slop.
4. Open or refresh Browser Canvas to each exact treatment URL.
5. Present a six-column by three-role comparison: figure-heavy, text-heavy, and
   data-heavy remain aligned so differences are immediately legible.
6. Ask for a reaction to every direction and whether to select one, combine
   named parts, or revise.

Do not return from a slide edit without a fresh inspected render and something
new in Canvas. A clean scanner result is not visual inspection.

Stop propagation until the user approves all three proof roles and selects one
direction or explicitly combines named directions. Record a reaction for all
six directions in both `brief.md` and `visual-direction-matrix.json`. Then run:

```powershell
npm run validate:directions -- <workspace> --approved
```

An approval validation failure blocks propagation.

### 5. Commit the direction

Record the selected or combined direction and the user's reaction in `brief.md`,
including:

- palette mechanics rather than just color values
- typography and hierarchy across figure, text, and data roles
- composition rules
- visual medium and reusable image-prompt recipe
- motion behavior
- what to avoid

Refine the representative three-slide system until the user wants the deck to
continue.
Do not build the remaining slides while the visual language is unresolved.

### 6. Build in small batches

Extend the approved grammar to one or a few slides at a time. Consistency of
voice matters more than identical layouts. Each slide should have one dominant
idea and use graphics to carry meaning rather than adding explanatory prose.

After each batch, preview, inspect, refresh Canvas, and collect a reaction.

Resource directories are the deliberate exception to minimal speaking-slide
density. Keep each entry's useful description and written canonical URL, and
make every category visually consistent with the others.

### 7. Final verification

Preview the complete deck and inspect every slide. Confirm:

- no console, page, asset, or navigation errors
- no clipping or overflow
- WCAG AA contrast
- readable projection-scale type
- reduced-motion behavior
- exact factual text and source fidelity
- canonical URLs, working links, and no unnecessary trailing slashes
- coherent narrative and visual grammar
- generated graphics are crisp, purposeful, and free of garbled text

Never report completion from code inspection alone.

## Generated graphics

Use `scripts/image.py`:

```powershell
python scripts/image.py --prompt-file direction.txt --out assets/direction.png --quality medium
```

Use draft quality for art-direction probes and high quality after selection.
Build prompts from the approved scene, medium, composition, palette mechanics,
and negative constraints. Preserve the chosen recipe across the deck without
forcing every slide into the same composition.

Pass `--intended-slide` and `--visual-role` for every final asset. `image.py`
writes a provenance sidecar containing the prompt, model, generation settings,
timestamp, and output hash. Keep the sidecar beside the image.

The generator is env-driven; see the repository `.env.example`.

## Facts

Every number, name, quote, URL, and command must be sourced in `brief.md`.
Mark gaps as unverified and surface them. Never invent plausible specifics.

### Reader-facing citations

Keep the citation treatment minimal and subordinate to the main composition.
Use regular-weight text in a lighter, WCAG-compliant color. Do not bold citation
labels, source names, or links unless the user explicitly requests emphasis.

Format each field inline as `Label: content`, not as a label on one line followed
by content on the next. Prefer one compact citation strip over a multi-column
ledger or a grid of labeled blocks. Include only the fields the slide needs:
claim description, readable source names, and an optional calculation-record
link. Material caveats and decision reasoning stay in the main slide content.

Separate the citation area from the main slide with either a light one-pixel
rule or a subtle background-color change. Both are valid art-direction choices.
Never use a bold horizontal divider. If a citation wraps, use a hanging
continuation that preserves the inline label.

## Visual manifest

Every deck workspace includes `visual-manifest.json`. Each slide records its
identifier, primary modality, renderer or generated asset, source or provenance,
capture-state requirements, and accessibility summary. A missing or conflicting
declaration blocks preview.

Each manifest slide also records `question`, `answer`, `decisionRelevance`,
`claimStatus`, and `sourceIds`. Every source ID resolves through `sources.json`.
Source IDs such as `[S1]` remain internal to validation data and are not shown to
the audience. Visible citations use concise human-readable source names, with
public URLs clickable and non-linkable internal extracts described by safe
human-readable locators. Never expose internal URLs, artifact IDs, subscription
IDs, tokens, or private paths.

For `data` slides, include an ECharts selector and source summary. For
`conceptual` and `hybrid` slides, include the generated asset and matching
provenance sidecar. A `native` slide is appropriate only when its primary visual
is exact text, a table, a formula, or a simple accessibility fallback.

Charts must use the hash-verified workspace `runtime/echarts.min.js` and
`runtime/charts.js` files synced from the pinned canonical runtime. The master
HTML must open directly from `file://`; `/__nice-deck/` is a retired
preview-only path. Capture mode disables animation, resets interaction state,
waits for readiness, and fails on timeout. Decision-critical facts must remain
visible without hover.

The master HTML is the direct-file source of truth. Run `npm run sync-runtime --
<workspace>` before delivery; the helper verifies SHA-256 values against
`runtime/chart-runtime.manifest.json` and copies only sanctioned runtime files.
For delivery outside the preview extension, build a portable package by copying
that direct-file-ready source and its local runtime without path rewriting. Test
`file://`, an ordinary static server, and the sanctioned preview without capture
mode. Missing runtime scripts must produce a visible error state, never a
silent empty chart.

## Delivery

The HTML remains the source of truth. Before packaging, inspect the user's
existing presentation directory and follow its naming and organization instead
of inventing a destination.

For an email-safe PDF:

```powershell
npm run export:pdf -- <deck.html> [deck.pdf]
```

The exporter uses the inspected slide renders and adds clickable link regions;
it does not print and reflow the live deck. External web and email links are
preserved; unsupported local and internal links are reported and omitted. Read
the packaged HTML back from its final directory, inspect the PDF pages, verify
the links, and remove duplicate copies created during the session.
