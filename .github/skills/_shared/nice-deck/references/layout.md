# Slide layout contract

A web page is an unbounded, scrolling canvas. A slide is a fixed box with
`overflow: hidden`. Almost every overlap and clipped label in a deck comes from
authoring a slide as if it were a web page.

These rules exist because the failure mode is invisible: on a web page overflow
is visible or scrollable, so you see it immediately. On a slide it is clipped,
so a broken layout renders as a slide that merely looks a little empty.

## Why slides break when pages do not

| Web page | Slide |
|---|---|
| Height grows with content | Height is fixed at 100vh |
| Overflow scrolls, and you see it | Overflow is clipped, and you do not |
| One column of flow, top to bottom | Several regions competing for one box |
| Copy can be any length | Copy has a hard pixel budget |

The consequence: on a slide, layout is a *constraint satisfaction* problem, not
a flow problem. Anything that cannot shrink will collide with something else.

## Rules

### 1. One grid per slide, one column definition

The default for a content slide is a single CSS grid with four rows — head,
body, contract strip, citation — where every one of those regions shares the
same `grid-template-columns`. A vertical division at the top then lands on the
same x as one at the bottom by construction, not by coincidence.

Title, full-bleed, and image-led slides may use a different composition. What
does not change is the rule beneath: whatever regions a slide has, they belong
to one grid and share one column definition.

Define the spine once as custom properties and never redefine it per slide:

```css
:root { --gutter: 56px; --rail: 352px; --col-gap: 44px; }
```

A region that needs a different internal split subdivides *inside* a column.
It does not invent a new page-level split.

### 2. Keep layout in flow

`position: absolute` and `float` do not participate in ordinary block-flow
sizing, so a box placed with them neither pushes its siblings nor gets pushed by
them. Floats do still affect inline layout — text wraps around them — which
makes them especially hard to reason about in a fixed box.

Do not use either to place a footer, a caption, a strip, or a number in a row.

Two legitimate exceptions:

- **Visually hidden helpers.** The `.sr-only` pattern and focus management are
  correctly `position: absolute`. They are ~1px and never affect visual layout.
- **Full-bleed backgrounds and overlays**, which are *meant* to escape the
  padding box. Mark them `data-bleed` so the overflow check knows the escape is
  intentional. Overlap checking still applies.

### 3. No fixed pixel heights on anything that holds content

A chart pinned to `height: 520px` cannot shrink when the heading above it wraps
to a third line, so something must overflow. Give the grid a flexible row and
let the chart fill it:

```css
.slide { grid-template-rows: auto minmax(0, 1fr) auto auto; }
.chart-wrap { min-height: 0; }
.chart { height: 100%; }
```

### 4. Prefer `minmax(0, 1fr)` over bare `1fr`

Grid and flex items start at `min-width: auto` / `min-height: auto`. In a
constrained axis with visible overflow this automatic minimum stops the item
shrinking below its content, so a long unbroken string or a tall child pushes
the track past its container. The behaviour is conditional — it does not apply
to scroll containers, and differs by axis in flex — but in slide layouts it is
the usual cause. Use `minmax(0, 1fr)` on tracks and `min-width: 0` /
`min-height: 0` on children that must be allowed to compress.

### 5. A wrapper that holds a chart plus a caption needs explicit rows

`height: 100%` on the chart consumes the whole wrapper and pushes the caption
out. Give the wrapper its own rows:

```css
.chart-wrap { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
```

### 6. Copy has a budget, and the budget is measured

Do not author copy and then discover it does not fit. The deck must survive
text growth, because it will be edited. The target is that every slide still
passes with its headings and `data-contract-field` text inflated by 1.8x.

## Verification

`nice_deck_preview` fails the deck when any element escapes the slide's padding
box or when two text elements overlap, reported as `issueCounts.layout`.

For headroom, run the stress check from the toolkit directory:

```powershell
cd .github/skills/_shared/nice-deck
node scripts/layout-test.mjs <url> 1     # as authored, must pass
node scripts/layout-test.mjs <url> 1.8   # inflated copy, should pass
```

It exits non-zero when any slide fails.

A clean render at the authored copy length proves only that today's words fit.
The stress run is what proves the layout is a system rather than a coincidence.

## What this deliberately does not do

It does not scale the slide to fit. reveal.js and Spectacle solve *display*
size by transforming a fixed canvas, which is the right answer for projection
but does nothing about content that was too big for the canvas in the first
place; in those frameworks overflow remains an authoring problem the tool never
reports. Here it is reported.
