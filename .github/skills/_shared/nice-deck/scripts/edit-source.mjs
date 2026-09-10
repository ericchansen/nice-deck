import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, parse as parsePath, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { parse, parseFragment } from "parse5";

/**
 * Bounded text and whole-slide source editing. No runtime DOM or serialization.
 * UTF-8 input is required. Offsets are UTF-16 string offsets from parse5; file
 * revisions are SHA-256 of the original bytes (including BOM and CRLF).
 *
 * Locks coordinate cooperating editors only. An unrelated writer can still race
 * the final revision check/rename. We never "roll back" over such a writer.
 * Recovery is deliberately manual: before.html, after.html and prepared.json
 * remain private; only a durable committed.json acknowledges a completed save.
 * File contents are fsynced. Directory fsync is used on POSIX, but is unavailable
 * through this Node API on Windows; power-loss guarantees depend on the OS/FS.
 */
export class EditError extends Error {
  constructor(code, message, status = 400, options) {
    super(message, options);
    this.name = "EditError";
    this.code = code;
    this.status = status;
  }
}

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const safeTags = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "div", "small", "strong", "em",
  "b", "i", "u", "s", "mark", "abbr", "sub", "sup", "li", "dt", "dd", "blockquote",
  "td", "th", "caption", "a", "cite", "footer", "header", "section", "article",
  "label", "figcaption", "address", "time",
]);
const protectedTags = new Set([
  "nav", "math", "iframe", "form", "input",
  "button", "textarea", "select", "option", "optgroup", "fieldset",
  "legend", "output", "datalist", "meter", "progress", "code", "pre", "script",
  "style", "template", "noscript", "xmp", "plaintext", "listing", "object", "embed",
]);
const queues = new Map();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const classes = (node) => (attr(node, "class") ?? "").split(/\s+/).filter(Boolean);
const elements = (node) => (node.childNodes ?? []).filter((child) => child.tagName);
const ownText = (node) => (node.childNodes ?? []).map((child) => child.value ?? "").join("");
const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const badSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const reviewHint = "Saved source requires content reconciliation and a fresh render/review. "
  + "Outline, manifest, sources and evidence have not been updated.";
const unsupportedHint = "No source-backed text fields. Native slide text, table cells, notes, "
  + "citation labels and SVG labels can have bounded text fields. Slides with explicit boundaries can still be edited as HTML source. Explicit locks are preserved.";

function exactTextRange(source, location, text, context) {
  if (!location || !Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)) return false;
  const raw = source.slice(location.startOffset, location.endOffset);
  if (/<(?:!|\?|\/?[A-Za-z])/.test(raw)) return false;
  if (raw === text) return true;
  // Foster-parented text can span intervening markup in the original source.
  // Never replace such a span, even if the parsed DOM merged it into one node.
  const fragment = parseFragment(context, raw, { scriptingEnabled: true });
  return fragment.childNodes.every((child) => child.nodeName === "#text") && ownText(fragment) === text;
}

function textContent(node, replacements = new Map()) {
  if (replacements.has(node)) return replacements.get(node);
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? []).map((child) => textContent(child, replacements)).join("");
}

function validKey(value, kind) {
  if (typeof value !== "string" || !value.trim() || control.test(value) || badSurrogate.test(value)) {
    throw new EditError("invalid-id", `${kind} must have a nonempty, valid text identifier.`);
  }
  return value;
}

