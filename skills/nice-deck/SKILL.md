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
assets/
directions/
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

Ask one focused question at a time. Do not ask the user to choose fonts, colors,
or layouts. Those are proposals the agent should show.

Create `brief.md` from `references/brief.template.md`. Treat the user's slide
list as intent, not immutable prose. Propose narrative changes and get agreement
before silently adding, dropping, or reordering ideas.

### 2. Map the narrative

Write a concise slide map. For each slide, state its job in the argument and the
one idea the audience should retain.

Choose one representative slide for art-direction discovery. Prefer the slide
that tests the deck's hardest combination of content, graphics, and tone. A
title slide is not automatically representative.

### 3. Render art-direction probes

Create two or three treatments of the same representative slide under
`directions/`. Keep the content constant so the user is comparing visual
direction rather than copy.

Each treatment is a self-contained HTML file. It may load `../deck.js` and
public images or fonts under `../assets/`; inline its treatment-specific CSS and
JavaScript. The preview server intentionally refuses arbitrary workspace files.
It also blocks network requests, so download any required font or image into
`assets/` instead of depending on a remote URL.

The treatments must differ in medium and composition, not merely palette.
Derive each from the brief. Reject topic reflexes and their obvious
second-order alternatives.

For each direction decide:

- a one-sentence physical scene
- three concrete voice words
- color strategy
- typographic object or reference
- composition and information hierarchy
- graphic medium
- motion behavior
- the specific AI-slop risk it avoids

When generated imagery is part of a direction, generate a real draft graphic
for the probe. Do not use a placeholder and ask the user to imagine it.

Use native HTML/SVG for exact information and structural diagrams. Use
generated raster graphics for atmosphere, texture, characters, illustration,
or visual worlds that vector work cannot carry. Never ask an image model to
render a URL, command, long quote, or other exact text.

### 4. Inspect before showing

Run `nice_deck_preview` on every treatment. It produces a source hash,
screenshots, and the exact cache-busted URL.

Then:

1. View every screenshot with an image-capable tool.
2. Judge it against `references/principles.md`.
3. Fix contrast, overflow, weak hierarchy, generic graphics, and obvious slop.
4. Open or refresh the Browser Canvas to the exact URL returned by preview.
5. Present the treatments together and ask for a reaction.

Do not return from a slide edit without a fresh inspected render and something
new in Canvas. A clean scanner result is not visual inspection.

### 5. Commit the direction

Record the selected direction and the user's reaction in `brief.md`, including:

- palette mechanics rather than just color values
- typography and hierarchy
- composition rules
- visual medium and reusable image-prompt recipe
- motion behavior
- what to avoid

Refine the representative slide until the user wants the deck to continue.
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

The generator is env-driven; see the repository `.env.example`.

## Facts

Every number, name, quote, URL, and command must be sourced in `brief.md`.
Mark gaps as unverified and surface them. Never invent plausible specifics.

## Delivery

The HTML remains the source of truth. Before packaging, inspect the user's
existing presentation directory and follow its naming and organization instead
of inventing a destination.

For an email-safe PDF:

```powershell
npm run export:pdf -- <deck.html> [deck.pdf]
```

The exporter uses the inspected slide renders and adds clickable link regions;
it does not print and reflow the live deck. Read the packaged HTML back from its
final directory, inspect the PDF pages, verify the links, and remove duplicate
copies created during the session.
