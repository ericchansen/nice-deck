# Outline frames

The outline is the first brainstorm. It settles the argument, the order, and
the evidence before any visual decision exists.

## What a frame is

A frame is one slide reduced to two lines: what the audience sees, and what the
speaker says. It is rendered as black text centered on white with a system
font, no color, no chart, no image, and no typographic system.

The plainness is the point. A frame the user likes is liked for its content.

## Inventory the data first

No frame may be written before `available.datasets` is filled in. Writing
frames first is how invented content gets in: a frame says "monthly volume"
because that is what came to mind, not because monthly is what the source
provides.

Find how the data was actually retrieved — the query, the model, the notebook,
the export — and record what it can answer:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Short stable id a frame can point at. |
| `name` | yes | The dataset, model, table, or file as it is actually named. |
| `location` | yes | Where it lives: workspace, database, repository, path. |
| `range` | yes | The period the data actually covers. |
| `grain` | yes | The **finest** grain available: `request`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`, or `snapshot`. |
| `dimensions` | yes | What you can group by. |
| `measures` | no | The columns or measures available. |
| `extracts` | yes | Files already pulled. Empty array if none. |
| `scope` | yes | What the data does and does not cover — which account, tenant, subscription, or population. |

Record `available.notAvailable` too: what you looked for and could not get. An
empty list claims nothing is missing, so leave it empty only when that is true.

Every `data` and `hybrid` frame names its `dataset`. Validation rejects a frame
that presents a coarser period than its dataset provides — a frame showing
monthly totals from a daily table is caught, because the finer series is
already available and almost always more interesting.

## Frame fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable slide id. The built deck reuses it unchanged, so citation anchors survive the transition from outline to deck. |
| `title` | yes | Working slide title. |
| `shows` | yes | One line naming the concrete artifact on the slide: the measurement, chart, table, quote, or image. |
| `says` | yes | One line of what the speaker says over it. |
| `modality` | yes | `data`, `native`, `hybrid`, or `conceptual`. |
| `section` | yes | `main` or `supporting`. |
| `dataset` | for `data` and `hybrid` | The `available.datasets` id this frame draws from. |
| `sourceIds` | yes | Array. May be empty while evidence is outstanding. |
| `status` | yes | `draft`, `needs-evidence`, or `ready`. |
| `notes` | no | Anything that belongs to the speaker rather than the slide. |

## Writing rules

- Lead with data. A measurement beats a sentence about a measurement.
- Use the finest grain the source provides unless the coarser view is the point.
- One idea per frame. Two sentences in `says` means two frames.
- `shows` names a thing, not a feeling. "Daily cache hit rate, Jul 1-31, percent
  of input tokens" is a frame. "Context on our usage" is not.
- Never write conjecture. Do not state what another observation would show,
  what a number implies about intent, or what the audience should conclude
  beyond the evidence. Interpretation belongs to the speaker.
- Mark a frame `needs-evidence` rather than writing a confident line the sources
  do not support.
- Prefer fewer frames. Deleting a frame is a stronger edit than improving it.

## Modality at outline time

Declaring modality early keeps production honest and keeps image generation
late:

- `data` — the frame's artifact is a measured or modeled chart. This is the
  default for evidence.
- `native` — exact text, a table, a formula, or a quote.
- `hybrid` — a chart or generated visual with authoritative native overlays.
- `conceptual` — a generated visual metaphor. Use it only when no measurement
  or exact text can carry the idea. Nothing is generated during the outline.

A frame that cannot justify `conceptual` in one sentence is `data` or `native`.

## Main and supporting frames

`main` frames are the talk. `supporting` frames are the plain black-and-white
evidence section at the end of the deck: extracts, queries, methods, and
calculations.

Every internal citation in the finished deck links to a supporting frame, so
the outline must contain a supporting frame for each internal source that main
frames rely on. Read `supporting.md` for the rules that section follows.

## Generating and iterating

```powershell
npm run outline -- <workspace>
```

This overwrites `<workspace>/outline.html` from `<workspace>/outline.json`.
Never hand-edit or style `outline.html`; edit the JSON and regenerate.

Render it with `nice_deck_preview`, view every screenshot, and refresh Browser
Canvas to the exact URL before asking for a reaction.

## Approval gate

```powershell
npm run validate:outline -- <workspace>
```

The outline is approved when every frame is `ready`, or is `needs-evidence` and
the user has explicitly accepted it as an open item, and `outline.json` records:

```json
{ "status": "approved", "approvedAt": "2026-01-31" }
```

`deck-explore-direction` refuses to validate a direction matrix without an
approved outline. Frozen direction-probe content is chosen from approved
frames, not invented alongside them.
