# Precise architecture diagrams

Use this path for topology, trust, sequence, and flow diagrams whose exact
nodes, labels, boundaries, and connectors are the evidence. It complements
generated illustration; it does not make every conceptual visual a box diagram.

## Choose the medium, preserve the gates

Prefer deterministic, editable SVG when exact topology and routing matter.
Mermaid or native slide objects remain valid when they preserve the same facts
and pass the same readability and export checks. Use ECharts for quantitative
evidence, and generated imagery for illustration, photography, and visual
metaphors, not to invent a system's topology.

Record an exact diagram as `native` in the outline, brief, visual manifest, and
slide's `data-visual-modality`. Use `renderer: "svg"` for authored SVG, not
`generatedAsset` or image-generation provenance. Its `<text>` is authoritative
text, not `bakedText`; `imageText.mode` is `none`. SVG is editable source and
scales without raster pixelation, but is not necessarily editable as native
PowerPoint objects. The deck's screenshot-based PDF remains a lossy export.

Build the factual model during outline work, without drawing or styling.
Outline approval still precedes direction work; direction probes stay typography
and data, using the frozen labels or relationship table for an exact diagram.
Produce the diagram only after direction approval and modality declaration.
Do not create a diagram as a shortcut around either approval gate.

## Facts before composition

In the brief's diagram packet, separate the factual model from the composition.
Every connector and enclosure asserts something. Resolve consequential
ambiguity before styling; mark missing evidence rather than inventing a node,
capability, credential exchange, or deployment.

Inventory stable node IDs, exact counts and labels, component type, responsibility,
and implemented versus optional status. Distinguish a logical capability from a
deployed resource. Record directed relationships, prerequisites, external
authorities, credential or trust transitions, and regional, service, and
ownership boundaries separately. Containment in one boundary does not establish
containment in another. Do not place a managed service inside a network merely
because a private endpoint is there.

Map consequential node, edge, and boundary claims to `sources.json` IDs and the
frame's claim status. Optional behavior is not an observed event; a fallback
arrow needs a documented condition, not an inferred causal story. Keep
unverified elements out of the finished diagram. Model changes return to content
review instead of being smuggled in as layout fixes.

Keep public citations linked to canonical HTTPS sources. Internal models and
extracts link to a supporting slide's exact node/edge/boundary tables, not to
private URLs. That supporting section remains black-and-white evidence only;
do not move the art-directed diagram there. IDs and provenance are authoring
metadata, never extra visible labels.

## Bounded authoring packet

Fill the diagram packet in `brief.md`; carry its factual model and acceptance
counts into the slide's `diagram` object in `visual-manifest.json`. This is
authoring metadata, not a new runtime API or an automatically enforced schema.
Use the existing `sourceIds`, `captureState`, and `accessibility` fields.

The packet supplies:

- Audience, one lesson, diagram type and scope; intended slide/display size,
  aspect ratio, safe area, actual figure footprint, and smallest readable label.
- Source-backed nodes, boundaries with exact members and meaning, and edges
  with source/target ports, direction, relationship label, condition, and source
  IDs. Record exclusions, unknowns, and expected node/edge/icon counts.
- For sequences, message occurrences with unique IDs and edge references;
  explicit order, nested groups, branch membership, guards, and repetition
  bounds with source IDs. Record expected message/group counts.
- Exact strings and allowed line breaks; node boxes, hierarchy, spacing, icon
  dimensions, routing lanes, crossing/junction rules, and paint order.
- Shared semantic styles with non-color cues; official icon allowlist and
  provenance; output paths, accessibility, export constraints, and checks below.

Work directly for a small diagram. If delegation is useful, give one author the
complete packet and ownership of diagram assets only; the parent retains slide
integration and browser review. Do not require a multi-agent workflow.

### Sequence semantics

An edge set alone is not a sequence. Include `sequence` in the factual model
copied to `diagram` in the visual manifest:

