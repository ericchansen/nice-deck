# Typography direction references

Each three-slide direction uses one coherent type system. The figure-heavy,
text-heavy, and data-heavy probes within that direction share the same families,
weights, scale, measure, casing, and rhythm. All six directions must be
materially different from one another.

Use [Beautiful Web Type](https://beautifulwebtype.com) as a specimen and pairing
reference, not as a template library. Its catalog documents typeface weights,
styles, glyphs, kerning, OpenType features, and pairings. The project is
[MIT-licensed](https://github.com/ubuwaits/beautiful-web-type/blob/master/LICENSE);
the typefaces it features are licensed under the SIL Open Font License according
to its [README](https://github.com/ubuwaits/beautiful-web-type#featured-typefaces).
Download the chosen font files into the deck workspace and retain their license
and public source URL.

## Six useful contrast seeds

These are starting points when the brief does not already imply stronger
typographic objects. Do not preserve their specimen copy, colors, or page
layouts.

| Seed | Useful tension | Reference |
|---|---|---|
| Archivo Black + Lora | compressed graphic force against humanist reading texture | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/archivo-black-and-lora) |
| Fraunces + Libre Franklin | expressive variable display against disciplined grotesk text | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/fraunces-and-libre-franklin) |
| Libre Franklin + Source Serif Pro | institutional sans structure against editorial evidence text | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/libre-franklin-and-source-serif-pro) |
| Messapia + Inter | idiosyncratic display silhouette against neutral technical annotation | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/messapia-and-inter) |
| Oswald + Source Serif Pro | narrow poster cadence against measured long-form explanation | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/oswald-and-source-serif-pro) |
| Rakkas + Vollkorn | emphatic calligraphic display against sturdy literary text | [Specimen source](https://github.com/ubuwaits/beautiful-web-type/tree/master/content/pairings/rakkas-and-vollkorn) |

## Required type-system declaration

Each direction in `directions/visual-direction-matrix.json` declares:

- `id`
- `displayFamily` and `textFamily`
- `displayWeight` and `textWeight`
- `scale`
- `headingMeasure` and `bodyMeasure`
- `casing`
- `rhythm`
- `specimenSource`
- local `fontAssets`, each with its license and public source URL

Changing only the font family is insufficient. The rendered hierarchy must also
change through weight contrast, scale ratio, line measure, casing behavior, and
vertical rhythm. Changing only color, tracking, or a single headline face does
not create a new direction.

The validator compares every pair of directions and requires differences
across at least four declared dimensions. It also opens each rendered treatment
and reads computed typography from:

```html
<body data-type-system-id="fraunces-libre-franklin">
  <section class="slide" data-probe-role="text-heavy">
    <h1 data-type-role="display">...</h1>
    <p data-type-role="text">...</p>
  </section>
</body>
```

All three probes in a direction must render that direction's declared display
and text families and weights. The six rendered family-and-weight systems must
remain distinct.

Each declared family and weight must also appear as a loaded `@font-face` whose
resolved `src` points to one of that direction's declared local font assets.
Naming a missing family and falling back to the same system font in all six
directions fails review.
