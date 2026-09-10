# nice-deck

nice-deck is a four-skill suite for outlining, creating, art-directing, and
reviewing graphical, web-native presentations.

You bring the gist, source material, and desired outcome. It starts with
content: plain frames, black text centered on white, one line of what each
slide shows and one line of what the speaker says. You iterate there until the
argument is right. Only then does design begin — three real visual directions,
each demonstrated on the same figure-heavy, text-heavy, and data-heavy content.
You react to the rendered comparison before the chosen or combined grammar is
extended across the deck.

It is not a template picker. Every deck discovers its visual world from the
content and the user's reaction to rendered work.

## Skills

- **`deck-outline`** agrees the content first, as plain unstyled frames.
- **`deck-create`** turns conversations, notes, documents, source material, or
  existing slides into a polished deck.
- **`deck-explore-direction`** renders comparable figure-, text-, and data-heavy
  treatments so the user can approve or combine a visual system.
- **`deck-review`** audits and improves an existing deck's argument, evidence,
  visual design, accessibility, rendering, and delivery readiness.

The skills share one toolkit for preview, chart rendering, image generation,
validation, and export. Shared production rules live under
`.github\skills\_shared\nice-deck`; it is not a fifth user-facing skill.

## What it produces

- Concise slides designed to support a speaker rather than become a document.
- Evidence on the slide and reasoning in the speaker's mouth: no printed
  decision-relevance lines, caveat lines, or conjecture.
- Citations that are real links — public sources to their canonical URL,
  internal extracts and calculations to a supporting slide in the same deck.
- A plain black-and-white supporting section at the end of the deck: data,
  extracts, and methods, with no art direction.
- Native HTML, CSS, SVG, and selectable text where interaction or deterministic
  revision matters.
- Source-backed exact architecture diagrams: a factual model before styling,
  precise editable topology, official icon provenance, and standalone/offline
  review through the shared
  [diagram workflow](.github/skills/_shared/nice-deck/references/architecture-diagrams.md).
- AI-generated graphics and self-contained infographics where integrated
  illustration and concise text make the idea land faster — produced after the
  content and direction are settled, never to explore a look.
- A web-native deck with keyboard navigation and reduced-motion support.
- Playwright screenshots tied to the exact source hash shown in Canvas.
- Independent adversarial reviews tied to the exact screenshot and generated
  asset hashes approved for presentation.

PPTX is an optional lossy export and never drives the design.

## Local prototyping

Open a Copilot session in this repository. Copilot discovers the four project
skills from `.github\skills`, while the repo-local extension registers
`nice_deck_preview` and the shared production contract.

Install the preview dependency once:

