---
name: nice-deck
description: 'Build web-native presentation decks that present in your voice, with AI-generated hero images. Trigger when the user asks to build a deck, make slides, create a presentation, turn draft notes into slides, or reskin/finish a deck. Not a template picker — it fleshes out drafts in the user''s voice and generates bespoke hero art.'
license: MIT
allowed-tools: Bash, PowerShell
---

# nice-deck — build a presents-like-you deck

Turn rough per-slide drafts into a polished, **web-native HTML deck** that presents in the
user's voice, with **bespoke AI-generated hero images** where they win. This is not a
template picker. It pairs a swappable **voice contract** (the "knows me" layer) with a
per-slide editorial + visual decision, a `gpt-image-2` image pipeline, and a screenshot
**verify gate**.

The deliverable is a **website that happens to be slides** — motion, depth, full-bleed
imagery. A PPTX export is an optional, lossy afterthought, never the goal.

## Bundled assets (in this skill folder)
- `references/voice.hansen.md` — the default/example **voice contract** (copy rules, anti-
  patterns, signature moves). **Swappable** — a user forks this and drops in their own voice.
- `references/design-languages.md` — the **5 design languages** (Stage, Immersive, Poster,
  Blueprint, Terminal), each with signature moves and hard-won pitfall rules.
- `references/facts-sheet.template.md` — the "never invent a number" guardrail; copy per deck.
- `templates/languages/*.html` — 5 **working, self-contained** decks, one per language. Copy
  one as a starting point and swap the content; each is already a functioning slide shell
  (nav, dots, progress, keyboard, animations).
- `scripts/hero.py` — `gpt-image-2` hero generator (env-driven; see `.env.example` at repo root).
- `scripts/check.js` — screenshot verifier: walks every slide, fails on any console error.

## Inputs you ask for (or infer)
- **Drafts** — the user's per-slide notes or mockup. **Structure is a contract** (keep their
  slide count, order, and the intent of each slide). **Wording is raw material** — flesh out
  thin notes, cut bloat, never parrot a rough note back as finished copy.
- **A voice** — default to `voice.hansen.md`; if the user has their own, use it. It wins over
  any default here.
- **A facts sheet** — the single source of truth for every number, name, URL, and command.
  Never invent; flag gaps. Start from `facts-sheet.template.md`.

## Process
1. **Editorial pass.** For each draft slide, apply the voice contract: rewrite thin notes into
   crisp copy, trim bloat, keep the slide list intact, and plan a layout that **fills the
   canvas** (composed to the edges — not a centered paragraph in a sea of white, not a wall of
   text). If a slide is thin, the fix is a stronger visual, not more words.

2. **Pick a design language.** Choose one of the 5 (or offer 2–3 for the user to compare). Read
   `design-languages.md` for its signature moves **and its pitfall rules**. The languages must
   genuinely **re-layout, not recolor** — if two languages differ only in palette, you failed.

3. **Per-slide decision — hero vs structured** (the core rule):
   > **AI for art + short baked labels. Native HTML text for anything you'd copy-paste.**
   - **Full-bleed generated HERO** when the slide is low-label and conceptual: title, thesis,
     stats, journey, people, "why this matters." Let a bespoke image carry it.
   - **Structured HTML** when text is exact/critical: URLs, commands, quotes, dense tag lists,
     precise diagrams. `gpt-image-2` garbles long strings — these stay native, pixel-accurate,
     and (for URLs) actually selectable.
   - **Hybrid** is great: a generated background or spot illustration with native text on top
     for the exact strings.
   - When unsure, default to structured HTML + one strong bespoke graphic over a fully
     generated slide with risky text.

4. **Build on a language template.** Copy `templates/languages/<language>.html`, keep its shell
   (nav, dots, progress, keyboard handler, animation classes), and replace the slide content.
   One `.slide` section per slide. Copying a template to a new deck folder **also requires copying
   its `heroes/` folder** (or updating the relative `heroes/hero-*.png` paths) — otherwise the
   hero images 404. Serve locally to view: `python -m http.server` in the deck folder, open
   `http://localhost:8000/<deck>.html`.

5. **Generate heroes.** Write prompts from the chosen language's illustration style; **bake only
   short labels** (1–4 words) with `reads EXACTLY "…"`; never trust the model with a URL,
   command, or long quote. Generate one **style token per deck** and reuse it across every hero
   so the images look like a coherent set.
   ```
   python scripts/hero.py --prompt-file p.txt --out heroes/01.png --size 1536x1024 --quality high
   ```
   Place heroes full-bleed via `background:center/cover`. The model is **3:2 only** (1536×1024);
   let it crop to 16:9, don't distort. Serialize gens (~30s gaps); each takes ~100–140s.

6. **Verify by screenshot — before reporting.** This is the gate, not optional. Run both
   commands from `skills/nice-deck`.
   ```
   npm i playwright && npx playwright install chromium   # once, from skills/nice-deck
   node scripts/check.js http://localhost:8000/<deck>.html <prefix> ./_renders   # from skills/nice-deck
   ```
   Actually look at every render: heroes crisp and non-garbled, on-language, native strings
   exact, nothing overlaps or clips, the deck reads coherently, **09/09 no console errors**.
   Regenerate/fix until it holds. Never report "done" without having looked.

7. **(Optional) PPTX.** Only if the user needs it. It is lossy — motion and depth don't survive.
   The web deck is the product.

## House rules (from the voice contract — enforce these)
- **Never parrot the draft.** Flesh out or keep simple; fill the slide.
- **Multi-theme, web-native.** 4 of the 5 languages are dark. There is no "light only" rule.
- **Ground every number.** Use the facts sheet; flag anything unverified rather than fabricating.
- **Anti-patterns:** dot-and-line filler; generic corporate stock (handshake, glowing brain,
  blue swooshes, 3D isometric SaaS); verbatim quoting; walls of text; AI-rendered exact strings;
  invented numbers or install commands.
- **Craft, per language:** no film grain on Immersive hero backgrounds; restraint + no overlap
  over the hero on Blueprint; real heroes are mandatory (not optional) on Poster; every language
  must genuinely re-layout.

## Environment
- **Image model:** any Azure OpenAI image deployment (built and tested on `gpt-image-2`).
  Config via env — see `.env.example`: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and
  optionally `AZURE_OPENAI_API_VERSION` / `AZURE_SUBSCRIPTION_ID`. **No keys committed.**
- **Auth:** Entra ID (AAD) via `az account get-access-token --resource
  https://cognitiveservices.azure.com`. `hero.py` handles this; just be logged in with `az login`.
- **Verify:** Playwright/Chromium via `scripts/check.js` (local install).
