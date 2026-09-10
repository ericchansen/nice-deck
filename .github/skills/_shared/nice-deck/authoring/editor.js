/* The authoring layer lives only in this tab. Saves contain bounded source patches, never DOM. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("deck-frame");
  const sourceView = $("slide-source");
  let sourceSlideId = null;
  const sourceDrafts = new Map();
  const previewSources = new Map();
  const sourceSelections = new Map();
  let sourceTimer;
  let sourceGeneration = 0;
  let sourcePending = false;
  let sourceInvalid = false;
  let sourceComposing = false;
  let sourceDisplayed = "";
  const storageKey = "nice-deck:session-key";
  const fieldAttribute = "data-nice-deck-edit-field";
  const selectedAttribute = "data-nice-deck-edit-selected";
  const temporaryAttributes = [
    fieldAttribute, selectedAttribute, "contenteditable", "tabindex",
    "aria-label", "aria-multiline", "role", "spellcheck",
  ];
  const newline = /[\r\n\u2028\u2029]/;
  let token = "";
  let state = null;
  let fields = new Map();
  let bindings = new Map();
  let textFields = new WeakMap();
  let drafts = new Map();
  let versions = new Map();
  let sequence = 0;
  let undoStack = [];
  let redoStack = [];
  let historyGroup = 0;
  let selectedId = null;
  let highlighted = null;
  let slideIndex = 0;
  let mode = "edit";
  let ready = false;
  let saving = false;
  let reloading = false;
  let conflict = false;
  let saveError = false;
  let composing = null;
  let compositionTimer = null;
  let deferred = [];
  let runtime = null;
  let runtimeStyle = null;
  let frameEvents = null;
  let frameGeneration = 0;
  let connectedDocument = null;
  let navigating = false;
  let checks = { state: "idle" };
  let checkTimer = null;
  let checkRequest = false;
  let recoverySequence = -1;
  let statusTimer = null;

  function basename(value) {
    return String(value || "").split(/[\\/]/).pop();
  }

  // Service errors may contain local filenames. Never render credentials or absolute paths.
  function publicText(value) {
    let text = String(value || "");
    if (token) text = text.split(token).join("[session]");
    return text
      .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>]*/g, "[local file]")
      .replace(/\\\\[^ \r\n"'<>]+/g, "[local file]")
      .replace(/(?:\/(?:Users|home|tmp|var|private|mnt|opt)\/)[^\r\n"'<>]*/g, "[local file]");
  }

  function announce(message) {
    clearTimeout(statusTimer);
    $("announcement").textContent = "";
    statusTimer = setTimeout(() => { $("announcement").textContent = publicText(message); }, 30);
  }

  function showError(message) {
    $("settings").open = true;
    $("error-message").textContent = publicText(message);
    $("error-panel").hidden = false;
  }

  function fieldError(message) {
    if (message) announce(message);
  }

  function invalid(text) {
    return !text.trim() || text.length > 5000 ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
  }

  function valueOf(id) {
    return drafts.has(id) ? drafts.get(id).text : fields.get(id)?.text ?? "";
  }

  function isDirty() {
    return drafts.size > 0 || sourceDrafts.size > 0 || Boolean(composing) || sourceComposing;
  }

  function sameOriginURL(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || url.username || url.password) return null;
      if (token && url.href.includes(token)) return null;
      if ([...url.searchParams.keys()].some((key) => /^(key|token|authorization)$/i.test(key))) return null;
      return url.href;
    } catch { return null; }
  }

  function previewURL(value) {
    // Canonical preview may run on its own loopback port, unlike the source iframe.
    const local = sameOriginURL(value);
    if (local) return local;
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) ||
          !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
          url.username || url.password || (token && url.href.includes(token)) ||
          [...url.searchParams.keys()].some((key) => /^(key|token|authorization)$/i.test(key))) return null;
      return url.href;
    } catch { return null; }
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`The local service returned an unreadable response (${response.status}).`); }
    if (!response.ok) {
      const error = new Error(publicText(result?.error?.message || `The request failed (${response.status}).`));
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  }

  function validateState(next) {
    if (!next || !Array.isArray(next.slides) || !Array.isArray(next.fields) ||
        next.revision === undefined || !sameOriginURL(next.deckUrl)) {
      throw new Error("The local service returned an incomplete deck manifest. Editing is disabled.");
    }
    const ids = new Set();
    const slideIds = new Set();
    const indices = new Set();
    for (const slide of next.slides) {
      if (typeof slide.id !== "string" || slideIds.has(slide.id) ||
          (slide.source !== null && typeof slide.source !== "string") ||
          !Number.isInteger(slide.index) || slide.index < 0 || slide.index >= next.slides.length ||
          indices.has(slide.index)) throw new Error("The slide manifest is inconsistent. Editing is disabled.");
      slideIds.add(slide.id);
      indices.add(slide.index);
    }
    for (const field of next.fields) {
      if (typeof field.id !== "string" || ids.has(field.id) || !slideIds.has(field.slideId) ||
          typeof field.tag !== "string" || !/^[a-z][a-z0-9]*$/.test(field.tag) ||
          typeof field.text !== "string" || !Array.isArray(field.path) ||
          (!field.path.length && field.textNode === undefined) ||
          field.path.some((part) => !Number.isInteger(part) || part < 0) ||
          (field.textNode !== undefined && (!Number.isInteger(field.textNode) || field.textNode < 0)) ||
          (field.namespace !== undefined && !["html", "svg"].includes(field.namespace))) {
        throw new Error("The text manifest is inconsistent. Editing is disabled.");
      }
      ids.add(field.id);
      if (field.sourceRange !== undefined) {
        const slide = next.slides.find((item) => item.id === field.slideId);
        const { start, end } = field.sourceRange;
        if (typeof slide.source !== "string" || !Number.isInteger(start) || !Number.isInteger(end) ||
            start < 0 || end <= start || end > slide.source.length) {
          throw new Error("The source ranges are inconsistent. Editing is disabled.");
        }
      }
    }
    return next;
  }

  function sameManifest(next) {
    if (next.fields.length !== fields.size || next.slides.length !== state.slides.length) return false;
    return next.fields.every((field) => {
      const old = fields.get(field.id);
      return old && old.tag === field.tag && old.slideId === field.slideId &&
        old.textNode === field.textNode && old.namespace === field.namespace &&
        JSON.stringify(old.path) === JSON.stringify(field.path);
    }) && next.slides.every((slide) => state.slides.some((old) =>
      old.id === slide.id && old.anchor === slide.anchor && old.index === slide.index));
  }

  function fieldLabel(field) {
    return publicText(field.label || `${field.tag.toUpperCase()} text`);
  }

  function renderDocument() {
    $("deck-title").textContent = publicText(state.title || basename(state.filename) || "Untitled deck");
    $("filename").textContent = publicText(basename(state.filename) || "HTML document");
    document.title = `${publicText(state.title || "Local editor")} · nice-deck`;
    const savedURL = sameOriginURL(state.deckUrl);
    $("open-saved").href = savedURL;
    $("open-saved").hidden = !savedURL;
    const select = $("slide-select");
    select.replaceChildren();
    [...state.slides].sort((a, b) => a.index - b.index).forEach((slide) => {
      const option = document.createElement("option");
      option.value = String(slide.index);
      option.textContent = `${String(slide.index + 1).padStart(2, "0")}  ${publicText(slide.title || `Slide ${slide.index + 1}`)}`;
      if (slide.section) option.textContent += ` · ${publicText(slide.section)}`;
      select.append(option);
    });
    renderSlide();
  }

  function renderSlide() {
    if (!state) return;
    $("slide-select").value = String(slideIndex);
    $("slide-position").textContent = `${slideIndex + 1} / ${state.slides.length}`;
    const slide = state.slides.find((item) => item.index === slideIndex);
    const currentFields = [...fields.values()].filter((field) => field.slideId === slide?.id);
    if (!currentFields.some((field) => field.id === selectedId)) selectedId = currentFields[0]?.id || null;
    syncSelection();
    renderStatus();
  }

  function syncSelection() {
    const field = fields.get(selectedId);
    if (field) {
      const bad = invalid(valueOf(field.id));
      if (bad) fieldError("Use a nonempty single line, up to 5,000 characters, without control characters.");
      const binding = bindings.get(field.id);
      const node = binding?.node;
      let box = node?.getBoundingClientRect();
      if (binding?.textNode) {
        const range = node.ownerDocument.createRange();
        range.selectNode(binding.textNode);
        box = range.getBoundingClientRect();
      }
      const slide = node?.closest(".slide")?.getBoundingClientRect();
      const escaped = box && slide && (box.bottom > slide.bottom + 1 || box.right > slide.right + 1
        || box.top < slide.top - 1 || box.left < slide.left - 1);
      if (escaped) announce("This text extends beyond the slide. Shorten it and check its layout before presenting.");
    }
    renderSource();
    const binding = bindings.get(selectedId);
    const selection = mode === "edit" && ready && binding?.inline ? binding : null;
    if (highlighted && highlighted.node !== selection?.node) restoreAttribute(highlighted, selectedAttribute);
    if (selection) {
      selection.node.setAttribute(selectedAttribute, "");
      selection.node.setAttribute(fieldAttribute, selectedId);
    }
    highlighted = selection;
  }

  function renderSource() {
    if (sourceComposing) return;
    const slide = state?.slides.find((item) => item.index === slideIndex);
    if (!slide) return;
    let text = sourceDrafts.get(slide.id) ?? slide.source;
    // Textareas normalize CRLF and CR to LF; source-backed offsets stay intact.
    const displayText = (value) => value.replace(/\r\n?/g, "\n");
    if (typeof text === "string" && !sourceDrafts.has(slide.id)) {
      const edits = [...fields.values()].filter((field) => field.slideId === slide.id && field.sourceRange)
        .sort((a, b) => a.sourceRange.start - b.sourceRange.start);
      let cursor = 0;
      let projected = "";
      for (const field of edits) {
        const { start, end } = field.sourceRange;
        projected += displayText(text.slice(cursor, start));
        const value = drafts.has(field.id)
          ? displayText(valueOf(field.id)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          : displayText(text.slice(start, end));
        projected += value;
        cursor = end;
      }
      text = projected + displayText(text.slice(cursor));
    } else if (typeof text !== "string") {
      text = "Source unavailable: this slide has no explicit closing tag. No live DOM substitute is shown.";
    }
    if (sourceView.value !== text) {
      if (sourceSlideId) sourceSelections.set(sourceSlideId, {
        start: sourceView.selectionStart, end: sourceView.selectionEnd,
        top: sourceView.scrollTop, left: sourceView.scrollLeft,
      });
      const top = sourceView.scrollTop;
      const left = sourceView.scrollLeft;
      sourceView.value = text;
      sourceView.scrollTop = sourceSlideId === slide.id ? top : 0;
      sourceView.scrollLeft = sourceSlideId === slide.id ? left : 0;
      const selection = sourceSelections.get(slide.id);
      if (selection) {
        sourceView.setSelectionRange(selection.start, selection.end);
        sourceView.scrollTop = selection.top;
        sourceView.scrollLeft = selection.left;
      }
    }
    sourceSlideId = slide.id;
    sourceDisplayed = sourceView.value;
    const slideDirty = [...drafts.keys()].some((id) => fields.get(id)?.slideId === slide.id);
    $("source-label").textContent = `Slide ${slideIndex + 1} HTML source${slideDirty || sourceDrafts.has(slide.id) ? " · draft" : ""}`;
  }

  function sourceChanges() {
    return [...sourceDrafts].map(([id, text]) => ({
      kind: "slide", id, oldText: state.slides.find((slide) => slide.id === id).source, text,
    }));
  }

  function setSourceDraft(id, text) {
    // Keep an entry even when undo returns to disk: the preview still needs reverting.
    sourceDrafts.set(id, text);
    sourceGeneration++;
    sequence++;
    sourcePending = true;
    sourceInvalid = false;
    clearTimeout(sourceTimer);
    sourceTimer = setTimeout(validateSourceDrafts, 250);
    renderStatus();
  }

  function recordSource(id, text) {
    const before = sourceDrafts.get(id) ?? sourceDisplayed;
    if (before === text) return;
    // Promote pending inline edits to source transactions, retaining their history.
    if (!sourceDrafts.has(id)) {
      const values = new Map([...fields.values()].filter((field) => field.slideId === id).map((field) => [field.id, valueOf(field.id)]));
      const project = () => {
        let raw = state.slides.find((slide) => slide.id === id).source.replace(/\r\n?/g, "\n");
        const base = state.slides.find((slide) => slide.id === id).source;
        for (const field of [...fields.values()].filter((field) => field.slideId === id && field.sourceRange)
          .sort((a, b) => b.sourceRange.start - a.sourceRange.start)) {
          const start = base.slice(0, field.sourceRange.start).replace(/\r\n?/g, "\n").length;
          const end = base.slice(0, field.sourceRange.end).replace(/\r\n?/g, "\n").length;
          if (values.get(field.id) !== field.text) raw = raw.slice(0, start) +
            values.get(field.id).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + raw.slice(end);
        }
        return raw;
      };
      for (let index = undoStack.length - 1; index >= 0; index--) {
        const entry = undoStack[index];
        if (!values.has(entry.id)) continue;
        const after = project();
        values.set(entry.id, entry.before);
        undoStack[index] = { sourceId: id, before: project(), after };
      }
      for (const field of fields.values()) if (field.slideId === id) drafts.delete(field.id);
    }
    undoStack.push({ sourceId: id, before, after: text });
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    setSourceDraft(id, text);
    renderSource();
  }

  // Compare authored trees, not live serialization: unchanged nodes (including
  // calculator frames and runtime mutations) keep their object identity/state.
  function patchPreview(slide, before, after) {
    const doc = frame.contentDocument;
    const inert = (html) => {
      const template = doc.createElement("template");
      template.innerHTML = html;
      return template.content.firstElementChild;
    };
    const oldTree = inert(before);
    const newTree = inert(after);
    const live = [...doc.querySelectorAll(".slide")][slide.index];
    const blocked = new Set(["script", "iframe", "object", "embed", "base", "meta", "link",
      "animate", "set", "animatemotion", "animatetransform"]);
    const safeAttribute = (name, value) => !/^on/i.test(name) && !["srcdoc", "is"].includes(name) &&
      !/^(?:javascript:|vbscript:|data:text\/html)/i.test(value.replace(/[\u0000-\u0020]/g, ""));
    const clean = (node) => {
      if (node.nodeType !== 1) return;
      if (blocked.has(node.localName.toLowerCase())) {
        const placeholder = document.createElement("span");
        placeholder.hidden = true;
        placeholder.setAttribute("data-nice-deck-inactive", node.tagName.toLowerCase());
        node.replaceWith(placeholder);
        return;
      }
      for (const attribute of [...node.attributes]) if (!safeAttribute(attribute.name, attribute.value)) node.removeAttribute(attribute.name);
      for (const child of [...node.childNodes]) clean(child);
      if (node.content) for (const child of [...node.content.childNodes]) clean(child);
    };
    const copy = (node) => {
      const container = document.createElement("template");
      container.content.append(node.cloneNode(true));
      clean(container.content.firstChild);
      return doc.importNode(container.content.firstChild, true);
    };
    const update = (target, oldNode, newNode) => {
      if (oldNode.isEqualNode(newNode)) return;
      if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName ||
          (newNode.nodeType === 1 && blocked.has(newNode.localName.toLowerCase()))) {
        target.replaceWith(copy(newNode));
        return;
      }
      if (newNode.nodeType !== 1) { target.nodeValue = newNode.nodeValue; return; }
      const styleChanged = oldNode.getAttribute("style") !== newNode.getAttribute("style");
      const classChanged = oldNode.getAttribute("class") !== newNode.getAttribute("class");
      if (styleChanged) {
        for (const name of oldNode.style) if (!newNode.style.getPropertyValue(name)) target.style.removeProperty(name);
        for (const name of newNode.style) target.style.setProperty(name, newNode.style.getPropertyValue(name), newNode.style.getPropertyPriority(name));
      }
      if (classChanged) {
        for (const name of oldNode.classList) if (!newNode.classList.contains(name)) target.classList.remove(name);
        for (const name of newNode.classList) target.classList.add(name);
      }
      for (const attribute of [...oldNode.attributes]) {
        if (!["style", "class"].includes(attribute.name) && !newNode.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
      }
      for (const attribute of [...newNode.attributes]) {
        if (["style", "class"].includes(attribute.name)) continue;
        if (oldNode.getAttribute(attribute.name) !== attribute.value) {
          if (safeAttribute(attribute.name, attribute.value)) target.setAttribute(attribute.name, attribute.value);
          else target.removeAttribute(attribute.name);
        }
      }
      const oldChildren = [...oldNode.childNodes];
      const newChildren = [...newNode.childNodes];
      const targets = [...target.childNodes];
      // Anchor every unchanged subsequence, not just the edges of the edit.
      // Never detach/reinsert anchors: even moving an iframe can reset its state.
      const lengths = Array.from({ length: oldChildren.length + 1 },
        () => new Uint32Array(newChildren.length + 1));
      for (let i = oldChildren.length - 1; i >= 0; i--) {
        for (let j = newChildren.length - 1; j >= 0; j--) {
          lengths[i][j] = oldChildren[i].isEqualNode(newChildren[j])
            ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
      }
      const anchors = [];
      let i = 0, j = 0;
      while (i < oldChildren.length && j < newChildren.length) {
        if (oldChildren[i].isEqualNode(newChildren[j])) { anchors.push([i++, j++]); }
        else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
        else j++;
      }
      anchors.push([oldChildren.length, newChildren.length]);
      let oldStart = 0, newStart = 0;
      for (const [oldEnd, newEnd] of anchors) {
        const common = Math.min(oldEnd - oldStart, newEnd - newStart);
        for (let offset = 0; offset < common; offset++) {
          update(targets[oldStart + offset], oldChildren[oldStart + offset], newChildren[newStart + offset]);
        }
        for (let offset = oldStart + common; offset < oldEnd; offset++) targets[offset]?.remove();
        for (let offset = newStart + common; offset < newEnd; offset++) {
          target.insertBefore(copy(newChildren[offset]), targets[oldEnd] ?? null);
        }
        oldStart = oldEnd + 1;
        newStart = newEnd + 1;
      }
    };
    update(live, oldTree, newTree);
  }

  async function validateSourceDrafts() {
    if (sourceComposing || saving) return;
    const generation = sourceGeneration;
    try {
      const next = await api("/api/draft", { revision: state.revision, changes: sourceChanges() });
      if (generation !== sourceGeneration) return;
      // Remove only editor-owned attributes before reconciling source trees.
      for (const binding of bindings.values()) for (const attribute of temporaryAttributes) restoreAttribute(binding, attribute);
      for (const [id, text] of sourceDrafts) {
        const slide = state.slides.find((item) => item.id === id);
        patchPreview(slide, previewSources.get(id) ?? slide.source, text);
        previewSources.set(id, text);
        for (const [key, field] of fields) if (field.slideId === id) fields.delete(key);
        for (const field of next.fields.filter((item) => item.slideId === id)) fields.set(field.id, field);
        if (text === slide.source.replace(/\r\n?/g, "\n")) {
          sourceDrafts.delete(id);
          previewSources.set(id, slide.source);
          for (const [key, field] of fields) if (field.slideId === id) fields.delete(key);
          for (const field of state.fields.filter((item) => item.slideId === id)) fields.set(field.id, field);
        }
      }
      bindings.clear();
      connectedDocument = null;
      await connectFrame({ preserveNavigation: true });
      if (generation !== sourceGeneration) return;
      sourcePending = sourceInvalid = false;
      $("source-status").textContent = "Live HTML draft · not saved. Changed executable content requires save and reopen.";
    } catch (error) {
      if (generation !== sourceGeneration) return;
      sourcePending = false;
      sourceInvalid = true;
      if (error.status === 409) {
        conflict = true;
        $("settings").open = true;
      }
      $("source-status").textContent = `Last good preview retained. ${publicText(error.message)}`;
      announce($("source-status").textContent);
    }
    renderStatus();
  }

  function finishSave() {
    saving = false;
    // The debounce may have fired while saving and skipped validation.
    // Retry against the acknowledged revision (or let validation report conflict).
    if (sourcePending) { clearTimeout(sourceTimer); sourceTimer = setTimeout(validateSourceDrafts, 0); }
    renderStatus();
  }

  async function saveSource() {
    if (!ready || saving || conflict || reloading || sourceInvalid || sourcePending) return;
    const submitted = sourceChanges();
    const textSubmitted = [...drafts].map(([id, draft]) => ({ id, oldText: fields.get(id).text, text: draft.text }));
    if (textSubmitted.some((change) => invalid(change.text))) return;
    saving = true;
    renderStatus();
    try {
      const next = validateState(await api("/api/save", { revision: state.revision, changes: [...submitted, ...textSubmitted] }));
      state = next;
      for (const change of submitted) if (sourceDrafts.get(change.id) === change.text) sourceDrafts.delete(change.id);
      for (const change of textSubmitted) if (drafts.get(change.id)?.text === change.text) drafts.delete(change.id);
      for (const field of next.fields) if (!sourceDrafts.has(field.slideId)) fields.set(field.id, field);
      checks = next.checks || { state: "idle" };
      saveError = false;
      renderDocument();
      scheduleChecks();
      announce("Source saved. Reopen saved HTML to test changed scripts and applications.");
    } catch (error) {
      saveError = true;
      if (error.status === 409) conflict = true;
      showError(error.message);
    } finally {
      finishSave();
    }
  }

  function renderStatus() {
    const dirty = isDirty();
    if (state && !dirty && !sourcePending && !sourceInvalid) {
      $("source-status").textContent = "Live HTML preview · no pending changes. Reopen saved HTML to test changed executable content.";
    }
    const invalidDraft = [...drafts.values()].some((draft) => invalid(draft.text));
    let message = !state ? "Connecting…" : dirty ? `${drafts.size + sourceDrafts.size || 1} unsaved changes` : "Saved · no pending changes";
    if (sourcePending) message = "Validating HTML · unsaved";
    if (sourceInvalid) message = "Invalid HTML · last good preview · unsaved";
    if (reloading) message = "Reloading the saved source…";
    else if (saving) message = "Saving… You can keep typing.";
    else if (conflict) message = "File changed · draft retained";
    else if (saveError) message = "Save failed · draft retained";
    else if (state?.status === "recovery-required") message = "Source recovery required · draft retained";
    else if (!ready && state) message = "Editing unavailable";
    const status = $("save-status");
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = conflict || saveError ? "error" : dirty ? "dirty" : "saved";
    sourceView.disabled = !ready || reloading || state?.slides.find((slide) => slide.index === slideIndex)?.source === null;
    $("save").disabled = !ready || saving || reloading || conflict || (!drafts.size && !sourceDrafts.size) || invalidDraft || sourcePending || sourceInvalid || sourceComposing
      || state?.status === "recovery-required";
    $("undo").disabled = !ready || !undoStack.length;
    $("redo").disabled = !ready || !redoStack.length;
    $("download-draft").disabled = !state;
    $("conflict-download").disabled = !state;
    $("reload-disk").disabled = saving || reloading;
    $("edit-mode").disabled = !ready;
    $("read-mode").disabled = !state;
    $("slide-select").disabled = !runtime || navigating;
    $("previous-slide").disabled = !runtime || navigating || slideIndex <= 0;
    $("next-slide").disabled = !runtime || navigating || !state || slideIndex >= state.slides.length - 1;
    $("conflict-panel").hidden = !conflict;
    renderChecks();
  }

  function reviewText() {
    if (state.imported) return "Imported draft — approval metadata unavailable";
    if (isDirty()) return "Unsaved draft — these changes have not been reviewed";
    if (conflict) return "Source changed — review status needs a reload";
    const currentCheck = checks.sourceRevision === state.revision;
    const status = currentCheck && checks.reviewStatus ? checks.reviewStatus : state.reviewStatus;
    switch (String(status || "").toLowerCase()) {
      case "approved": return "Saved source · approved";
      case "draft": return "Saved source · draft, not approved";
      case "pending": return "Saved source · review pending";
      case "missing": case "unavailable": case "unknown": case "":
        return "Saved source · approval metadata unavailable";
      default: return `Saved source · review: ${publicText(status)}`;
    }
  }

  function renderChecks() {
    if (!state) return;
    $("review-status").textContent = reviewText();
    const current = checks.sourceRevision === state.revision;
    let text = "Slide checks have not run. Checks use saved HTML, not unsaved edits.";
    if (checks.state === "running") text = "Checking saved slides… Your draft stays in this tab.";
    if (checks.state === "complete") {
      text = checks.ok ? "Saved-slide checks passed." : "Saved-slide checks need attention.";
      const findings = Object.entries(checks.counts || {}).filter(([, count]) => Number(count) > 0);
      if (findings.length) text += ` ${findings.map(([name, count]) => `${name}: ${count}`).join("; ")}.`;
      if (!current) text += " These results are for a different or unverified source revision.";
      if (isDirty()) text += " Unsaved edits are not included.";
    }
    if (checks.state === "error") text = `Checks could not finish. ${publicText(checks.message || "Please try again.")}`;
    if ($("check-status").textContent !== text) $("check-status").textContent = text;
    $("check-slides").disabled = !state || saving || reloading || conflict || checkRequest || checks.state === "running";
    const url = previewURL(checks.url);
    $("check-link").hidden = !url;
    if (url) $("check-link").href = url;
    else $("check-link").removeAttribute("href");
  }

  function selectField(id) {
    if (!fields.has(id)) return;
    if (selectedId !== id) {
      historyGroup++;
      selectedId = id;
      fieldError("");
    }
    syncSelection();
  }

  function recordChange(id, text, { discrete = false, origin = null } = {}) {
    if (!ready || !fields.has(id)) return;
    const sourceField = fields.get(id);
    if (sourceDrafts.has(sourceField.slideId)) {
      if (sourcePending || sourceInvalid || invalid(text) || !sourceField.sourceRange) {
        syncNode(id);
        announce("Finish valid HTML source before editing slide text.");
        return;
      }
      const raw = previewSources.get(sourceField.slideId);
      const { start, end } = sourceField.sourceRange;
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      recordSource(sourceField.slideId, raw.slice(0, start) + escaped + raw.slice(end));
      return;
    }
    const before = valueOf(id);
    if (before === text) return;
    const now = Date.now();
    const last = undoStack.at(-1);
    if (!discrete && last && last.id === id && last.after === before &&
        last.group === historyGroup && now - last.time < 1000 && !redoStack.length) {
      last.after = text;
      last.time = now;
      if (last.before === last.after) undoStack.pop();
    } else {
      undoStack.push({ id, before, after: text, group: historyGroup, time: now });
      if (undoStack.length > 100) undoStack.shift();
    }
    if (discrete) historyGroup++;
    redoStack = [];
    setDraft(id, text);
    saveError = false;
    if (origin !== "frame") syncNode(id);
    syncSelection();
    fieldError(invalid(text) ? "Use a nonempty single line, up to 5,000 characters, without control characters." : "");
    renderStatus();
  }

  function setDraft(id, text) {
    const version = ++sequence;
    versions.set(id, version);
    if (text === fields.get(id).text) drafts.delete(id);
    else drafts.set(id, { text, sequence: version });
  }

  function putCaretAtEnd(node) {
    const doc = node.ownerDocument;
    const selection = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function syncNode(id, caret = false) {
    const binding = bindings.get(id);
    const node = binding?.node;
    if (!node || composing?.id === id) return;
    const text = valueOf(id);
    if (binding.textNode) {
      if (binding.textNode.data !== text) binding.textNode.data = text;
      return;
    }
    if (node.textContent !== text) {
      const active = node.ownerDocument.activeElement === node;
      node.textContent = text;
      if (active || caret) putCaretAtEnd(node);
    } else if (caret) putCaretAtEnd(node);
  }

  function undoRedo(direction) {
    afterComposition(() => {
      if (!ready) return;
      const from = direction === "undo" ? undoStack : redoStack;
      const to = direction === "undo" ? redoStack : undoStack;
      const transaction = from.pop();
      if (!transaction) return;
      if (transaction.sourceId) {
        to.push(transaction);
        const slide = state.slides.find((item) => item.id === transaction.sourceId);
        setSourceDraft(transaction.sourceId, direction === "undo" ? transaction.before : transaction.after);
        if (slide.index !== slideIndex) navigate(slide.index);
        renderSource();
        renderStatus();
        return;
      }
      historyGroup++;
      setDraft(transaction.id, direction === "undo" ? transaction.before : transaction.after);
      to.push(transaction);
      const field = fields.get(transaction.id);
      const slide = state.slides.find((item) => item.id === field.slideId);
      syncNode(transaction.id);
      const show = () => {
        fieldError("");
        selectField(transaction.id);
        syncSelection();
        renderStatus();
        announce(`${direction === "undo" ? "Undid" : "Redid"} change to ${fieldLabel(field)}.`);
      };
      if (slide.index !== slideIndex) navigate(slide.index).then(show);
      else show();
    }, direction === "undo" ? "undo" : "redo");
  }

  function afterComposition(action, description) {
    if (composing || sourceComposing) {
      deferred.push(action);
      announce(`Finish composing text to ${description}.`);
      return;
    }
    action();
  }

  function beginComposition(element, id, origin) {
    if (!ready || mode !== "edit") return;
    historyGroup++;
    composing = { element, id, origin };
    clearTimeout(compositionTimer);
    renderStatus();
  }

  function finishComposition() {
    // Some engines dispatch the final input AFTER compositionend.
    clearTimeout(compositionTimer);
    compositionTimer = setTimeout(() => {
      if (!composing) return;
      const { element, id, origin } = composing;
      const text = element.textContent;
      composing = null;
      recordChange(id, text, { discrete: true, origin });
      syncSelection();
      renderStatus();
      const actions = deferred;
      deferred = [];
      for (const action of actions) action();
    }, 0);
  }

  function historyShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      afterComposition(() => {
        if (sourcePending) {
          clearTimeout(sourceTimer);
          validateSourceDrafts().then(save);
        } else save();
      }, "save");
      return true;
    }
    if (key === "z" || (key === "y" && !event.metaKey)) {
      // Leave the IME's own undo alone while a candidate is being composed.
      if (event.isComposing || composing) return false;
      event.preventDefault();
      undoRedo(key === "y" || event.shiftKey ? "redo" : "undo");
      return true;
    }
    return false;
  }

  function ownedSelection(node, event) {
    const selection = node.ownerDocument.getSelection();
    if (!selection || !selection.rangeCount ||
        !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return false;
    if (event?.getTargetRanges) {
      for (const range of event.getTargetRanges()) {
        if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) return false;
      }
    }
    return true;
  }

  function selectionError(node) {
    fieldError("Keep your selection inside one editable field. Protected content was not changed.");
    putCaretAtEnd(node);
  }

  function frameField(target, event) {
    // Do not interpolate manifest IDs into selectors, and do not accept forged attributes.
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element || element.closest("nav,button,input,form,select,textarea,pre,code")) return null;
    let textNode = target?.nodeType === 3 ? target : null;
    if (!textNode && event && Number.isFinite(event.clientX)) {
      const doc = element.ownerDocument;
      textNode = doc.caretRangeFromPoint?.(event.clientX, event.clientY)?.startContainer
        ?? doc.caretPositionFromPoint?.(event.clientX, event.clientY)?.offsetNode;
    }
    const textId = textFields.get(textNode);
    if (textId && element.contains(textNode)) {
      const binding = bindings.get(textId);
      return { id: textId, ...binding };
    }
    const host = element?.closest(`[${fieldAttribute}]`);
    if (!host) return null;
    const id = host.getAttribute(fieldAttribute);
    const binding = bindings.get(id);
    return binding?.node === host ? { id, ...binding } : null;
  }

  function activeFrameField(doc) {
    const field = mode === "edit" && ready ? frameField(doc.activeElement) : null;
    return field?.inline ? field : null;
  }

  function chooseFrameField(field) {
    if (field.inline) selectField(field.id);
  }

  function bindFrameEvents(doc, win) {
    frameEvents?.abort();
    frameEvents = new AbortController();
    const on = (target, type, listener, capture = true) =>
      target.addEventListener(type, listener, { capture, signal: frameEvents.signal });

    on(doc, "focusin", (event) => {
      const field = frameField(event.target);
      if (field && mode === "edit") chooseFrameField(field);
    });
    on(doc, "click", (event) => {
      const field = frameField(event.target, event);
      if (field && mode === "edit") {
        chooseFrameField(field);
        if (!field.inline) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    });
    on(win, "click", (event) => {
      if (!ready || mode !== "edit") return;
      const field = frameField(event.target, event);
      if (field?.node.closest("a")) {
        event.preventDefault();
        event.stopPropagation();
        chooseFrameField(field);
      }
    });
    on(doc, "focusout", (event) => {
      if (frameField(event.target)) historyGroup++;
    });
    on(doc, "selectionchange", () => {
      const field = activeFrameField(doc);
      const selection = doc.getSelection();
      if (field && selection?.rangeCount && !ownedSelection(field.node)) selectionError(field.node);
    });
    for (const type of ["keydown", "keypress", "keyup"]) {
      on(doc, type, (event) => {
        const field = activeFrameField(doc);
        if (!field) return; // Native slide navigation and chart controls own all other keys.
        event.stopPropagation(); // Stops legacy document/window BUBBLE navigation, not text defaults.
        if (type !== "keydown") return;
        if (historyShortcut(event)) return;
        if (event.isComposing || composing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          fieldError("Use a single line of text. The slide will wrap it to fit its existing design.");
        }
        if (event.key === "Escape") afterComposition(() => field.node.blur(), "leave the field");
      });
    }
    on(doc, "compositionstart", (event) => {
      const field = activeFrameField(doc);
      if (field) {
        if (!ownedSelection(field.node)) selectionError(field.node);
        beginComposition(field.node, field.id, "frame");
      }
    });
    on(doc, "compositionend", () => { if (composing?.origin === "frame") finishComposition(); });
    on(doc, "beforeinput", (event) => {
      const field = activeFrameField(doc);
      if (!field) return;
      event.stopPropagation();
      if (!event.isComposing && !composing &&
          (event.inputType === "historyUndo" || event.inputType === "historyRedo")) {
        if (event.cancelable) {
          event.preventDefault();
          undoRedo(event.inputType === "historyUndo" ? "undo" : "redo");
        }
        return;
      }
      // Guard the selection even during IME input, before any protected DOM can be touched.
      if (!ownedSelection(field.node, event)) {
        event.preventDefault();
        selectionError(field.node);
        return;
      }
      if (event.isComposing || composing) return;
      if (["insertParagraph", "insertLineBreak", "insertFromDrop", "insertFromPaste", "insertFromPasteAsQuotation"].includes(event.inputType) ||
          event.inputType?.startsWith("format") || (event.data && newline.test(event.data))) {
        event.preventDefault();
        fieldError("Only single-line plain text can be inserted here. Paste text to replace line breaks with spaces.");
      }
    });
    on(doc, "input", (event) => {
      const field = frameField(event.target);
      if (!field || mode !== "edit" || !ready || composing || event.isComposing) return;
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        // Reconcile engines that emit a non-cancelable native history event.
        syncNode(field.id);
        undoRedo(event.inputType === "historyUndo" ? "undo" : "redo");
        return;
      }
      recordChange(field.id, field.node.textContent, { origin: "frame" });
    });
    on(doc, "paste", (event) => {
      const field = activeFrameField(doc);
      if (!field) return;
      event.preventDefault();
      event.stopPropagation();
      if (composing || sourceComposing) {
        fieldError("Finish composing before pasting text.");
        return;
      }
      if (!ownedSelection(field.node)) { selectionError(field.node); return; }
      if (!event.clipboardData) { fieldError("Clipboard text is unavailable. Paste into the text panel instead."); return; }
      if (!event.clipboardData.types.includes("text/plain")) { fieldError("Only plain-text clipboard content can be pasted."); return; }
      const original = event.clipboardData.getData("text/plain");
      const text = original.replace(/\r\n|[\r\n\u2028\u2029]/g, " ");
      const selection = doc.getSelection();
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = doc.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      recordChange(field.id, field.node.textContent, { discrete: true, origin: "frame" });
      if (original !== text) announce("Pasted as plain text. Line breaks were replaced with spaces.");
    });
    on(doc, "cut", (event) => {
      const field = activeFrameField(doc);
      if (field && (composing || !ownedSelection(field.node))) {
        event.preventDefault();
        event.stopPropagation();
        if (!composing) selectionError(field.node);
      }
    });
    for (const type of ["dragstart", "dragover", "drop"]) {
      on(doc, type, (event) => {
        if (activeFrameField(doc) || (mode === "edit" && frameField(event.target))) {
          event.preventDefault(); // Cross-field drag/drop must never move protected HTML.
          event.stopPropagation();
        }
      });
    }
    const slideChanged = () => {
      const index = Number(runtime.current());
      if (Number.isInteger(index) && index >= 0 && index < state.slides.length && index !== slideIndex) {
        afterComposition(() => { slideIndex = index; historyGroup++; renderSlide(); }, "switch slides");
      }
    };
    on(win, "nice-deck:slide", slideChanged);
    on(doc, "nice-deck:slide", slideChanged);
  }

  function restoreAttribute(binding, attribute) {
    const original = binding.attributes.get(attribute);
    if (original === null) binding.node.removeAttribute(attribute);
    else binding.node.setAttribute(attribute, original);
  }

  function applyMode() {
    if (mode === "read") {
      const active = frame.contentDocument?.activeElement;
      if ([...bindings.values()].some((binding) => binding.node === active)) active.blur();
    }
    const seen = new Set();
    for (const [id, binding] of bindings) {
      if (seen.has(binding.node)) continue;
      seen.add(binding.node);
      if (mode === "edit" && ready && binding.inline) {
        binding.node.setAttribute(fieldAttribute, id);
        binding.node.setAttribute("contenteditable", "plaintext-only");
        binding.node.setAttribute("tabindex", "0");
        binding.node.setAttribute("role", "textbox");
        binding.node.setAttribute("aria-label", `${fieldLabel(fields.get(id))}, editable text`);
        binding.node.setAttribute("aria-multiline", "false");
        binding.node.setAttribute("spellcheck", "true");
      } else {
        for (const attribute of temporaryAttributes) restoreAttribute(binding, attribute);
      }
    }
    if (runtimeStyle) runtimeStyle.disabled = mode !== "edit" || !ready;
    $("edit-mode").setAttribute("aria-pressed", String(mode === "edit"));
    $("read-mode").setAttribute("aria-pressed", String(mode === "read"));
    frame.title = mode === "edit" ? "Live deck — editable draft" : "Live deck — clean draft preview, not approval";
    $("mode-hint").textContent = mode === "edit"
      ? "Click outlined text or edit the visible slide HTML. Source edits preview after a short pause; Save persists them."
      : "Read is a clean preview of your draft, not approval. Charts, links, and slide navigation work normally.";
    syncSelection();
    renderStatus();
  }

  function setMode(next) {
    afterComposition(() => {
      historyGroup++;
      mode = next;
      applyMode();
      announce(next === "read" ? "Read mode. Unsaved draft text is visible; this is not approval." : "Edit mode. Choose an outlined text field.");
    }, `switch to ${next} mode`);
  }

  async function waitForRuntime(win) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (win.__niceDeck?.goTo && win.__niceDeck?.current) return win.__niceDeck;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("The deck navigation API is unavailable. This file cannot be safely edited in this session.");
  }

  async function connectFrame({ preserveNavigation = false } = {}) {
    if (!state) return;
    const currentDocument = frame.contentDocument;
    // Imported runtimes can dispatch another iframe load after mounting a child
    // calculator. That is not a new source document and must not rebind our own
    // contenteditable nodes as if they were unexpected source markup.
    if (ready && connectedDocument === currentDocument
      && [...bindings.values()].every(({ node }) => node.isConnected)) return;
    const generation = ++frameGeneration;
    ready = false;
    frameEvents?.abort();
    for (const binding of bindings.values()) {
      for (const attribute of temporaryAttributes) restoreAttribute(binding, attribute);
    }
    runtimeStyle?.remove();
    bindings = new Map();
    textFields = new WeakMap();
    runtime = null;
    runtimeStyle = null;
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || new URL(win.location.href).origin !== location.origin) throw new Error("The deck must stay on this local origin.");
      const sourceURL = new URL(sameOriginURL(state.deckUrl));
      if (win.location.pathname !== sourceURL.pathname) throw new Error("The frame left the source deck. Reload from disk to resume editing.");
      const apiRuntime = await waitForRuntime(win);
      if (generation !== frameGeneration) return;
      const slides = [...doc.querySelectorAll(".slide")];
      if (slides.length !== state.slides.length || Number(apiRuntime.count) !== slides.length) {
        throw new Error("The source slide count does not match the manifest. No text has been made editable.");
      }
      const slideNodes = new Map();
      for (const slide of state.slides) {
        const anchor = String(slide.anchor || "").replace(/^#/, "");
        let node = anchor ? doc.getElementById(anchor) : null;
        if (!node?.classList.contains("slide")) node = doc.getElementById(slide.id);
        if (!node?.classList.contains("slide")) node = slides[slide.index];
        if (!node || !node.classList.contains("slide") || slides.indexOf(node) !== slide.index) {
          throw new Error(`Slide ${slide.index + 1} could not be matched safely. Editing is disabled.`);
        }
        slideNodes.set(slide.id, node);
      }
      const resolved = new Map();
      const used = new Set();
      for (const field of fields.values()) {
        const slide = slideNodes.get(field.slideId);
        let node = slide;
        for (const part of field.path) node = node?.children[part];
        const textNode = field.textNode === undefined ? null : node?.childNodes[field.textNode];
        const target = textNode || node;
        const namespace = field.namespace === "svg" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml";
        // Inactive slides may be inert/hidden because of the deck runtime, not source locks.
        let reason = "";
        if (!node || used.has(target) || node.closest(".slide") !== slide) reason = "source location changed";
        else if (node.namespaceURI !== namespace || node.tagName.toLowerCase() !== field.tag) reason = "element type changed";
        else if (field.textNode !== undefined && textNode?.nodeType !== 3) reason = "text fragment changed";
        else if (target.textContent !== valueOf(field.id)) reason = "source text changed";
        else if (!textNode && [...node.childNodes].some((child) => child.nodeType !== 3)) reason = "runtime added non-text content";
        else if (node.closest("nav,form,button,script,style,template,pre,code")) reason = "runtime moved text into application controls";
        else if (node.isContentEditable) reason = "another editor already owns this text";
        if (reason) throw new Error(`${fieldLabel(field)} cannot be matched: ${reason}. Your draft is retained; reload from disk to reconnect safely.`);
        used.add(target);
        resolved.set(field.id, {
          node, textNode, inline: !textNode && field.namespace !== "svg",
          attributes: new Map(temporaryAttributes.map((attribute) => [attribute, node.getAttribute(attribute)])),
        });
        for (const text of textNode ? [textNode] : [...node.childNodes]) textFields.set(text, field.id);
      }
      // Validation is all-or-nothing: no source node is touched until every field matches.
      bindings = resolved;
      runtime = apiRuntime;
      runtimeStyle = doc.createElement("style");
      runtimeStyle.setAttribute("data-nice-deck-authoring", "");
      runtimeStyle.textContent = `
        [${fieldAttribute}] { outline-offset: 2px; cursor: text; }
        [${fieldAttribute}]:hover { outline: 1px dashed #278ec0; }
        [${fieldAttribute}][${selectedAttribute}], [${fieldAttribute}]:focus {
          outline: 2px solid #258fe1; outline-offset: 4px;
        }
        @media (forced-colors: active) { [${fieldAttribute}] { outline-color: Highlight; } }
      `;
      doc.head.append(runtimeStyle);
      bindFrameEvents(doc, win);
      connectedDocument = doc;
      ready = true;
      for (const id of drafts.keys()) syncNode(id);
      applyMode();
      frame.hidden = false;
      $("stage-placeholder").hidden = true;
      $("stage").setAttribute("aria-busy", "false");
      // Await both synchronous modern navigation and Promise-returning imported runtimes.
      if (!preserveNavigation) await navigate(slideIndex);
      if (generation !== frameGeneration) return;
      renderSlide();
      announce("Deck ready. Click slide text, including table cells and labels, to edit.");
    } catch (error) {
      if (generation !== frameGeneration) return;
      ready = false;
      mode = "read";
      applyMode();
      frame.hidden = false;
      $("stage-placeholder").hidden = true;
      $("stage").setAttribute("aria-busy", "false");
      conflict = true;
      $("conflict-title").textContent = "The source could not be matched safely";
      showError(error.message || "The source could not be connected safely. Editing is disabled.");
      renderSlide();
    }
  }

  async function navigate(index) {
    if (!runtime || !state || !Number.isInteger(index) || index < 0 || index >= state.slides.length) return;
    if (composing || sourceComposing) {
      afterComposition(() => navigate(index), "switch slides");
      return;
    }
    navigating = true;
    historyGroup++;
    renderStatus();
    try {
      const slide = state.slides.find((item) => item.index === index);
      await Promise.resolve(runtime.goTo(slide.anchor || index));
      if (typeof runtime.whenSettled === "function") await Promise.resolve(runtime.whenSettled());
      const current = Number(runtime.current());
      if (!Number.isInteger(current) || current < 0 || current >= state.slides.length) throw new Error("The deck reported an invalid current slide.");
      slideIndex = current;
      renderSlide();
    } catch (error) {
      showError(error.message || "Could not navigate to that slide.");
    } finally {
      navigating = false;
      renderStatus();
    }
  }

  async function save() {
    if (composing || sourceComposing) { afterComposition(save, "save"); return; }
    if (sourceDrafts.size) { await saveSource(); return; }
    if (!ready || saving || reloading || conflict || !drafts.size) return;
    if (state.status === "recovery-required") {
      showError(state.reviewHint || "Source recovery must be resolved before another save.");
      return;
    }
    if ([...drafts.values()].some((draft) => invalid(draft.text))) {
      showError("Use nonempty, single-line text up to 5,000 characters per field. Your draft has been kept.");
      return;
    }
    const submitted = new Map([...drafts].map(([id, draft]) =>
      [id, { id, oldText: fields.get(id).text, text: draft.text, sequence: versions.get(id) }]));
    const revision = state.revision;
    saving = true;
    saveError = false;
    historyGroup++;
    renderStatus();
    try {
      const next = validateState(await api("/api/save", {
        revision,
        changes: [...submitted.values()].map(({ id, oldText, text }) => ({ id, oldText, text })),
      }));
      if (!sameManifest(next)) {
        conflict = true;
        throw new Error("The saved manifest changed unexpectedly. Your draft is retained. Reload from disk before editing further.");
      }
      const live = new Map([...fields.keys()].map((id) => [id, valueOf(id)]));
      state = next;
      for (const slide of next.slides) if (previewSources.has(slide.id)) previewSources.set(slide.id, slide.source);
      fields = new Map(next.fields.map((field) => [field.id, field]));
      const remaining = new Map();
      for (const [id, text] of live) {
        const sent = submitted.get(id);
        const acknowledged = sent && versions.get(id) === sent.sequence;
        const desired = acknowledged ? fields.get(id).text : text;
        if (desired !== fields.get(id).text) remaining.set(id, { text: desired, sequence: versions.get(id) });
      }
      drafts = remaining;
      // Never reload the iframe on save: calculator state, focus, and later typing survive.
      for (const id of bindings.keys()) syncNode(id);
      checks = next.checks || { state: "idle" };
      for (const slide of next.slides) {
        const node = frame.contentDocument?.getElementById(slide.anchor);
        if (node?.hasAttribute("data-title")) node.setAttribute("data-title", slide.title);
      }
      renderDocument();
      syncSelection();
      scheduleChecks();
      announce(drafts.size ? "Submitted changes saved. Newer changes are still unsaved." : "Changes saved to the local HTML.");
    } catch (error) {
      saveError = true;
      if (error.status === 409) {
        conflict = true;
        $("conflict-title").textContent = "The saved file has changed";
        announce("Save conflict. Your draft is retained. Download it before reloading from disk.");
      }
      showError(error.message || "Could not save. Your draft is still in this tab.");
    } finally {
      finishSave();
    }
  }

  function downloadDraft() {
    if (composing || sourceComposing) { afterComposition(downloadDraft, "download your draft"); return; }
    if (!state) return;
    const recovery = {
      format: "nice-deck-draft-changes",
      version: 1,
      filename: publicText(basename(state.filename)),
      baseRevision: state.revision,
      createdAt: new Date().toISOString(),
      changes: [...drafts].map(([id, draft]) => ({ id, oldText: fields.get(id).text, text: draft.text })),
      sourceChanges: sourceChanges(),
    };
    const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${basename(state.filename || "deck.html").replace(/\.html?$/i, "")}.draft-changes.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    recoverySequence = sequence;
    announce("Draft recovery download requested. Keep the JSON file before discarding this tab. No data was uploaded.");
  }

  async function reloadDisk() {
    if (composing || sourceComposing) { afterComposition(reloadDisk, "reload from disk"); return; }
    if (saving || reloading) return;
    if (isDirty()) {
      if (recoverySequence !== sequence) {
        downloadDraft();
        announce("A recovery download was requested. Check that it was saved before confirming reload.");
      }
      if (!window.confirm("Reload from disk and discard this tab’s unsaved changes? A draft recovery download was requested. Confirm only after you have kept that JSON file. Cancel keeps your draft here.")) return;
    }
    reloading = true;
    const wasReady = ready;
    ready = false;
    applyMode();
    try {
      const next = validateState(await api("/api/state"));
      // The source is fetched before discarding anything. A failed read leaves the draft intact.
      frameEvents?.abort();
      frameGeneration++;
      state = next;
      fields = new Map(next.fields.map((field) => [field.id, field]));
      drafts = new Map();
      sourceDrafts.clear();
      previewSources.clear();
      sourceSelections.clear();
      sourceGeneration++;
      sourcePending = sourceInvalid = false;
      versions = new Map();
      undoStack = [];
      redoStack = [];
      sequence++;
      selectedId = null;
      slideIndex = Math.min(slideIndex, state.slides.length - 1);
      conflict = false;
      saveError = false;
      ready = false;
      runtime = null;
      bindings = new Map();
      checks = next.checks || { state: "idle" };
      $("error-panel").hidden = true;
      fieldError("");
      renderDocument();
      loadSource();
      scheduleChecks();
    } catch (error) {
      ready = wasReady;
      applyMode();
      showError(error.message || "Could not reload from disk. Your draft is retained.");
    } finally {
      reloading = false;
      renderStatus();
    }
  }

  function loadSource() {
    frame.hidden = true;
    $("stage-placeholder").hidden = false;
    $("stage").setAttribute("aria-busy", "true");
    frame.src = sameOriginURL(state.deckUrl);
  }

  function scheduleChecks() {
    clearTimeout(checkTimer);
    if (checks.state !== "running") return;
    checkTimer = setTimeout(async () => {
      try {
        // Deliberately fetch checks ONLY. Background work never replaces the draft or state.
        const result = await api("/api/check");
        checks = result.checks || result;
        renderChecks();
        scheduleChecks();
      } catch (error) {
        checks = { ...checks, state: "error", message: error.message || "Could not read check status." };
        renderChecks();
      }
    }, 1500);
  }

  async function runChecks() {
    if (!state || checkRequest || checks.state === "running" || saving || conflict) return;
    checkRequest = true;
    renderChecks();
    try {
      const result = await api("/api/check", {});
      checks = result.checks || result;
      announce("Checks requested for the saved HTML. Unsaved edits are not included.");
      scheduleChecks();
    } catch (error) {
      showError(error.message || "Could not start slide checks.");
    } finally {
      checkRequest = false;
      renderChecks();
    }
  }

  sourceView.addEventListener("input", (event) => {
    if (!sourceComposing && !event.isComposing && sourceSlideId) recordSource(sourceSlideId, sourceView.value);
  });
  sourceView.addEventListener("compositionstart", () => {
    sourceComposing = true;
    sourceGeneration++;
    clearTimeout(sourceTimer);
    renderStatus();
  });
  sourceView.addEventListener("compositionend", () => {
    setTimeout(() => {
      sourceComposing = false;
      recordSource(sourceSlideId, sourceView.value);
      if (sourcePending) { clearTimeout(sourceTimer); sourceTimer = setTimeout(validateSourceDrafts, 250); }
      const actions = deferred;
      deferred = [];
      for (const action of actions) action();
    }, 0);
  });
  sourceView.addEventListener("keydown", (event) => {
    if (event.isComposing || sourceComposing) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        afterComposition(() => { clearTimeout(sourceTimer); validateSourceDrafts().then(save); }, "save");
      }
      return;
    }
    historyShortcut(event);
  });
  sourceView.addEventListener("beforeinput", (event) => {
    if (!sourceComposing && ["historyUndo", "historyRedo"].includes(event.inputType)) {
      event.preventDefault();
      undoRedo(event.inputType === "historyUndo" ? "undo" : "redo");
    }
  });
  $("edit-mode").addEventListener("click", () => setMode("edit"));
  $("read-mode").addEventListener("click", () => setMode("read"));
  $("save").addEventListener("click", () => afterComposition(save, "save"));
  $("undo").addEventListener("click", () => undoRedo("undo"));
  $("redo").addEventListener("click", () => undoRedo("redo"));
  $("download-draft").addEventListener("click", downloadDraft);
  $("conflict-download").addEventListener("click", downloadDraft);
  $("reload-disk").addEventListener("click", reloadDisk);
  $("dismiss-error").addEventListener("click", () => { $("error-panel").hidden = true; });
  $("check-slides").addEventListener("click", runChecks);
  $("slide-select").addEventListener("change", (event) => navigate(Number(event.target.value)));
  $("previous-slide").addEventListener("click", () => navigate(slideIndex - 1));
  $("next-slide").addEventListener("click", () => navigate(slideIndex + 1));
  frame.addEventListener("load", connectFrame);
  document.addEventListener("keydown", (event) => {
    // No parent arrow/space shortcuts: selects, text inputs, and the iframe own those keys.
    const target = event.target;
    if (target.closest?.("input,textarea,select,[contenteditable]")) return;
    historyShortcut(event);
  });
  window.addEventListener("beforeunload", (event) => {
    if (isDirty() || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  async function start() {
    try {
      const fragment = new URLSearchParams(location.hash.slice(1));
      token = fragment.get("key") || "";
      if (fragment.has("key")) {
        fragment.delete("key");
        const remainder = fragment.toString();
        history.replaceState(null, "", location.pathname + location.search + (remainder ? `#${remainder}` : ""));
      }
      try {
        if (token) sessionStorage.setItem(storageKey, token);
        else token = sessionStorage.getItem(storageKey) || "";
      } catch { /* Restricted storage still allows the current token-authenticated session. */ }
      if (!token) throw new Error("This tab needs a local editor session. Open the launch URL provided by the local service.");
      await api("/api/session", {});
      state = validateState(await api("/api/state"));
      if (state.status === "recovery-required") showError(state.reviewHint);
      fields = new Map(state.fields.map((field) => [field.id, field]));
      checks = state.checks || { state: "idle" };
      renderDocument();
      loadSource();
      scheduleChecks();
    } catch (error) {
      $("loading-message").textContent = "The local session could not be opened. Relaunch the editor and use its new launch URL.";
      $("filename").textContent = "Local session unavailable";
      $("save-status").textContent = "Not connected";
      $("stage").setAttribute("aria-busy", "false");
      showError(error.message || "Could not connect to the local editor service.");
    }
  }

  start();
})();
