# Deck design principles

These principles are the stable quality floor. They do not define a house
style. If a rule fights good taste on a real slide, improve the rule rather than
forcing the slide.

## Rendered truth

Look at the rendered slide before presenting it. Render the current source,
view the image, judge it, and refresh Canvas to that exact build. Code review,
a passing scanner, or a screenshot from a different browser is not enough.

## Co-direction

- Agree the content before the look. The outline brainstorm produces plain
  frames — black text centered on white — and the user iterates there. Nothing
  is styled and nothing is generated until those frames are approved.
- Derive the visual world from the argument, audience, and desired reaction.
- Freeze one figure-heavy, one text-heavy, and at least one data-heavy content
  proof. Add a frozen data-heavy proof for every intended chart archetype.
- Show three real directions with identical proof content and chart geometry
  before committing to a grammar. Show more when the user asks for more.
- Direction probes are typography and data. Generate no imagery until the
  outline and the direction are both approved; front-loaded image generation
  buys a look before the argument exists.
- Give each direction its own coherent typesetting across all proofs.
  The type systems must differ in family, weight contrast, scale, measure,
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
- Printed decision-relevance lines, caveat lines, and "why this matters" strips.
- Conjecture: speculation about cause, intent, or what another observation would
  show.
- Plain-text citations. Every visible citation is a link.
- Absolutely positioned content regions inside a slide.

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
- Every visible element must earn its place. Do not add structure, decoration,
  or a second idea merely because the slide has open space.
- One slide, one grid. Every visible region is a real element and a child of
  that grid.
- Avoid horizontal rules as decoration, pacing, or routine division in
  main-slide content. Establish hierarchy with spacing, alignment, typography,
  or background change. A purposeful exception must carry meaning and be a
  grid-child border.
- Stacked bands share column tracks. Boundaries that almost line up read as a
  defect, and they are the most common structural failure in a generated deck.
- Containers and boundaries must communicate grouping or hierarchy. Repeated
  gray boxes and rules are not a default layout system.
- A resource directory may be denser than a speaking slide, but its categories,
  descriptions, and canonical URLs must remain scannable and consistent.
- Extreme restraint is valid. One meaningful image, value, phrase, or chart can
  carry an otherwise blank slide when it completes the thought. Minimalism does
  not excuse missing evidence or sourcing.

## Reasoning and tone

- Every slide shows evidence for one idea. The reasoning that connects it to a
  decision is the speaker's job, not a printed line.
- No conjecture. Do not print what another observation would show, what a number
  implies about cause or intent, or what the audience should conclude.
- Do not turn timing, correlation, or absence into causal or event language.
- Prefer evidence-led, collaborative recommendations over customer-facing
  commands.
- Keep visible prose under 40 words per slide, outside the title, direct labels,
  values, and the citation line. Less text is the default, not a stretch goal.
- Speaker notes carry the argument, the caveats, and the decision relevance.

## Evidence

- Scope claims to what the named product or tool demonstrably does.
- Use authoritative sources and canonical destinations.
- Capture a landing or catalog page only after it has fully loaded; do not let a
  random detail page stand in for the whole product.
- Supporting material lives in a plain black-and-white section at the end of the
  deck: data, extracts, queries, and methods, with no art direction and no
  narrative.

## Citations

- Every visible citation is a link. Public sources link to a canonical HTTPS
  URL; internal, derived, and calculated sources link to the in-deck supporting
  slide that shows the extract or method.
- Plain-text source names and `[S1]` markers do not belong on a slide.
- Keep citations visually subordinate to the slide. Use regular-weight text in
  a lighter but WCAG-compliant color; do not bold labels, source names, or links
  unless the user explicitly asks for emphasis.
- Write each citation field on one line as `Label: content`. Do not stack a
  section title above its content.
- Prefer one compact citation strip containing only the fields the slide needs.
- A light one-pixel rule above the citation area is the standard horizontal
  divider. A subtle background-color change may replace it.
- A tonal citation background may replace the rule when it creates a clearer
  main-slide and citation-area distinction without looking like a card.
- Caveats and decision reasoning are spoken, not printed. Citation space is for
  source identity and its link.
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
- Direction probes use typography and data. Generate imagery only after the
  outline and the direction are approved, and only for a slide that cannot be
  carried by a measurement or by exact text.
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
- Data slides show units, direct labels, a visible takeaway, and a linked
  citation. Assumptions and method belong on the supporting slide the citation
  links to.

## Slop test

If the theme and palette are guessable from the topic alone, reject the first
reflex. If the aesthetic is guessable from the topic plus the obvious reaction
against that reflex, reject the second-order reflex too.

The result should feel authored for this argument, not selected for this
category.
