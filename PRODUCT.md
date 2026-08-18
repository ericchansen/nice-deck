# Product

## Register

product

## Users

People who know the point they want to make but do not want to art-direct,
illustrate, typeset, and implement an entire presentation alone.

They arrive with a loose brief: a handful of slide ideas, rough notes, source
material, or an existing deck. They work in GitHub Copilot and want to react to
visible creative choices rather than specify layouts, write image prompts, or
manage frontend code.

## Product Purpose

nice-deck turns a loose presentation brief into a beautiful, coherent,
web-native deck through a short co-design process.

It starts with content, not with a look. The user first shapes the argument as
plain frames — unstyled slides stating what each one shows and what the speaker
says — and iterates there. Then the AI proposes art directions grounded in that
content, creates original graphics, writes and implements the slides, and
presents rendered work for critique. The user retains control of the meaning,
mood, metaphor, and final visual direction.

Success means the user can begin with the gist and reach a deck that feels
authored rather than generated. The slides are graphical, concise, and made to
support a speaker instead of becoming a document to read aloud.

## Brand Personality

Curious, opinionated, exacting.

nice-deck should behave like a strong design partner: interested enough to ask
what matters, confident enough to propose a point of view, and disciplined
enough to revise until the result holds up.

## Anti-references

- Template pickers that force content into a fixed theme or layout library.
- Autopilot deck generators that make the central metaphor, mood, or hero-image
  decision without the user.
- Generic AI presentation aesthetics: SaaS cards, glowing networks, space
  themes for technology, terminal-dark as a second-order reflex, beige
  editorial restraint, or decoration that could fit any topic.
- Slides that repeat the user's notes, read like documents, or use more copy to
  compensate for a weak visual idea.
- Printed reasoning: decision-relevance lines, caveat strips, and speculation
  about what the audience should infer.
- Citations the audience cannot follow: bare source names, internal locators, or
  authoring source IDs printed on a slide.
- Generated images with garbled exact text, generic stock imagery, or graphics
  that decorate without clarifying.
- Front-loaded image generation that buys a look before the argument exists.
- Low-contrast, undersized, clipped, stale, or uninspected output.

## Design Principles

### Content before direction, direction before production

Start with the argument, audience, and desired reaction — as plain frames, not
as a design. The first brainstorm produces unstyled slides with centered text
stating what each slide shows and what the speaker says. The user iterates
there, cheaply and quickly, until the argument is right.

Only then propose art directions from that material and let the user react to
visible evidence before committing to a deck grammar.

Each direction must prove itself against the same three content stresses:
figure-heavy, text-heavy, and data-heavy. Show three materially different
three-slide directions by default so the user can compare visual systems rather
than react to one lucky composition. Every direction uses a distinct typographic
system, and every direction is typography and data — no imagery is generated to
explore a look. Expand to more directions when the user asks.

### One loved system before many acceptable slides

Develop the selected three-slide system until its imagery, typesetting, and
chart grammar feel right. Only then extend it across the deck. A reaction is
design input, not a late approval gate.

### Graphics carry meaning

Use the visual to explain, orient, or create emotion. Quantitative evidence uses
the sanctioned Apache ECharts SVG runtime, not hand-built bars or pseudo-charts.
Conceptual diagrams and visual metaphors begin with generated imagery, produced
after the content and direction are settled. Native HTML and SVG are reserved
for exact labels, values, formulas, citations, recommendations, simple
separators, tables, and accessibility fallbacks.

Hybrid composition is expected: generated or chart-rendered visual foundations
carry the idea while native overlays preserve authoritative content. Generated
imagery must never contain authoritative text, values, logos, or fabricated
product interfaces. Every slide declares its primary visual modality before
implementation.

The master HTML is a directly openable artifact: runtime, fonts, scripts,
styles, and assets use relative local paths and are integrity-synced from the
pinned runtime manifest. Preview-only `/__nice-deck/` routes are not part of the
authoring or delivery contract, and missing runtime files must surface a
visible failure state.

### Structure is designed, not improvised

Each slide layout declares one grid. Every visible region is a real element and
a child of that grid, and dividers sit on grid lines. Two stacked bands with
different column tracks produce boundaries that almost line up, which reads as a
defect. Content regions are never positioned absolutely.

### The slide shows; the speaker reasons

Every slide answers a question with visible evidence and a linked citation. The
reason that evidence matters, the uncertainty around it, and what would change
the decision belong to the speaker, not to a printed strip on the slide.

Slides never state conjecture: what another observation would show, what a
number implies about cause or intent, or what the audience should conclude
beyond the evidence. Timing, correlation, and missing observations are not
rewritten as causal events.

Recommendation language is collaborative and evidence-led. State what becomes
supportable when named evidence is available instead of issuing commands to the
audience.

Empty space is complete only when the remaining composition still carries a
complete thought. Sparse is not a substitute for unresolved hierarchy,
annotation, or sourcing.

### Citations are navigable

Every visible citation is a link. Public sources link to their canonical HTTPS
URL. Internal extracts, queries, and calculations link to the supporting slide
in the same deck that shows them. A source name printed as plain text is a
failure.

### Supporting material is boring on purpose

The evidence appendix is the last section of the same deck: black on white, one
system font, tables and grayscale charts, no imagery, no motion, no narrative,
no art direction. Its job is to be checkable, and to be the destination of every
internal citation.

### The user directs; the AI produces

The AI should bring strong proposals, not ask the user to design the deck.
Metaphor, mood, and major visual choices remain collaborative decisions. Once
the direction is chosen, the AI owns the production work and its quality.

### Rendered truth over code confidence

Every changed slide is rendered and visually inspected before it is shown.
Automated checks catch mechanical failures; an actual visual judgment catches
bad design. The exact current render, not a stale or parallel surface, is what
the user sees.

## Accessibility & Inclusion

- Meet WCAG AA contrast by default.
- Support reduced motion for every animated slide.
- Keep type readable at presentation distance and never allow copy to overflow.
- Preserve keyboard navigation in the web-native deck.
- Keep exact text native and selectable when accuracy matters.
- Treat these as the baseline unless the user explicitly chooses otherwise.
