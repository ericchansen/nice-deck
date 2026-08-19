---
name: deck-outline
description: Brainstorm and agree the content of a presentation before any design work, using plain unstyled frames that state what each slide shows and what the speaker says. Use when the user asks to outline, storyboard, structure, sketch, plan, or brainstorm a deck, or before creating a deck from notes or source material.
license: MIT
---

# deck-outline

Agree what the deck says before anyone decides how it looks.

This is the first of two brainstorms. It produces plain frames: black text
centered on white, no color, no imagery, no chart, no typographic system. The
user reacts to the argument and the evidence rather than to a composition.

The second brainstorm is `deck-explore-direction`. Do not start it until the
outline is approved. `deck-create` runs both in order.

## Load before working

Read:

- `../_shared/nice-deck/references/foundation.md`
- `../_shared/nice-deck/references/outline.md`
- `../_shared/nice-deck/references/principles.md`
- `../_shared/nice-deck/references/supporting.md`
- `../_shared/nice-deck/references/profile.hansen.md` when working for Eric
  Hansen

Use the shared scripts under `../_shared/nice-deck/`.

## 1. Read the material first

Accept whatever the user has: a conversation, notes, documents, URLs, an
existing deck, a partial slide list, or a data extract.

Inspect it before asking anything. Ask only for consequential gaps, one focused
question at a time:

- audience and setting
- the argument, and what should change afterwards
- which evidence exists and which is still missing
- duration and any fixed slide count
- confidentiality

Do not ask about fonts, colors, layouts, or chart styles. That is the second
brainstorm.

## 2. Inventory the data before writing anything

Find how the data was actually retrieved. Read the prior sessions, the query,
the notebook, the export script, and any files already on disk. Do not accept a
summary of the data as a substitute for the data.

Record in `outline.json` under `available.datasets`, for each source: `id`,
`name`, `location`, `range`, the **finest** `grain` it provides, `dimensions`,
`measures`, `extracts` already pulled, and `scope`. Record what you could not
get in `available.notAvailable`.

Report the inventory to the user before writing frames. It routinely contains
more than the previous deck used — a longer range, a finer grain, an unqueried
dimension — and that is exactly the material worth a slide.

`validate:outline` refuses to accept frames until this block is filled.

## 3. Write the frames

Create `outline.json` from
`../_shared/nice-deck/references/outline.template.json`.

Every frame declares:

- `id` — stable slide id, reused unchanged by the built deck
- `title` — the working slide title
- `shows` — one line naming the concrete thing on the slide: the measurement,
  the chart, the table, the quote, the image
- `says` — one line of what the speaker says over it
- `modality` — `data`, `native`, `hybrid`, or `conceptual`
- `section` — `main` or `supporting`
- `dataset` — for `data` and `hybrid` frames, the inventory id it draws from
- `sourceIds` — may be empty while evidence is still being gathered
- `status` — `draft`, `needs-evidence`, or `ready`

Rules:

- Lead with data. Prefer a measurement over a statement about a measurement.
- Use the finest grain the inventory offers unless the coarser view is the
  actual point. Validation rejects a monthly frame drawn from a daily table.
- One idea per frame. If `says` needs two sentences, it is two frames.
- Name the evidence you actually have. Mark a frame `needs-evidence` instead of
  writing a confident line the sources do not support.
- No conjecture. Do not write what a second observation would show, what a
  number implies about intent, or what the audience should conclude beyond the
  evidence.
- Supporting frames carry the extracts, queries, methods, and calculations that
  main frames cite. Every internal citation in the finished deck needs a
  supporting frame to link to. Read
  `../_shared/nice-deck/references/supporting.md`.
- Prefer fewer frames. Cutting a frame is a stronger edit than improving it.

## 4. Render and iterate

Generate the plain frames:

```powershell
npm run outline -- <workspace>
```

Then run `nice_deck_preview` on `<workspace>/outline.html`, view every returned
screenshot, and refresh Browser Canvas to the exact cache-busted URL.

Do not style `outline.html`. It is generated, intentionally plain, and
overwritten on every run. Edit `outline.json` and regenerate.

Present the frames as a sequence and ask what is missing, what is filler, and
what is out of order. Reorder, merge, split, and delete in `outline.json`, then
regenerate and show the frames again.

## 5. Approve the outline

The outline is approved when every frame is `ready` or explicitly accepted as
`needs-evidence`, and the user says the argument is right.

Record in `outline.json`:

```json
{ "status": "approved", "approvedAt": "2026-01-31" }
```

Record the same gate in `brief.md` under "Outline gate", with the frame count,
the split between main and supporting frames, and any evidence still
outstanding.

Validate before handing off:

```powershell
npm run validate:outline -- <workspace>
```

An unapproved outline blocks `deck-explore-direction` and `deck-create`
production. Hand off the approved frames and the outstanding evidence list, not
a design opinion.
