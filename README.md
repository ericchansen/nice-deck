# nice-deck

nice-deck turns a loose presentation brief into a graphical, web-native deck
through collaborative art direction.

You bring the gist, source material, and desired outcome. The AI helps shape
the narrative, freezes three representative content proofs, and renders six
real visual directions across all three: one figure-heavy slide, one text-heavy
slide, and one data-heavy slide. You react to the 18-slide comparison before
the chosen or combined visual grammar is extended across the deck.

It is not a template picker. Every deck discovers its visual world from the
content and the user's reaction to rendered work.

## What it produces

- Concise slides designed to support a speaker rather than become a document.
- Native HTML, CSS, SVG, and selectable exact text.
- AI-generated graphics where illustration, atmosphere, texture, or character
  work makes the idea land faster.
- A web-native deck with keyboard navigation and reduced-motion support.
- Playwright screenshots tied to the exact source hash shown in Canvas.

PPTX is an optional lossy export and never drives the design.

## Local prototyping

Open a Copilot session in this repository. The repo-local extension loads the
co-direction workflow and registers `nice_deck_preview`.

Install the preview dependency once:

```powershell
cd skills\nice-deck
npm install
npm run setup
```

Then ask:

```text
Start a nice-deck prototype in $HOME\Documents\decks\my-deck.

The audience is ...
The argument is ...
The rough slide ideas are ...
```

nice-deck creates the workspace outside this public repository and selects
three representative slides. It keeps their content constant while rendering
six materially different three-slide directions. Each set uses its own
typographic system; image-led sets use real draft graphics and data-led proofs
use the sanctioned ECharts SVG runtime. It inspects all 18 screenshots, opens
the exact cache-busted treatments in Browser Canvas, and collects feedback
before any direction propagates.

Direction work is tracked in
`directions/visual-direction-matrix.json`. Validate the authored matrix before
review and again after feedback:

```powershell
cd skills\nice-deck
npm run validate:directions -- $HOME\Documents\decks\my-deck --review
npm run validate:directions -- $HOME\Documents\decks\my-deck --approved
```

To preview a deck directly:

```powershell
cd skills\nice-deck
npm run preview -- $HOME\Documents\decks\my-deck\deck.html
```

Open the printed cache-busted URL; press `Ctrl+C` to stop the preview server.

Export an email-safe PDF from those exact inspected renders:

```powershell
cd skills\nice-deck
npm run export:pdf -- $HOME\Documents\decks\my-deck\deck.html
```

The PDF is intentionally lossy: each page matches the rendered slide and keeps
its external web and email links. Unsupported local and internal links are
reported and omitted. The HTML remains the editable source of truth.

## Image generation

`skills/nice-deck/scripts/image.py` calls an Azure OpenAI image deployment with
an Entra ID token from Azure CLI. Copy `.env.example` to `.env`, set the
endpoint and deployment, then run:

```powershell
python scripts\image.py --prompt-file direction.txt --out assets\direction.png --quality medium
```

Configuration is local and ignored by git. No endpoint, subscription, token, or
generated dogfood deck belongs in this repository.

## Install as a plugin

Public plugin packaging will be finalized after the repo-local workflow has
been dogfooded. The skill already lives under `skills/nice-deck`; the local
extension is the development path.

## License

MIT
