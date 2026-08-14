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

The AI helps shape the narrative, proposes art directions grounded in the
actual content, creates original graphics, writes and implements the slides,
and presents rendered work for critique. The user retains control of the
meaning, mood, metaphor, and final visual direction.

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
- Generated images with garbled exact text, generic stock imagery, or graphics
  that decorate without clarifying.
- Low-contrast, undersized, clipped, stale, or uninspected output.

## Design Principles

### Direction before production

Start with the argument, audience, and desired reaction. Propose distinct art
directions from that material and let the user react to visible evidence before
committing to a deck grammar.

Each direction must prove itself against the same three content stresses:
figure-heavy, text-heavy, and data-heavy. Show six materially different
three-slide directions so the user can compare visual systems rather than react
to one lucky composition. Every direction uses a distinct typographic system.

### One loved system before many acceptable slides

Develop the selected three-slide system until its imagery, typesetting, and
chart grammar feel right. Only then extend it across the deck. A reaction is
design input, not a late approval gate.

### Graphics carry meaning

Use the visual to explain, orient, or create emotion. Quantitative evidence uses
the sanctioned Apache ECharts SVG runtime, not hand-built bars or pseudo-charts.
Conceptual diagrams and visual metaphors begin with generated imagery. Native
HTML and SVG are reserved for exact labels, values, formulas, citations,
recommendations, simple separators, tables, and accessibility fallbacks.

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

### Reasoning is visible

Every slide answers a question with a supported answer, visible evidence, the
reason that evidence matters, and an honest uncertainty boundary. Speaker notes
may deepen that reasoning but may not rescue an unexplained slide. Timing,
correlation, or missing observations must not be rewritten as causal events.

Recommendation language is collaborative and evidence-led. State what becomes
supportable when named evidence is available instead of issuing commands to the
audience.

Empty space is complete only when the remaining composition still carries a
complete thought. Sparse is not a substitute for unresolved hierarchy,
annotation, sourcing, or reasoning.

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
