# The 5 design languages

Five **distinct** visual systems, extracted from real, verified decks. They are starting points
in `templates/languages/*.html` — copy one and swap the content. Offer the user 2–3 to compare;
generating several so they can choose is the intended workflow.

**The universal rule:** a language must genuinely **RE-LAYOUT, not recolor.** If two languages
differ only in palette, you've failed. Each has a different spatial idea, different motion, and
different hero treatment. Each also has a **pitfall rule** learned from real review feedback —
these are hard rules, not suggestions.

---

## 1. Stage — cinematic dark keynote
The default "big room" deck. A spotlit, floating **artboard** for the hero, a **live terminal**
that types itself, deep dark negative space, one warm accent.

- **Feel:** Apple-keynote-at-night. Confident, premium, lots of black.
- **Palette:** near-black ground (`#0A0B10`–`#121317`), off-white text, one indigo/amber accent.
- **Type:** large humanist sans display; mono for terminals and kickers.
- **Signature moves:** a 3D-tilted artboard holding the hero; a self-typing terminal window;
  a counter that animates up on the stats slide; slide-to-slide crossfades.
- **Best for:** launches, keynotes, exec readouts — anything shown on a big screen in a dark room.
- **Pitfall rule:** the *content* on dense slides (data-flow, agentic-pattern, closing) is the
  weak point — those slides need a real structural idea, not just a headline over black. Don't
  let a "dark slide" excuse an empty one.

## 2. Immersive — the image is the world
Full-bleed AI hero **is** the slide; text sits in a legible scrim. Slow **Ken Burns** drift.
The most "wow," the most dependent on hero quality.

- **Feel:** a cinematic title sequence. Photographic, atmospheric, edge-to-edge.
- **Palette:** dictated by the imagery; text in a soft gradient scrim for legibility.
- **Type:** restrained — the image carries it; type stays out of the way.
- **Signature moves:** full-bleed hero per slide, slow zoom/pan drift, minimal text in a
  bottom-left scrim, hero-to-hero dissolves.
- **Best for:** vision decks, brand moments, story arcs where mood matters more than density.
- **Pitfall rule:** **no film grain / noise on the hero backgrounds** — grainy backgrounds read
  as low-quality (real feedback). Generate clean, high-quality heroes; if a hero is noisy,
  regenerate rather than shipping it. Keep text scrims subtle, never a muddy overlay.

## 3. Poster — light Swiss editorial
The only **light** language, and often the cleanest. Cream paper, giant stacked display type,
a 2px top rule, mono eyebrows, a tilted **matted plate** for the hero.

- **Feel:** a printed editorial poster / exhibition catalog. Calm, confident, high-contrast type.
- **Palette:** warm cream paper (`#F4F0E6`), near-black ink, one indigo + one amber, hairlines.
- **Type:** heavy grotesque display (e.g. Bricolage Grotesque), Inter for prose, mono for meta.
- **Signature moves:** oversized stacked headline that animates in word-by-word; 2px section
  rule; matted photo "plate" tilted a few degrees; grid of ruled stat blocks.
- **Best for:** editorial talks, design-literate audiences, print-friendly decks.
- **Pitfall rule:** **real AI heroes are mandatory, not optional.** Poster's matted plates look
  broken when empty — every plate needs a real generated image. Don't ship Poster with missing
  or placeholder heroes.

## 4. Blueprint — annotated navy schematic
The deck as a **technical drawing.** Navy ground, a fine grid, numbered margin **pins**, and
**data-dot connectors** that draw themselves between labeled parts.

- **Feel:** an engineer's annotated schematic / spec sheet. Precise, diagrammatic, kinetic.
- **Palette:** deep navy/ink ground, cyan/white line work, one warm accent for callouts.
- **Type:** technical sans + mono; small annotation labels everywhere.
- **Signature moves:** numbered margin pins, connector lines that animate on entry, a persistent
  grid, callout labels that point at parts of the hero. **Lots of motion.**
- **Best for:** architecture, systems, data-flow, "how it works" decks.
- **Pitfall rule:** **restraint — no clutter, no overlap over the hero** (real feedback:
  "excellent motion but so much clutter and bad overlap"). Annotations must sit in the margins or
  clear negative space, never on top of the focal image. If pins collide, remove some. Motion
  should reveal, not crowd.

## 5. Terminal — CLI-native
The deck **is** a terminal. Monospace everything, live terminal windows that type, ASCII tables,
a blinking cursor. The most on-brand for a developer/CLI product.

- **Feel:** you're inside a beautiful TUI. Monospace, dark, precise, a little playful.
- **Palette:** terminal dark, phosphor green/amber/indigo syntax colors, off-white text.
- **Type:** monospace throughout (e.g. JetBrains Mono / Cascadia Code).
- **Signature moves:** windowed terminals with traffic-light bars that type output; ASCII/box-
  drawing tables; a blinking block cursor; prompt-and-response rhythm.
- **Best for:** dev tools, CLIs, API/infra topics, engineering-heavy audiences.
- **Pitfall rule:** keep terminal *output* real and exact (it's native text — never AI-rendered);
  don't let the mono aesthetic become a wall of green text. Use whitespace and windows to breathe.

---

## Choosing
| If the deck is about… | Reach for |
|---|---|
| A launch / big-room keynote | **Stage** |
| Vision, brand, mood, story | **Immersive** |
| Editorial talk, design audience, print | **Poster** |
| Architecture, systems, "how it works" | **Blueprint** |
| A CLI / dev tool / infra | **Terminal** |

When in doubt, build **2–3** and let the user pick — comparing full decks (not single slides) is
how the choice actually gets made.
