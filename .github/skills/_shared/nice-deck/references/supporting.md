# Supporting section

Supporting slides are the evidence appendix. They are the last slides of the
same `deck.html`, so citation anchors resolve in the browser, from `file://`,
and in the exported PDF.

Most are deliberately plain. Their job is to be checkable. A resource
directory may instead use the approved deck system when its URLs are useful
content rather than audit evidence.

## Placement and identity

- Supporting slides come after every main slide, in one file.
- Each carries `data-section="supporting"` and a stable `id`, and that `id` is
  the target of the citations that rely on it.
- The `id` matches the outline frame id, so anchors survive from outline to
  deck.
- A short divider slide may introduce the section. It carries a title and
  nothing else.

## Evidence appendix mode

- White background, black text. No deck palette, no accent color, no tinted
  panels.
- One system font stack. No display family, no weight contrast beyond regular
  and bold, no letter-spacing tricks.
- Tables and grayscale ECharts only.
- No generated imagery, no photography, no icons, no motion, no metaphor.
- No art direction of any kind. Do not extend the approved deck grammar into
  this section, and do not create a second grammar for it.

This is the default for extracts, queries, calculations, and methods.

## Designed reference-directory mode

Use this only for a curated directory that the audience will browse or reuse.
Declare it on the slide:

```html
<section class="slide"
  id="references"
  data-slide-id="references"
  data-section="supporting"
  data-supporting-mode="designed-directory"
  data-visual-modality="native">
```

- Use the deck background, typography, and established color semantics.
- Balance two or three columns across the full available slide height.
- Keep one fixed vertical rhythm within every link group.
- Treat written canonical URLs as first-class content; do not hide useful
  endpoints behind vague labels.
- Preserve enough separation between the title and directory for the title to
  read as its own region.
- Keep the slide static, accessible, and linked. The mode relaxes the
  black-and-white and no-imagery rules, not evidence or delivery integrity.

## The content

- Exact extracts, queries, methods, calculations, and assumptions.
- Values stay native and selectable. Units and grain are stated.
- A supporting slide may be dense. It is read, not presented.
- Each supporting slide names what it is evidence for, and links back to the
  main slide it supports.
- Public sources on a supporting slide use their canonical HTTPS URL.

## What it is not

- Not a place for narrative, recommendations, or interpretation.
- Not a dumping ground for slides that failed the main deck's edit. A frame
  that does not carry evidence is deleted, not demoted.
- Not part of the direction exploration. Supporting slides are never used as
  proof content in `deck-explore-direction` and never receive a treatment.
- Not exempt from accessibility. Contrast, keyboard navigation, and readable
  type still apply.

## Validation

The workspace scan enforces the section:

- every `data-section="supporting"` slide has an `id`
- no animation or transition inside the section
- evidence appendix slides remain monochrome and contain no imagery
- designed reference-directory slides may use imagery and the deck palette
- every non-public source in `sources.json` names a `deckAnchor` that resolves
  to a supporting slide id in the deck

Start from `templates/supporting.css`.
