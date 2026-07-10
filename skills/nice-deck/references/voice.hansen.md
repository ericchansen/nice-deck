# Voice contract — "Hansen" (the default/example voice)

*This is the **knows-me** layer: tone, copy rules, structure rules, the hero-vs-structured
decision, image-gen craft, anti-patterns. It ships as **nice-deck's default voice** — a worked
example. **Swap it.** Fork this file, keep the shape, and drop in your own voice; your file wins
over anything here. Visual systems (palette, type, motifs) live in `design-languages.md` — this
doc is about **how you talk and decide**, not which theme you pick.*

---

## 0. The one-liner
Premium, minimalist, **editorial** decks — "built to be shown, not read" — where the words are
tight and earned and the visuals are **bespoke and information-rich**, never template filler.
Clean by default; generative where it wins.

## 1. Voice & tone
- **Declarative and confident.** Short sentences. "The plugin is the box. The server is one
  thing inside it." Not "This slide will discuss the relationship between…"
- **Plain-spoken senior engineer.** Technical but not jargon-drunk. Explains the thing most
  people get wrong, plainly.
- **Lead with the payoff.** The number and the "so what" first; architecture second.
- **Dry, not peppy.** No exclamation marks, no "Unlock the power of…", no marketing gloss.
- **Concrete over abstract.** Name the real tool, the real number, the real command.

## 2. Copy rules
- **Never parrot the draft verbatim.** The draft is *raw material*, not final copy. Flesh out
  thin ideas; cut bloated ones; turn a fragment into one crisp line. If a bullet already reads
  like a headline, keep it — but don't quote a rough note as if it were finished. (This is the
  #1 failure of template frameworks: they quote you back at yourself.)
- **Fill the slide, don't stuff it.** Every slide should feel *composed* to its edges —
  balanced, intentional whitespace — not a centered paragraph in a sea of empty, and not a wall
  of text. If a slide is thin, the answer is a stronger visual, not more words.
- **Word economy.** A headline, a one-line lead, and only the labels the visual needs. The
  speaker narrates; the slide anchors.
- **Ground every number in truth.** Use the facts sheet; never invent a stat, a quote, or a
  URL. Flag anything unverified rather than fabricating.
- **Lead the deck with impact** — the adoption/impact number before any architecture. It earns
  the rest.

## 3. Structure rules (contract vs. mine to shape)
- **The slide list IS a contract.** Follow the given slide count, order, and the intent of each
  slide. Don't silently drop a slide the author cared about. Don't invent new slides they didn't
  ask for. (Both are real past failures: collapsing 9→5 and losing a key slide; hallucinating a
  slide over a mockup.)
- **Wording and layout *within* a slide are mine to shape** — per the copy + visual rules.
- **Structure = contract. Prose = raw material.** Hold both at once.

## 4. The per-slide decision — hero vs structured (the hard-won rule)
> **AI for art + short labels. Native (HTML) text for anything you'd copy-paste.**

- **Full-bleed generated HERO** when the slide is *low-label and conceptual*: title, thesis,
  stats, origin/journey, "built for X," people/team. Big idea, few words → let the image carry it.
- **Structured HTML** when the slide is *text-critical*: exact quotes, URLs, terminal commands,
  precise diagrams, dense tag lists. Image models garble long strings — slashes and dots turn to
  noise. These stay native, pixel-accurate, and (for URLs) actually selectable.
- **Hybrid** is fine and often best: a structured slide with a bespoke generated *spot*
  illustration or a real screenshot dropped in — not stock, not dot-and-line filler.
- Decide per slide and **say why**. When unsure, default to structured HTML + one strong bespoke
  graphic over a fully generated slide with risky text.

## 5. Illustration / hero house style (the "wow" — the whole point)
The bar: a rich, **information-dense** editorial illustration that uses *all* the space with
intent — the opposite of clip-art. One coherent style across every image in a deck.

**Primary style — "editorial illustration":** confident, clean line work + soft flat fills in
the deck's palette, subtle depth, richly detailed, uses the whole canvas. Legible baked labels.
Reads *designed*.

**Named alt modes (pick per slide/deck):**
- **`whiteboard-human`** — literal marker/whiteboard-sketch style. For personal, team, journey,
  or "who I am / who I work with" slides. Warm, playful-professional, hand-drawn, sticky notes +
  ribbons + icon clusters + an illustrated headshot. Use when the slide is about *people or
  story*, not architecture. (This is the LinkedIn "work-life whiteboard infographic" energy.)
- **`real-screenshot`** — for an actual product surface, a real framed screenshot beats any
  illustration. Don't illustrate what you can shoot.

**Coherence:** one style token per deck, reused across every hero prompt. Don't reinvent the
style per image.

## 6. Image-gen craft rules (so heroes actually land)
- **Bake exact labels** with `reads EXACTLY "…"`; keep baked text short (1–4 words). Never trust
  the model with a URL, a command, or a long quote.
- **3:2 only** (1536×1024). Deck is 16:9 → place full-bleed with `background:center/cover` and
  let it crop, or edge-extend/pad — never distort.
- **Ground with reference images** where it matters (a headshot for personal heroes; palette/
  brand cues every time).
- **QA every image critically** before it ships: does it help the audience understand *fast*?
  Crisp text, no gibberish, no cut-offs, on-palette, uses the space. **Screenshot and actually
  look** — don't assume. Regenerate until it holds.
- **Serialize gens** (~30s gaps) to respect rate limits.

## 7. Anti-patterns (do NOT do these)
- ❌ **Dot-and-line filler.** Random floating nodes + faint connector lines as "a graphic." It
  looks like nothing.
- ❌ **Quoting the draft verbatim / template-parroting.**
- ❌ **Same-y template decks.** If it looks like a theme anyone could pick, it failed.
- ❌ **Generic corporate stock** (handshake, glowing brain, blue swooshes, 3D isometric SaaS).
- ❌ **Empty centered slides** — one line floating in white space with no composition.
- ❌ **Walls of text.** If the speaker would read it aloud verbatim, cut it.
- ❌ **AI-rendered exact strings** (URLs, commands, long quotes). Native text only.
- ❌ **Inventing numbers, quotes, or command names.** Ground or flag.

## 8. Signature moves (what makes it feel like *this* author)
- A recurring **terminal-cursor** mark — this is a CLI/terminal sensibility.
- **Lead with the number.** Slide 2 is the impact punch, not a mission statement.
- Restraint is the brand: few accents, lots of air (in the light language) or deep negative
  space (in the dark ones).
- Every hero is **bespoke and dense** — earns its place, uses the whole canvas.

*Note: an earlier version of this contract said "light theme only." That was wrong and is
retired — nice-deck ships 5 languages, 4 of them dark. Theme is chosen per deck in
`design-languages.md`; this voice applies across all of them.*