```powershell
cd .github\skills\_shared\nice-deck
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

nice-deck creates the workspace outside this public repository and writes
`outline.json`. Generate and render the plain frames:

```powershell
cd .github\skills\_shared\nice-deck
npm run outline -- $HOME\Documents\decks\my-deck
npm run validate:outline -- $HOME\Documents\decks\my-deck
```

Once the outline is approved, it selects representative slides, keeps their
content constant, and renders three materially different three-slide
directions. Each set uses its own typographic system and the sanctioned ECharts
SVG runtime for data proofs. It inspects every screenshot, opens the exact
cache-busted treatments in Browser Canvas, and collects feedback before any
direction propagates.

Direction work is tracked in
`directions/visual-direction-matrix.json`. Validate the authored matrix before
review and again after feedback:

```powershell
cd .github\skills\_shared\nice-deck
npm run validate:directions -- $HOME\Documents\decks\my-deck --review
npm run validate:directions -- $HOME\Documents\decks\my-deck --approved
```

To preview a deck directly:

```powershell
cd .github\skills\_shared\nice-deck
npm run preview -- $HOME\Documents\decks\my-deck\deck.html
```

Open the printed cache-busted URL; press `Ctrl+C` to stop the preview server.

### Edit slide wording in the browser

Ask Copilot to open an existing deck with `nice_deck_edit`, or launch the local editor directly:

```powershell
cd .github\skills\_shared\nice-deck
npm run edit -- $HOME\Documents\decks\my-deck\deck.html
```

Open the printed editor URL. **Copy the deck folder first when you want to preserve an original.** The editor has three primary regions: a compact top toolbar, slide content on the left, and that slide’s actual HTML source on the right. Both panels remain visible side by side on narrow screens, with source scrolling inside its panel. Click slide text, change its wording, and save. Undo/redo and a clean Read view let you compare changes without moving slide elements. Secondary actions (draft download, saved HTML, slide checks), review status, and conflict recovery are under **More** in the toolbar; errors open it automatically.

The source pane starts with authored slide markup from the revision loaded by this tab, never the live DOM. Inline text changes are escaped into their original source ranges. Edit markup and attributes in the source pane: after a 250 ms pause, the service validates the draft and updates the live preview **without writing the file**. Invalid HTML retains the last good preview and disables Save; the draft remains editable. Drafts, source selection, composition, and undo/redo survive slide navigation. Scripts/styles outside the current slide are not included. A slide without an explicit closing tag is reported as source unavailable rather than reconstructed from DOM.

**Save is explicit.** Source edits replace exactly one matching slide boundary per change; the slide container tag, `id`, and `data-slide-id` must remain unchanged. Additional/nested slides, duplicate IDs, malformed markup, and edits to explicitly locked source are rejected. Close authored non-void HTML elements explicitly, even when HTML normally permits an omitted end tag. There is no separate text-editing panel. The saved HTML remains an ordinary presentation with no editor code or editing attributes added.

Pure HTML slide text is editable inline by default: headings, paragraphs, table cells and prices, scope notes, citation labels, and supporting slides. Edit mixed-format fragments and SVG labels in the visible HTML source instead. Pure-text child elements can also edit inline, including after source changes; their text synchronizes back to the draft source. Authors can use `data-edit-id="stable-field-name"` for durable element identity and lock regions with `data-editable="false"` or `data-edit-lock`; locks apply to descendants too.

This is a bounded HTML editor, not a data-model editor. Image-baked text and generated chart internals require their original authoring sources. Changing a displayed price does not update its evidence, calculator inputs, or build-time data. Preview reconciliation keeps unchanged runtime nodes and calculators rather than reloading the deck. Changed scripts, event handlers, and embedded application elements are inactive in live drafts; save and reopen the saved HTML to test executable changes. Changed application subtrees may lose local state. Existing trusted deck scripts continue running.

Saving patches only selected text ranges or validated whole-slide source ranges; all bytes outside those ranges remain untouched, including BOM, line endings, scripts, and other slides. Textareas normalize line endings to LF inside a source-edited slide. Inline-only edits retain the original line endings and can synchronize a matching static `data-title`; whole-slide edits save the authored attributes exactly. Saves never serialize the live DOM, chart SVGs, or runtime wrappers. Revision checks reject stale tabs and outside edits instead of overwriting them. Recoverable save records live under `.nice-deck-edit` beside the source. Do not delete that directory while editing. Unsaved browser changes are not source autosaves; download draft changes (including whole-slide source changes) before discarding a conflict or restarting the authoring service.

Each save requests a fresh canonical preview. Render findings and review status remain separate from saving: **saved is not approved**. Existing outline, claim, source, and visual-manifest records are not rewritten by the editor. Reconcile changed wording with those records and obtain a current screenshot-based review before presenting or exporting. If a build script generates the HTML, update its source before rebuilding or it can replace browser edits. Standalone imports may lack their original authoring metadata or sanctioned runtime files; the editor reports them as imported drafts and does not fabricate approval.

The server binds only to loopback and scopes file access to the selected deck folder. Its launch URL authorizes edits: keep it private. Open only trusted local HTML, since the deck's scripts continue to run. Browser permission prompts and filesystem pickers are not required. Preview scans run in a separate worker so large embedded decks do not block the authoring API. Cooperative locking and revision checks prevent competing editor saves; they cannot make arbitrary external file writers participate in a transaction.

Editor service/source tests run with `npm run test:editor`; browser interaction tests use installed Microsoft Edge with `npm run test:editor:browser`. Set `NICE_DECK_EDITOR_SCREENSHOTS` to an output directory to capture desktop, inline editing, live source markup/attribute changes before save, and narrow-layout screenshots from disposable test fixtures. No user deck is opened by these tests. Restart an already-running editor service after updating the application so its source manifest and UI use the same version; preserve unsaved drafts before restarting. There is no new frontend build step.

Preview renders drafts even when visual review is missing. Initialize and
validate the presentation gate against the exact preview record:

```powershell
npm run review:init -- $HOME\Documents\decks\my-deck
npm run validate:review -- $HOME\Documents\decks\my-deck
```

Export an email-safe PDF from those exact inspected renders:

```powershell
cd .github\skills\_shared\nice-deck
npm run export:pdf -- $HOME\Documents\decks\my-deck\deck.html
```

The PDF is intentionally lossy: each page matches the rendered slide and keeps
its external web and email links. Unsupported local and internal links are
reported and omitted. The HTML remains the editable source of truth.

## Image generation

`.github/skills/_shared/nice-deck/scripts/image.py` calls an Azure OpenAI image deployment with
an Entra ID token from Azure CLI. Copy `.env.example` to `.env`, set the
endpoint and deployment, then run:

```powershell
python scripts\image.py --prompt-file direction.txt --out assets\direction.png `
  --quality high --intended-slide plugin-explainer --visual-role "Self-contained infographic" `
  --image-text-mode integrated --baked-text-file baked-text.json `
  --accessible-description "A plugin packages reusable capabilities into one install."
```

Integrated image text is intentional, concise, and recorded in provenance.
Citations, source IDs, URLs, and provenance remain native linked deck content.

Configuration is local and ignored by git. No endpoint, subscription, token, or
generated dogfood deck belongs in this repository.

## Install as a plugin

The four skills live under `.github/skills`, so repository sessions discover
them automatically. Installed plugins use the same directory through
`plugin.json`, making the skills available across repositories.

## License

MIT