- `messages`: unique occurrence `id`, `edgeId`, and `sourceIds`. Reusing an edge
  for a later message requires a distinct occurrence ID.
- `rootGroupId` and `groups`: stable `id`, `kind` (`ordered`, `parallel`,
  `alternative`, `optional`, or `loop`), and `sourceIds`. Ordered, optional, and
  loop groups carry ordered `members` referencing message or nested group IDs.
  Parallel and alternative groups carry explicit `branches` with their own
  ordered members.
- Record branch guards for alternatives, a guard for optional groups, and the
  continuation condition and repetition bounds for loops. Mark unknown bounds
  explicitly instead of inventing counts. Preserve source-backed ordering
  constraints between parallel branches without inventing a total order.

Every occurrence belongs to one group or branch; references resolve and nesting
is acyclic. Approve message order, group nesting, branch membership, guards,
loop semantics, and expected message/group counts before composition. A message
swap or a change from parallel to ordered execution is a factual-model revision,
not a layout adjustment. Mirror these fields in the supporting evidence table.

### Compact synthetic packet

This is illustrative notation, not a deployment or a product capability claim.
Its labels, conditions, geometry, and colors are not defaults.

**Factual model:** lesson: separate request, conditional fallback, and telemetry
paths. Five nodes: C "Client", G "Gateway", P "Primary service", R "Reserve
service", T "Telemetry sink". One boundary B "Service trust boundary" contains
G, P, R; C and T are outside. No region, vendor, credential issuer, or resource
count beyond these five nodes is asserted. Five directed edges:

| From port | To port | Exact label | Meaning |
|---|---|---|---|
| C.east | G.west | Request | Request path |
| G.east | P.west | Forward | Request path |
| G.south | R.west | Fallback on timeout | Conditional path in this illustrative model |
| P.south | T.north-left | Telemetry | Emission, not a request dependency |
| R.east | T.north-right | Telemetry | Emission, not a request dependency |

**Composition:** place C, G, P along the upper reading line; R below G and T
in a separate lane below B's bottom edge. Give the two ports on T distinct
coordinates. Route fallback
in a lower lane with a labeled dashed stroke; route telemetry separately with
its own labels and non-color cue. If a telemetry path crosses fallback, route
around it or draw an explicit bridge: no dot and no connection. Only an actual
shared connection gets a junction dot. Boundary fills paint first, then edges,
then node bodies and exact text; no fill may cover a path except at its intended
endpoint. Allow "Primary service" and "Reserve service" to wrap after the first
word. Use generic shapes and zero vendor icons.

**Acceptance:** five nodes, five directed edges, one boundary, zero icons;
exact strings, correct containment, distinct ports, no unintended junctions,
and no clipped or covered labels. Fill in the actual slide footprint and safe
area before drawing. If reused in a deck, record `illustrative scenario` as its
claim status and link to an in-deck table of this model, not to vendor guidance
as evidence that this deployment exists.

## Geometry and visual craft

Construct explicit SVG `rect`, `text`, `path`, and, when needed, `image`
geometry. Use a `viewBox`, named ports with coordinates, and stable IDs for
nodes, boundaries, and edges so the drawing can be checked against the model.
Route arrows to exact ports; crossings are not junctions. Check marker
orientation, path endpoints, and paint order, not just whether a line exists.

Establish one representative diagram. Reuse its hierarchy, icon sizes,
component positions, boundary styles, and path semantics across variants where
truth permits. Do not retain phantom nodes, identical counts, or positions
that imply false containment merely to match a previous layout.

Keep captions short and informative, labels next to recognizable icons, and
boundaries meaningful. Do not add decorative dividers. Use direct relationship
labels and non-color cues; a compact key is justified only for notation those
labels do not explain. Do not label the same idea twice.

Fit type to the rendered figure, not its source dimensions. For example, a
1240 by 560 figure with 20px component names and 16px supporting labels is one
possible starting point, not a minimum or a house style. At half size those
labels become 10px and 8px: reject that placement for presentation. Choose the
palette from the approved deck; request, telemetry, and fallback styling must
have consistent meaning, not prescribed colors.

