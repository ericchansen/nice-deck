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
- Fast, scoped feedback previews; independent adversarial reviews are optional.

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

For feedback, preview only the changed slide IDs:

```powershell
cd .github\skills\_shared\nice-deck
npm run preview -- $HOME\Documents\decks\my-deck\deck.html --slides pricing,summary
```

The `nice_deck_preview` tool accepts the same selection as `slideIds` and
defaults to `mode: "feedback"`. Omit the selection to capture all slides.
Feedback mode renders once without exhaustive layout, lifecycle, or off-aspect
audits, while retaining contrast checks on captured slides. It writes a scoped
`feedback-preview.json`, leaving any full-audit
record separate. It is not a claim that the whole deck passed an audit.

Inspect the changed screenshots and open the printed cache-busted URL. The
extension no longer renders automatically after each file write: finish the
edit batch and build first. Keep the preview server for the user's review;
press `Ctrl+C` to stop it.

Routine feedback does not need review agents, formal review JSON, unchanged
calculator tests, or three delivery-surface checks. See
[Fast feedback](.github/skills/_shared/nice-deck/references/feedback.md).

Full audits and independent reviews remain available when requested:

```powershell
npm run preview -- $HOME\Documents\decks\my-deck\deck.html --audit
npm run review:init -- $HOME\Documents\decks\my-deck
npm run validate:review -- $HOME\Documents\decks\my-deck
```

The strict review workflow binds four independent roles to a complete audit's
screenshots and generated assets. It does not block ordinary preview or export.

Export an email-safe PDF from those exact inspected renders:

```powershell
cd .github\skills\_shared\nice-deck
npm run export:pdf -- $HOME\Documents\decks\my-deck\deck.html
```

The PDF is intentionally lossy: each page matches the rendered slide and keeps
its external web and email links, plus internal links to slide IDs (including
supporting slides). Unsupported local links and unresolved internal targets are
reported and omitted. The HTML remains the editable source of truth.
PDF and portable exports do not require formal review by default. Add
`--require-review` to enforce the optional strict review gate.

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

## Contributor architecture and tests

The toolkit remains an ESM package at `.github/skills/_shared/nice-deck`.
Command adapters live in `scripts/`; the extension in
`.github/extensions/deck-design` handles tool arguments, serialized requests,
and the lifetime of the user's preview server. Keep the extension thin.

Internal ownership follows command adapters → workflow composition →
workspace/browser/check primitives:

- `lib/files.mjs`, `workspace.mjs`, `snapshot.mjs`, and `server.mjs` own atomic
  writes, source inventory/identity, captured inputs, and loopback serving.
  `lib/static-policy.mjs` owns the shared preview/HTTP extension and MIME allowlist.
  Inventory policies for preview snapshots and draft delivery intentionally
  differ; draft export copies arbitrary assets and runtime files.
- `lib/browser-session.mjs` owns browser contexts, offline routing, readiness,
  and cleanup. A supplied browser belongs to its caller.
- `lib/capture.mjs` captures selected slides; `lib/audit.mjs` performs exhaustive
  checks. `lib/checks/` holds browser-serializable layout, contrast, and chart
  probes. Layout adapters preserve the distinct preview/standalone tolerances,
  waits, caps, stress behavior, and messages.
- `scripts/preview.mjs` remains the public compatibility entry point and
  composes feedback or audit with workspace scanning, record serialization,
  and optional review assessment; scan/review composition remains here rather
  than in `lib/audit.mjs`.
  Feedback must not invoke workspace scanning, exhaustive audits, or review
  assessment. Full-deck capture alone is not a full audit.
- PDF and portable commands own delivery composition. Non-draft portable
  delivery uses captured snapshot inputs, not subsequently changed live files.
  Internal modules must not import command adapters.

Run the native Node suite from the toolkit directory after installing the
existing dependencies:

```powershell
cd .github\skills\_shared\nice-deck
npm test
```

For an installed Edge instead of Playwright's bundled Chromium:

```powershell
$env:NICE_DECK_TEST_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm test
```

`scripts/test-support/browser.mjs` exposes `launchTestBrowser(options)`.
The **test-only** `browser-preload.mjs` also covers internal exporter/direction
launches and propagates through `NODE_OPTIONS` to child processes. Production
commands do not import this seam and retain their Chromium launch defaults.
For a targeted run, retain the preload:

```powershell
node --import ./scripts/test-support/browser-preload.mjs --test --test-name-pattern="source scan" scripts/preview.test.mjs
```

The explicit `package.json` test list must include every added suite:

- `workspace.test.mjs`: fixed source-hash byte vectors, discovery, atomic
  writes, HTTP behavior, snapshot repair, and portable inventory policies.
- `orchestration.test.mjs`: runtime traps prove feedback does not invoke
  workspace scanning, rendered audit, or review assessment; also checks
  compatibility export identities, dependency direction, and session cleanup.
- `preview.test.mjs`: named scope, snapshot/server, source-scan, runtime, and
  complete-pipeline suites. Each scenario owns a fresh temporary workspace and
  registers cleanup before setup; browser scenarios own their browser as well.
  The pipeline retains chart determinism, review-pinned screenshots, PDF links,
  portable navigation, and missing-runtime fallback coverage.
- `layout.test.mjs`: shared measurements and both adapters, including actual
  standalone CLI subprocesses, stress text, and custom canvases.
- Existing outline, direction, review, and extension suites preserve their
  respective contracts. No optional review agents run during tests.

Set `NICE_DECK_TEST_ARTIFACTS` to an **external** directory to retain representative
screenshots, audit/feedback JSON, PDF, and a portable chart package. Otherwise
fixtures and their artifacts are removed even on failure. Retained JSON records
describe the original temporary paths/URLs; they are evidence, not live servers.
Do not put generated decks or test output in the repository.

Compatibility tests deliberately preserve native path separators and hash
framing. They also characterize the existing nested-source portable behavior:
the HTML is flattened to its basename without rewriting `../` links. Fixing
that delivery limitation is separate from a behavior-preserving refactor.
There is no lint script; use `node --check` for changed JavaScript in addition
to running the tests.

## License

MIT