function inspect(source) {
  if (typeof source !== "string" || badSurrogate.test(source)) {
    throw new EditError("invalid-source", "The HTML source must be a valid Unicode string.");
  }
  const document = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  const slides = [];
  const fields = [];
  const locations = new Map();
  const explicitIds = new Set();
  const fieldIds = new Set();
  const slideIds = new Set();
  const anchors = new Map();
  let title = "";
  // Only actual document children: template.content is deliberately not visited.
  const stack = [{ node: document, slide: null, path: [], protected: false, locked: false, section: "main" }];
  while (stack.length) {
    const entry = stack.pop();
    const { node } = entry;
    let { slide, path, locked, section } = entry;
    const tag = node.tagName;
    const names = classes(node);
    const html = node.namespaceURI === HTML;
    const svg = node.namespaceURI === SVG;
    const hardProtected = entry.protected || (tag && ((!html && !svg) || protectedTags.has(tag)));
    locked ||= attr(node, "data-editable")?.toLowerCase() === "false"
      || attr(node, "data-edit-lock") !== undefined;
    section = attr(node, "data-section") ?? section;
    const explicit = attr(node, "data-edit-id");
    if ((html || svg) && explicit !== undefined) {
      validKey(explicit, "data-edit-id");
      if (explicitIds.has(explicit)) throw new EditError("duplicate-field-id", "Duplicate explicit data-edit-id.");
      explicitIds.add(explicit);
    }
    const anchor = html || svg ? attr(node, "id") : undefined;
    if (anchor) anchors.set(anchor, (anchors.get(anchor) ?? 0) + 1);
    if (html && tag === "title" && !title) title = ownText(node);
    if (html && names.includes("slide")) {
      if (slide || hardProtected || !["section", "div", "article"].includes(tag)) {
        throw new EditError("invalid-slide-context", "Slides must be non-nested HTML section/div/article containers outside protected content.");
      }
      const id = validKey(attr(node, "data-slide-id") ?? anchor, "Each slide");
      if (slideIds.has(id)) throw new EditError("duplicate-slide-id", "Duplicate slide identifier.");
      slideIds.add(id);
      slide = {
        id, anchor: anchor ?? "", index: slides.length,
        title: attr(node, "data-title") ?? "", section, fields: [],
      };
      slides.push(slide);
      // Private parse information is never put in the public result.
      locations.set(slide, { node, firstH1: null });
      path = [];
    } else if (slide && html && !hardProtected && /^h[123]$/.test(tag)) {
      const info = locations.get(slide);
      if (tag === "h1" && !info.firstH1) info.firstH1 = node;
      if (!slide.title) slide.title = textContent(node);
    }
    const eligible = slide && !hardProtected && !locked
      && (html ? safeTags.has(tag) : svg && ["text", "tspan"].includes(tag));
    const location = node.sourceCodeLocation;
    const whole = eligible && path.length && node.childNodes?.length
      && node.childNodes.every((child) => child.nodeName === "#text")
      && location?.startTag && location?.endTag;
    const candidates = [];
    if (whole && ownText(node).trim()) {
      candidates.push({
        valueNode: node, text: ownText(node),
        range: { startOffset: location.startTag.endOffset, endOffset: location.endTag.startOffset },
      });
    } else if (eligible) {
      (node.childNodes ?? []).forEach((child, index) => {
        if (child.nodeName === "#text" && child.value.trim()) {
          candidates.push({ valueNode: child, text: child.value, range: child.sourceCodeLocation, textNode: index });
        }
      });
    }
    for (const candidate of candidates) {
      if (!exactTextRange(source, candidate.range, candidate.text, node)) continue;
      const baseId = explicit ?? `field:${encodeURIComponent(slide.id)}:${path.join(".")}`;
      const id = candidate.textNode === undefined ? baseId : `${baseId}:text:${candidate.textNode}`;
      if (fieldIds.has(id)) throw new EditError("duplicate-field-id", "Editable field keys must be unique.");
      fieldIds.add(id);
      const field = {
        id, slideId: slide.id, path: [...path], tag,
        label: svg ? "Diagram label" : tag === "a" ? "Link label"
          : ["td", "th"].includes(tag) ? "Table cell" : tag === "p" ? "Paragraph"
          : /^h[1-6]$/.test(tag) ? tag.toUpperCase() : "Text",
        text: candidate.text, multiline: false, namespace: svg ? "svg" : "html",
        ...(candidate.textNode === undefined ? {} : { textNode: candidate.textNode }),
      };
      fields.push(field);
      slide.fields.push(field);
      locations.set(id, {
        start: candidate.range.startOffset, end: candidate.range.endOffset,
        node, valueNode: candidate.valueNode, slide,
      });
    }
    const children = elements(node);
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({
        node: children[index], slide, path: slide ? [...path, index] : [],
        protected: hardProtected, locked, section,
      });
    }
  }
  for (const slide of slides) {
    if (slide.anchor && anchors.get(slide.anchor) !== 1) {
      throw new EditError("duplicate-slide-id", "A slide anchor is not unique in this document.");
    }
    slide.title ||= slide.id;
    // Exact authored bytes (as UTF-16 text), never serialization of a parsed/live DOM.
    // A missing explicit closing tag has no reliable whole-slide boundary.
    const location = locations.get(slide).node.sourceCodeLocation;
    slide.source = location?.startTag && location?.endTag
      ? source.slice(location.startOffset, location.endOffset) : null;
    for (const field of slide.fields) {
      const range = locations.get(field.id);
      if (slide.source !== null && range.start >= location.startOffset && range.end <= location.endOffset) {
        field.sourceRange = { start: range.start - location.startOffset, end: range.end - location.startOffset };
      }
    }
  }
  for (const field of fields) {
    if (explicitIds.has(field.id) && attr(locations.get(field.id).node, "data-edit-id") !== field.id) {
      throw new EditError("duplicate-field-id", "An explicit data-edit-id collides with a computed field key.");
    }
  }
  return {
    public: {
      title: title || slides[0]?.title || "Untitled deck", slides, fields,
      eligibleCount: fields.length, status: fields.length ? "ready" : "no-editable-fields",
      reviewHint: fields.length ? "Bounded text and slide-source editing. Saved changes will require review." : unsupportedHint,
    },
    locations,
  };
}