The entire figure sits in one in-flow `data-region` child of the slide grid.
Internal SVG coordinates are not permission to absolutely position slide
titles, citations, or other content. Keep authoritative text selectable:
prefer reviewed inline SVG in the deck; an `<img>` alone is not selectable text.
Keep the standalone SVG too. Prefix inline IDs per instance, including marker
and accessible-name references, to avoid collisions across slides.

## Icons and self-contained artifacts

Use unchanged vendor-official icons with nearby component names. For Azure,
use the [official architecture icons and terms](https://learn.microsoft.com/en-us/azure/architecture/icons/).
Record origin URL, retrieval date, permitted use, attribution requirements,
and file hash in asset provenance. Do not recolor, distort, crop, flip, or
imitate logos; do not use product icons for generic capabilities, random image
search results, or assets from confidential decks.

Reuse the existing workspace `assets/` handling: keep authored diagram sources,
original licensed icons, and built self-contained SVGs in distinct subfolders.
Preview hashes local SVG assets with the deck; portable export copies assets.
No new renderer is required. Embed approved local icons as data URIs or an
equivalent self-contained representation allowed by their terms. A standalone
SVG must not need sibling files, host CSS, web fonts, or network fetches.

If templating is useful, resolve only allowlisted names such as
`{{icon:gateway}}`; reject unknown names and leftover markers. Retain the
original icons separately from built output. Do not accept arbitrary SVG as
safe: XML parsing and the deck scanner are not sanitizers. Review local inputs
before embedding; reject scripts, event handlers, `foreignObject`, DTD/entities,
external references, and active content even inside data-URI payloads. Permit
only inspected passive icon geometry. Use a project's established sanitizer
when available; otherwise do not inline untrusted assets. A diagram should
contain passive geometry and text.

## Review the actual artifacts

Apply these checks through the existing adversarial-review roles, not a
separate approval system:

- Parse SVG as XML without DTD/entity resolution; require `<title>`, `<desc>`,
  an accessible name, unique IDs, and resolved local references. Check expected
  nodes, edges, icons, exact strings, and absence of unresolved template markers.
- Compare every connector, direction, condition, trust transition, and
  containment with the factual model. Inspect text bounds, overlaps, path
  crossings, junctions, markers, and layering. Geometry is not visual approval.
- For sequences, check occurrence IDs and message/group counts, message order,
  nesting, branch membership, guards, and repetition bounds against the approved
  model and sources. Reject swapped messages, missing or duplicated occurrences,
  invented ordering between parallel branches, and lost alternative/optional/loop
  semantics even when the node and edge counts match.
- Run `nice_deck_preview`, inspect its exact screenshots, and refresh Browser
  Canvas to its exact URL after each slide edit. Inspect the actual containing
  slide/page in Edge at intended size too; do not substitute that screenshot
  for the canonical review evidence.
- Open the standalone and downloaded/exported SVG in Edge with networking
  disabled. Inspect labels, contrast, crop, icons, and crossings there as well
  as on the slide. Confirm no external dependencies or missing glyphs; verify
  direct-file, static-server, and sanctioned-preview deck behavior.
- Keep page/slide controls semantic and keyboard accessible. On small displays,
  offer explicit figure expansion or a separate scrollable detail view rather
  than shrinking labels indefinitely; do not reflow the fixed slide canvas.
- Fix material findings in bounded batches, re-render, then record approval
  against the exact source and screenshot hashes. Changed SVGs or model
  metadata require a new review; never claim the scanner checked topology.

## Public guidance

These inform the method, not the facts of any particular architecture:

- [Azure Well-Architected: design diagrams](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams)
- [Azure architecture icons and permitted use](https://learn.microsoft.com/en-us/azure/architecture/icons/)
- [C4 notation: elements, relationships, and non-color semantics](https://c4model.com/diagrams/notation)
