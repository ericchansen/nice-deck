# nice-deck

**An open-source, presents-like-you deck engine.** Web-native HTML slides, five distinct design
languages, AI-generated hero images, and a screenshot verify loop — packaged as a
[GitHub Copilot CLI](https://github.com/github/copilot-cli) skill so a zero-context session can
build a real deck on command.

nice-deck is **not a template picker.** It fleshes out your rough slide drafts *in your voice*,
decides per slide whether a bespoke AI image or precise native HTML wins, and generates
information-dense hero art — then verifies every slide renders before it reports back. The
deliverable is a **website that happens to be slides** (motion, depth, full-bleed imagery); a
PPTX export is an optional, lossy afterthought.

## Install (Copilot CLI)

```bash
copilot plugin marketplace add ericchansen/nice-deck
copilot plugin install nice-deck@nice-deck
```

Then just ask: *"build me a deck about X"* / *"turn these slide notes into a presentation."*

## What's in the box

| Piece | What it is |
|---|---|
| **The brain** | `skills/nice-deck/references/voice.hansen.md` — a **swappable voice contract** (copy rules, anti-patterns, signature moves). Fork it, drop in your own voice. |
| **5 design languages** | `references/design-languages.md` + `templates/languages/*.html` — Stage, Immersive, Poster, Blueprint, Terminal. Each genuinely **re-layouts**, not just recolors, and carries a hard-won pitfall rule. |
| **The image pipeline** | `scripts/hero.py` — hero-image generator for an Azure OpenAI image deployment (built on `gpt-image-2`), Entra ID auth, env-driven config. |
| **The verify gate** | `scripts/check.js` — walks every slide, screenshots it, and fails on any console error. "Verify before you report," encoded. |
| **Facts guardrail** | `references/facts-sheet.template.md` — never invent a number, name, URL, or command. |

## The 5 design languages

- **Stage** — cinematic dark keynote: spotlit floating artboard + a live self-typing terminal.
- **Immersive** — the AI hero *is* the slide; slow Ken Burns drift (clean heroes, no grain).
- **Poster** — light Swiss editorial: cream paper, giant stacked type, matted photo plates.
- **Blueprint** — annotated navy schematic: numbered margin pins, self-drawing connectors.
- **Terminal** — CLI-native: monospace, windowed terminals, ASCII tables, a blinking cursor.

See a worked example in [`skills/nice-deck/templates/languages/`](skills/nice-deck/templates/languages/) —
the same short deck rendered in all five languages.

## Configure image generation

`hero.py` calls an Azure OpenAI image deployment using an Entra ID (AAD) token from the Azure
CLI — **no API keys**. Copy `.env.example` to `.env` and set your own resource:

```bash
cp .env.example .env
# edit AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT
az login
```

Nothing internal is committed — you bring your own endpoint and deployment.

## Verify a deck

```bash
cd skills/nice-deck/templates/languages
python -m http.server 8000                 # serve the deck
npm i playwright && npx playwright install chromium   # once
node ../../scripts/check.js http://localhost:8000/poster.html poster ./_renders
```

Green means every slide rendered with no console errors. Then actually *look* at the renders.

## License

[MIT](LICENSE). The default "Hansen" voice is a worked example — fork it and make it yours.