export function inspectEditableHtml(source) {
  return inspect(source).public;
}

function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 100) {
    throw new EditError("invalid-changes", "changes must be an array of at most 100 bounded edits.");
  }
  const ids = new Set();
  for (const change of changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)
      || Object.keys(change).some((key) => !["id", "oldText", "text", "kind"].includes(key))
      || (change.kind !== undefined && change.kind !== "slide")
      || typeof change.id !== "string" || typeof change.oldText !== "string" || typeof change.text !== "string") {
      throw new EditError("invalid-changes", "Each change requires string id, oldText and text, with optional kind: slide.");
    }
    const key = `${change.kind ?? "text"}:${change.id}`;
    if (ids.has(key)) throw new EditError("duplicate-change", "A source range may be changed only once per request.");
    ids.add(key);
  }
}

const escapeText = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (text) => escapeText(text).replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function patch(source, changes, inspection) {
  validateChanges(changes);
  if (changes.some((change) => change.kind === "slide")) {
    const slideChanges = changes.filter((change) => change.kind === "slide");
    const textChanges = changes.filter((change) => !change.kind);
    const ids = new Set(slideChanges.map((change) => change.id));
    if (textChanges.some((change) => ids.has(inspection.public.fields.find((field) => field.id === change.id)?.slideId))) {
      throw new EditError("overlapping-fields", "Do not mix text and source edits on the same slide.", 422);
    }
    const edits = [];
    for (const change of slideChanges) {
      const slide = inspection.public.slides.find((item) => item.id === change.id);
      if (!slide || slide.source === null) throw new EditError("unknown-slide", "No explicit source boundary for this slide.", 422);
      if (slide.source !== change.oldText) throw new EditError("text-conflict", "Slide source changed. Reload before saving.", 409);
      if (slide.source === change.text) continue;
      validateSlideSource(change.text, slide, inspection, source);
      const location = inspection.locations.get(slide).node.sourceCodeLocation;
      edits.push({ start: location.startOffset, end: location.endOffset, text: change.text });
    }
    let html = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
    }
    const nextInspection = inspect(html);
    if (nextInspection.public.slides.length !== inspection.public.slides.length ||
        nextInspection.public.slides.some((slide, index) => {
          const old = inspection.public.slides[index];
          return slide.id !== old.id || slide.anchor !== old.anchor ||
            (!ids.has(old.id) && slide.source !== old.source);
        })) throw new EditError("slide-boundary", "The replacement must preserve every slide boundary and identity.", 422);
    const allIds = new Set();
    const visit = (node) => {
      const id = attr(node, "id");
      if (id && allIds.has(id)) throw new EditError("duplicate-id", "HTML IDs must be unique.", 422);
      if (id) allIds.add(id);
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    };
    visit(parse(html));
    const textResult = patch(html, textChanges, nextInspection);
    return { html: textResult.html, effective: [
      ...slideChanges.filter((change) => change.text !== change.oldText), ...textResult.effective,
    ] };
  }
  const { public: info, locations } = inspection;
  if (changes.length && !info.fields.length) throw new EditError("no-editable-fields", unsupportedHint, 422);
  const fields = new Map(info.fields.map((field) => [field.id, field]));
  const edits = [];
  const effective = [];
  const replacements = new Map();
  const changedSlides = new Set();
  for (const change of changes) {
    const field = fields.get(change.id);
    if (!field) throw new EditError("unknown-field", "The requested field is not an eligible plain-text field.", 422);
    if (change.oldText !== field.text) throw new EditError("text-conflict", "Field text changed. Reload before saving.", 409);
    // Existing multiline/long/empty source is allowed to remain byte-for-byte unchanged.
    if (change.text === field.text) continue;
    if (!change.text.trim() || change.text.length > 5000 || control.test(change.text) || badSurrogate.test(change.text)) {
      throw new EditError("invalid-text", "New text must be nonempty, single-line Unicode, at most 5000 UTF-16 code units, without control characters.");
    }
    const location = locations.get(field.id);
    edits.push({ start: location.start, end: location.end, text: escapeText(change.text) });
    effective.push({ id: change.id, oldText: change.oldText, text: change.text });
    replacements.set(location.valueNode, change.text);
    changedSlides.add(location.slide);
  }
  for (const slide of changedSlides) {
    // Only the first h1 in this slide can synchronize its static data-title,
    // and only if the decoded old values exactly matched. No global
    // replacement, no document <title>, manifest or outline rewriting.
    const slideInfo = locations.get(slide);
    if (!slideInfo.firstH1) continue;
    const oldTitle = textContent(slideInfo.firstH1);
    const newTitle = textContent(slideInfo.firstH1, replacements);
    if (newTitle !== oldTitle && attr(slideInfo.node, "data-title") === oldTitle) {
      const attributeLocation = slideInfo.node.sourceCodeLocation?.attrs?.["data-title"];
      if (attributeLocation) {
        const raw = source.slice(attributeLocation.startOffset, attributeLocation.endOffset);
        const match = /^([^\s=]+\s*=\s*)(?:(["'])([\s\S]*)\2|([^\s"'=<>`]+))$/.exec(raw);
        if (!match) throw new EditError("unsupported-title", "The corresponding data-title attribute cannot be patched safely.", 422);
        const quote = match[2] || '"';
        edits.push({
          start: attributeLocation.startOffset, end: attributeLocation.endOffset,
          text: `${match[1]}${quote}${escapeAttribute(newTitle)}${quote}`,
        });
      }
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let result = source;
  let boundary = source.length;
  for (const edit of edits) {
    if (edit.end > boundary || edit.start > edit.end) throw new EditError("overlapping-fields", "Ambiguous source locations.", 422);
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    boundary = edit.start;
  }
  return { html: result, effective };
}

export function patchEditableHtml(source, changes) {
  return patch(source, changes, inspect(source)).html;
}

function validateSlideSource(text, slide, inspection, source) {
  const fail = (message) => { throw new EditError("slide-boundary", message, 422); };
  if (!text || text.length > 500_000 || badSurrogate.test(text) || text.includes("\0")) fail("Use valid slide HTML up to 500,000 characters.");
  const errors = [];
  const fragment = parseFragment(text, { sourceCodeLocationInfo: true, onParseError: (error) => errors.push(error) });
  const node = fragment.childNodes[0];
  const location = node?.sourceCodeLocation;
  if (errors.length || fragment.childNodes.length !== 1 || !location?.endTag ||
      location.startOffset !== 0 || location.endOffset !== text.length ||
      !classes(node).includes("slide")) fail("Draft must be exactly one explicitly closed slide, with valid HTML syntax.");
  const oldNode = inspection.locations.get(slide).node;
  if (node.tagName !== oldNode.tagName || attr(node, "id") !== attr(oldNode, "id") ||
      attr(node, "data-slide-id") !== attr(oldNode, "data-slide-id")) fail("Keep the slide tag, id and data-slide-id unchanged.");
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const walk = (root, action) => {
    action(root);
    for (const child of root.childNodes ?? []) walk(child, action);
    if (root.content) walk(root.content, action);
  };
  walk(node, (child) => {
    if (child.tagName && child.sourceCodeLocation && child.namespaceURI === HTML &&
        !voids.has(child.tagName) && !child.sourceCodeLocation.endTag) fail("Close every authored non-void HTML element explicitly.");
  });
  // Source locks apply to markup too, including inherited locks outside the slide.
  for (let ancestor = oldNode; ancestor; ancestor = ancestor.parentNode) {
    if (attr(ancestor, "data-edit-lock") !== undefined || attr(ancestor, "data-editable")?.toLowerCase() === "false") {
      fail("This slide inherits an explicit edit lock.");
    }
  }
  const locked = (root, raw) => {
    const values = [];
    walk(root, (child) => {
      if (attr(child, "data-edit-lock") !== undefined || attr(child, "data-editable")?.toLowerCase() === "false") {
        const loc = child.sourceCodeLocation;
        if (!loc) fail("A locked element has no source boundary.");
        values.push(raw.slice(loc.startOffset, loc.endOffset));
      }
    });
    return values;
  };
  if (JSON.stringify(locked(oldNode, source)) !== JSON.stringify(locked(node, text))) fail("Explicitly locked source must remain unchanged.");
  const parsed = inspect(text);
  if (parsed.public.slides.length !== 1 || parsed.public.slides[0].source !== text) fail("Draft escapes the single slide boundary.");
}

function enqueue(key, action) {
  const result = (queues.get(key) ?? Promise.resolve()).then(action);
  const tail = result.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return result;
}

async function noLinks(path, kind) {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(/[\\/]/).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new EditError("unsafe-path", "Symbolic links and junctions are not supported.", 400);
    const directory = index < parts.length - 1 || kind === "directory";
    if (directory ? !stat.isDirectory() : !stat.isFile()) {
      throw new EditError("unsafe-path", "Expected a normal file and real directories.", 400);
    }
  }
}

async function readNormal(path) {
  await noLinks(path, "file");
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new EditError("unsafe-path", "Only regular files are supported.");
    return { bytes: await handle.readFile(), stat };
  } finally {
    await handle.close();
  }
}

function decode(bytes) {
  try {
    // ignoreBOM means retain the BOM character, not discard it.
    const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(html, "utf8").equals(bytes)) throw new Error("Non-round-trippable UTF-8");
    return html;
  } catch (cause) {
    throw new EditError("unsupported-encoding", "Choose a UTF-8 HTML source file; other encodings are not rewritten.", 422, { cause });
  }
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await fs.open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function privateDirectory(path) {
  await noLinks(dirname(path), "directory");
  try { await fs.mkdir(path, { mode: 0o700 }); } catch (failure) {
    if (failure.code !== "EEXIST") throw failure;
  }
  await noLinks(path, "directory");
}

async function durableFile(path, bytes, mode = 0o600) {
  await noLinks(dirname(path), "directory");
  const handle = await fs.open(path, "wx", mode);
  try {
    // open's mode is subject to umask. Preserve the selected source's mode on
    // the replacement, while backups and logs always use private permissions.
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function optionalJson(path) {
  let bytes;
  try { ({ bytes } = await readNormal(path)); } catch (failure) {
    if (failure.code === "ENOENT") return null;
    throw failure;
  }
  try { return JSON.parse(bytes.toString("utf8")); } catch (cause) {
    throw new EditError("history-corrupt", "Edit history is unreadable; recovery requires manual inspection.", 500, { cause });
  }
}

async function historyRecords(historyDir) {
  try { await noLinks(historyDir, "directory"); } catch (failure) {
    if (failure.code === "ENOENT") return [];
    throw failure;
  }
  const entries = await fs.readdir(historyDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new EditError("unsafe-path", "Linked edit history is not supported.");
    if (entry.name === "lock") {
      if (!entry.isFile()) throw new EditError("unsafe-path", "Invalid edit lock.");
      continue;
    }
    if (!entry.isDirectory() || !/^\d{13}-[a-f0-9]{24}$/.test(entry.name)) {
      throw new EditError("history-corrupt", "Unrecognized entry in private edit history.", 500);
    }
    const path = join(historyDir, entry.name);
    const prepared = await optionalJson(join(path, "prepared.json"));
    const committed = await optionalJson(join(path, "committed.json"));
    if (!prepared) {
      records.push({ id: entry.name, status: "incomplete", needsReview: true });
      continue;
    }
    if (prepared.id !== entry.name || !/^[a-f0-9]{64}$/.test(prepared.baseRevision)
      || !/^[a-f0-9]{64}$/.test(prepared.revision) || typeof prepared.at !== "string"
      || !Array.isArray(prepared.changes) || prepared.needsReview !== true
      || (committed && (committed.id !== prepared.id || committed.revision !== prepared.revision))) {
      throw new EditError("history-corrupt", "Inconsistent edit transaction metadata.", 500);
    }
    records.push({ ...prepared, status: committed ? "committed" : "prepared" });
  }
  return records;
}

function snapshot(current, records, filename) {
  const html = decode(current.bytes);
  const info = inspectEditableHtml(html);
  const revision = hash(current.bytes);
  const unresolved = records.filter((record) => record.status !== "committed");
  const latest = [...records].reverse();
  const lastSave = unresolved.at(-1)
    ?? latest.find((record) => record.revision === revision)
    ?? latest[0] ?? null;
  const value = {
    ...info, filename, revision,
    status: unresolved.length ? "recovery-required" : lastSave ? "needs-review" : info.status,
    reviewHint: unresolved.length
      ? "An unfinished edit transaction requires manual recovery. Source and draft copies are retained; no automatic rollback or lock removal is performed."
      : lastSave ? `${info.fields.length ? "" : `${unsupportedHint} `}${reviewHint}` : info.reviewHint,
    // The UI needs a save summary, not private old text or recovery filenames.
    lastSave: lastSave ? {
      id: lastSave.id, at: lastSave.at, baseRevision: lastSave.baseRevision,
      revision: lastSave.revision, needsReview: true, status: lastSave.status,
      matchesCurrentRevision: lastSave.revision === revision,
    } : null,
  };
  // Private service-facing snapshot. JSON.stringify does not expose raw source.
  Object.defineProperties(value, {
    html: { value: html },
    buffer: { value: Buffer.from(current.bytes) },
  });
  return value;
}

async function withLock(historyDir, action) {
  const path = join(historyDir, "lock");
  let handle;
  try { handle = await fs.open(path, "wx", 0o600); } catch (cause) {
    if (cause.code === "EEXIST") {
      throw new EditError("source-locked", "Another editor or an interrupted save holds the lock. Locks are never automatically bypassed.", 423, { cause });
    }
    throw cause;
  }
  let result;
  let failure;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.sync();
    result = await action();
  } catch (cause) {
    failure = cause;
  }
  try {
    const owned = await handle.stat();
    await handle.close();
    const existing = await fs.lstat(path);
    if (existing.isSymbolicLink() || existing.dev !== owned.dev || existing.ino !== owned.ino) {
      throw new Error("Lock identity changed");
    }
    await fs.unlink(path);
    await syncDirectory(historyDir);
  } catch (cause) {
    if (!failure) failure = new EditError("lock-release-failed", "The edit lock could not be released. Read the source state before retrying; a save may have committed.", 500, { cause });
  }
  if (failure) throw failure;
  return result;
}

/**
 * Returns { read(), save({revision, changes}), history() }.
 * read/save return {title, filename, revision, slides, fields, eligibleCount,
 * status, reviewHint, lastSave}, with non-enumerable html:string and buffer:Buffer.
 * history() is private coordinator metadata, not a public HTTP endpoint.
 * Sources outside a repository are supported. Symlink components, generated
 * renders/recovery copies, non-regular files and non-.html sources are rejected.
 */
export async function openEditableSource(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath || control.test(sourcePath)
    || extname(sourcePath).toLowerCase() !== ".html") {
    throw new EditError("invalid-source-path", "Choose a normal .html source file.");
  }
  const selected = resolve(sourcePath);
  const parts = selected.slice(parsePath(selected).root.length).split(/[\\/]/);
  if (parts.some((part) => part.includes(":"))) throw new EditError("unsafe-path", "Alternate-stream paths are not supported.");
  if (parts.some((part) => ["_renders", ".nice-deck-edit"].includes(part.toLowerCase()))
    || (basename(dirname(selected)).toLowerCase() === "site"
      && /^[a-f0-9]{12,64}$/i.test(basename(dirname(dirname(selected)))))) {
    throw new EditError("generated-source", "Choose authored HTML, not a generated render or recovery copy.");
  }
  try {
    await noLinks(selected, "file");
    const canonical = await fs.realpath(selected);
    const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    const root = join(dirname(canonical), ".nice-deck-edit");
    const historyDir = join(root, hash(key));
    const filename = basename(canonical);
    const readCurrent = () => readNormal(canonical);
    const read = () => enqueue(key, async () => {
      try {
        return snapshot(await readCurrent(), await historyRecords(historyDir), filename);
      } catch (cause) {
        if (cause instanceof EditError) throw cause;
        throw new EditError("read-failed", "The source or private edit history could not be read.", 500, { cause });
      }
    });
    // Fail early on unsupported source bytes/markup and unsafe history paths.
    await read();
    return {
      read,
      history: () => enqueue(key, () => historyRecords(historyDir)),
      save(request) {
        // Copy the request before queuing: callers cannot mutate pending edits.
        if (!request || typeof request !== "object" || Array.isArray(request)
          || Object.keys(request).some((name) => !["revision", "changes"].includes(name))
          || typeof request.revision !== "string" || !/^[a-f0-9]{64}$/.test(request.revision)) {
          return Promise.reject(new EditError("invalid-request", "Save requires a SHA-256 revision and bounded changes only."));
        }
        let changes;
        try {
          validateChanges(request.changes);
          changes = request.changes.map(({ id, oldText, text, kind }) => ({ id, oldText, text, ...(kind ? { kind } : {}) }));
        } catch (cause) {
          return Promise.reject(cause);
        }
        const revision = request.revision;
        return enqueue(key, async () => {
          let transactionId;
          let renameAttempted = false;
          let stage = "acquire lock";
          try {
            await privateDirectory(root);
            await privateDirectory(historyDir);
            if (process.platform !== "win32" && ((await fs.lstat(historyDir)).mode & 0o077)) {
              throw new EditError("unsafe-history-permissions", "The per-source history directory must be private (0700).");
            }
            await syncDirectory(dirname(root));
            await syncDirectory(root);
            return await withLock(historyDir, async () => {
              stage = "validate current source";
              const current = await readCurrent();
              const baseRevision = hash(current.bytes);
              if (baseRevision !== revision) throw new EditError("revision-conflict", "Source revision changed. Reload before saving.", 409);
              const records = await historyRecords(historyDir);
              if (records.some((record) => record.status !== "committed")) {
                throw new EditError("recovery-required", "An unfinished transaction must be manually resolved before another save.", 409);
              }
              const html = decode(current.bytes);
              const inspection = inspect(html);
              const patched = patch(html, changes, inspection);
              if (!patched.effective.length) return snapshot(current, records, filename);
              const draft = Buffer.from(patched.html, "utf8");
              const nextRevision = hash(draft);
              // Reparse before touching disk to ensure all new text remains text.
              const next = inspectEditableHtml(patched.html);
              for (const change of patched.effective) {
                if (change.kind === "slide") continue;
                if (next.fields.find((field) => field.id === change.id)?.text !== change.text) {
                  throw new EditError("unsafe-patch", "Edited text did not round-trip safely.", 422);
                }
              }
              stage = "prepare recovery copies";
              transactionId = `${Date.now()}-${randomBytes(12).toString("hex")}`;
              const transaction = join(historyDir, transactionId);
              await fs.mkdir(transaction, { mode: 0o700 });
              await syncDirectory(historyDir);
              await durableFile(join(transaction, "before.html"), current.bytes);
              await durableFile(join(transaction, "after.html"), draft);
              const temporaryFilename = `.nice-deck-${randomBytes(16).toString("hex")}.tmp`;
              const temporary = join(dirname(canonical), temporaryFilename);
              await durableFile(temporary, draft, current.stat.mode & 0o7777);
              const record = {
                id: transactionId, baseRevision, revision: nextRevision,
                changes: patched.effective, at: new Date().toISOString(),
                needsReview: true, reviewHint, temporaryFilename,
              };
              await durableFile(join(transaction, "prepared.json"), JSON.stringify(record));
              await syncDirectory(transaction);
              await syncDirectory(dirname(canonical));
              stage = "recheck current revision";
              const immediate = await readCurrent();
              if (hash(immediate.bytes) !== baseRevision || (immediate.stat.mode & 0o7777) !== (current.stat.mode & 0o7777)) {
                throw new EditError("revision-conflict", "Source changed while the edit was prepared. Recovery copies were retained.", 409);
              }
              stage = "replace source";
              renameAttempted = true;
              await fs.rename(temporary, canonical);
              await syncDirectory(dirname(canonical));
              stage = "verify replacement";
              const after = await readCurrent();
              if (hash(after.bytes) !== nextRevision) {
                throw new EditError("save-raced", "Source changed during replacement. No automatic rollback was attempted; inspect recovery copies.", 409);
              }
              stage = "record commit";
              await durableFile(join(transaction, "committed.json"), JSON.stringify({
                id: transactionId, revision: nextRevision, at: new Date().toISOString(),
              }));
              await syncDirectory(transaction);
              return snapshot(after, [...records, { ...record, status: "committed" }], filename);
            });
          } catch (cause) {
            const failure = cause instanceof EditError ? cause : new EditError(
              "save-failed",
              `Save failed during ${stage}. ${renameAttempted ? "The source may already contain the draft." : "No source replacement was attempted."} `
                + "Any recovery copies and temporary draft are retained; read the state before retrying.",
              500, { cause },
            );
            if (transactionId) {
              failure.transactionId = transactionId;
              failure.sourceMayHaveChanged = renameAttempted;
            }
            throw failure;
          }
        });
      },
    };
  } catch (cause) {
    if (cause instanceof EditError) throw cause;
    throw new EditError("open-failed", "The selected HTML source could not be opened safely.", 400, { cause });
  }
}
