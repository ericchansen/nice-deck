# Deck design principles

These principles are the stable quality floor. They do not define a house
style. If a rule fights good taste on a real slide, improve the rule rather than
forcing the slide.

## Rendered truth

Look at the rendered slide before presenting it. Render the current source,
view the image, judge it, and refresh Canvas to that exact build. Code review,
a passing scanner, or a screenshot from a different browser is not enough.

## Co-direction

- Derive the visual world from the argument, audience, and desired reaction.
- Freeze one figure-heavy, one text-heavy, and at least one data-heavy content
  proof. Add a frozen data-heavy proof for every intended chart archetype.
- Show six real directions with identical proof content and chart geometry
  before committing to a grammar.
- Give each direction its own coherent typesetting across all proofs.
  The six type systems must differ in family, weight contrast, scale, measure,
  casing, and rhythm—not just font name.
- Do not choose the central metaphor, mood, or hero image unilaterally.
- Get feedback on every rendered proof slide, then make the selected or combined
  proof system loved before making the remaining deck acceptable.

## Absolute bans

- Gradient text.
- Colored side-stripe accents on cards or callouts.
- Decorative glassmorphism.
- Numbered section eyebrows and repeated tiny uppercase tracked kickers.
- Hero-metric SaaS layouts and repeated identical card grids.
- Cream, sand, paper, parchment, or ivory default backgrounds.
- Text that clips or overflows at any supported viewport.
- Content hidden by an animation trigger that may never run.

## Color

- Body text reaches at least 4.5:1 contrast; large text reaches 3:1.
- Name the physical viewing scene before choosing light or dark.
- Choose a restrained, committed, full-palette, or drenched color strategy and
  follow through. Do not hedge into faint gray.
- Repeated color encodes a repeated meaning. Keep peers uniform or assign
  genuinely distinct categories distinct colors.

## Type

- Use one display family in multiple weights or a genuine contrast pairing.
- Keep display headings at or below roughly 6rem and letter spacing no tighter
  than -0.04em.
- Balance headings, wrap prose cleanly, and keep body lines within 65–75ch.
- Design for projection distance, not a laptop viewed at arm's length.
- Use the available horizontal space. Constrain a heading only when the
  composition earns the wrap.

## Composition

- Every slide has a job in the argument. Delete filler slides and filler copy.
- Containers, rules, and dividers must communicate grouping or hierarchy.
  Repeated gray boxes are not a default layout system.
- A resource directory may be denser than a speaking slide, but its categories,
  descriptions, and canonical URLs must remain scannable and consistent.
- Empty space is intentional only when the hierarchy, evidence, and conclusion
  still form a complete thought.

## Reasoning and tone

- Every slide visibly answers a question with evidence, decision relevance, and
  a caveat.
- Do not turn timing, correlation, or absence into causal or event language.
- Prefer evidence-led, collaborative recommendations over customer-facing
  commands.
- Speaker notes deepen the argument; they do not supply missing slide logic.

## Evidence

- Scope claims to what the named product or tool demonstrably does.
- Use authoritative sources and canonical destinations.
- Capture a landing or catalog page only after it has fully loaded; do not let a
  random detail page stand in for the whole product.

## Citations

- Keep citations visually subordinate to the slide. Use regular-weight text in
  a lighter but WCAG-compliant color; do not bold labels, source names, or links
  unless the user explicitly asks for emphasis.
- Write each citation field on one line as `Label: content`. Do not stack a
  section title above its content.
- Prefer one compact citation strip containing only the fields the slide needs.
  Human-readable source names and method links replace reader-facing source IDs.
- Separate citations from the main composition with either a light one-pixel
  rule or a subtle background-color change. Never use a bold horizontal divider.
- A tonal citation background may replace the rule when it creates a clearer
  main-slide and citation-area distinction without looking like a card.
- Keep decision-changing caveats in the main slide content. Citation space is
  for source identity, claim description, and optional calculation records, not
  for reasoning that the audience needs to understand the slide.
- If citations wrap, preserve the inline label and use a hanging continuation.
  Do not turn the citation area into a grid of labeled blocks.

## Graphics

- A graphic must explain, orient, or create intentional emotion.
- Quantitative evidence uses the sanctioned Apache ECharts SVG renderer.
  Hand-built CSS/SVG bars, rails, gates, and pseudo-charts are not primary
  visuals.
- Conceptual diagrams and visual metaphors start from generated imagery.
- Native SVG, CSS, and HTML are reserved for exact overlays, simple separators,
  tables, formulas, and accessibility fallbacks.
- Hybrid composition is expected: a chart or generated visual carries the idea
  while native labels, values, citations, and recommendations preserve accuracy.
- Real generated graphics belong in image-led direction probes. Placeholders do
  not support an honest comparison.
- Generated imagery contains no authoritative text, values, logos, or
  fabricated product interfaces.
- Every slide declares its primary visual modality before implementation.

## Motion

- Motion is part of the composition, not decoration applied afterward.
- Ease out without bounce or elastic behavior.
- Every animation has a reduced-motion alternative.
- The visible default remains useful in headless and background rendering.
- Charts register readiness, reset interaction state, and disable animation in
  deterministic capture mode.
- No decision-critical fact exists only in a tooltip, filter, or hover state.
- Direct labels are preferred to legends. Reference lines carry inline labels,
  units, and meaning; unexplained dashed lines are banned.
- Data slides show units, a visible takeaway, assumptions, source IDs, and why
  the evidence matters to the decision.

## Slop test

If the theme and palette are guessable from the topic alone, reject the first
reflex. If the aesthetic is guessable from the topic plus the obvious reaction
against that reflex, reject the second-order reflex too.

The result should feel authored for this argument, not selected for this
category.
