/* The authoring layer lives only in this tab. Source saves contain field text, never DOM. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("deck-frame");
  const mirror = $("field-text");
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
    $("error-message").textContent = publicText(message);
    $("error-panel").hidden = false;
  }

  function fieldError(message) {
    $("field-error").textContent = message;
    $("field-error").hidden = !message;
    mirror.setAttribute("aria-invalid", String(Boolean(message && selectedId && invalid(valueOf(selectedId)))));
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
    return drafts.size > 0 || Boolean(composing);
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
    $("field-count").textContent = `${currentFields.length} editable text ${currentFields.length === 1 ? "field" : "fields"}`;
    $("empty-fields").hidden = currentFields.length !== 0;
    const list = $("field-list");
    list.replaceChildren();
    for (const field of currentFields) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "field-choice";
      button.dataset.fieldId = field.id;
      button.disabled = !ready;
      const heading = document.createElement("span");
      heading.className = "field-choice-label";
      const label = document.createElement("span");
      label.textContent = fieldLabel(field);
      const dirty = document.createElement("span");
      dirty.className = "field-dirty";
      heading.append(label, dirty);
      const preview = document.createElement("span");
      preview.className = "field-choice-preview";
      button.append(heading, preview);
      button.addEventListener("click", () => afterComposition(() => {
        selectField(field.id);
        mirror.focus();
      }, "select another field"));
      list.append(button);
    }
    syncInspector(true);
    renderStatus();
  }

  function syncInspector(force = false) {
    const field = fields.get(selectedId);
    $("field-editor").hidden = !field;
    mirror.disabled = !ready || !field;
    mirror.readOnly = mode !== "edit";
    if (field) {
      $("field-label").textContent = fieldLabel(field);
      if (!composing && (force || document.activeElement !== mirror) && mirror.value !== valueOf(field.id)) {
        mirror.value = valueOf(field.id);
      }
      const bad = invalid(valueOf(field.id));
      mirror.setAttribute("aria-invalid", String(bad));
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
      $("layout-hint").hidden = !escaped;
      $("field-help").textContent = binding && !binding.inline
        ? "Edit this text here to preserve its surrounding formatting or SVG geometry."
        : "Plain text only. The slide handles wrapping. Pasted line breaks become spaces.";
    }
    for (const button of $("field-list").children) {
      const id = button.dataset.fieldId;
      button.setAttribute("aria-pressed", String(id === selectedId));
      button.querySelector(".field-choice-preview").textContent = valueOf(id) || "(Empty text)";
      button.querySelector(".field-dirty").textContent = drafts.has(id) ? "Edited" : "";
    }
    const selection = mode === "edit" && ready ? bindings.get(selectedId) : null;
    if (highlighted && highlighted.node !== selection?.node) restoreAttribute(highlighted, selectedAttribute);
    if (selection) {
      selection.node.setAttribute(selectedAttribute, "");
      selection.node.setAttribute(fieldAttribute, selectedId);
    }
    highlighted = selection;
  }

  function renderStatus() {
    const dirty = isDirty();
    const invalidDraft = [...drafts.values()].some((draft) => invalid(draft.text));
    let message = !state ? "Connecting…" : dirty ? `${drafts.size || 1} unsaved ${drafts.size === 1 ? "change" : "changes"}` : "Saved · no pending changes";
    if (reloading) message = "Reloading the saved source…";
    else if (saving) message = "Saving… You can keep typing.";
    else if (conflict) message = "File changed · draft retained";
    else if (saveError) message = "Save failed · draft retained";
    else if (state?.status === "recovery-required") message = "Source recovery required · draft retained";
    else if (!ready && state) message = "Editing unavailable";
    const status = $("save-status");
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = conflict || saveError ? "error" : dirty ? "dirty" : "saved";
    $("save").disabled = !ready || saving || reloading || conflict || !drafts.size || invalidDraft
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
    syncInspector(true);
  }

  function recordChange(id, text, { discrete = false, origin = null } = {}) {
    if (!ready || !fields.has(id)) return;
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
    if (origin !== "mirror") syncInspector();
    else syncInspector(false);
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
      historyGroup++;
      setDraft(transaction.id, direction === "undo" ? transaction.before : transaction.after);
      to.push(transaction);
      const field = fields.get(transaction.id);
      const slide = state.slides.find((item) => item.id === field.slideId);
      syncNode(transaction.id);
      const show = () => {
        fieldError("");
        selectField(transaction.id);
        syncInspector(true);
        if (document.activeElement === mirror) mirror.setSelectionRange(mirror.value.length, mirror.value.length);
        renderStatus();
        announce(`${direction === "undo" ? "Undid" : "Redid"} change to ${fieldLabel(field)}.`);
      };
      if (slide.index !== slideIndex) navigate(slide.index).then(show);
      else show();
    }, direction === "undo" ? "undo" : "redo");
  }

  function afterComposition(action, description) {
    if (composing) {
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
      const text = origin === "mirror" ? element.value : element.textContent;
      composing = null;
      recordChange(id, text, { discrete: true, origin });
      syncInspector();
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
      afterComposition(save, "save");
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
    selectField(field.id);
    if (!field.inline) {
      inspectorOpen(true);
      mirror.focus();
    }
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
      if (composing) {
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
      if (mode === "edit" && ready) {
        binding.node.setAttribute(fieldAttribute, id);
        if (binding.inline) binding.node.setAttribute("contenteditable", "plaintext-only");
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
      ? "Click slide text to edit it. Use the Text panel for formatted fragments and diagram labels."
      : "Read is a clean preview of your draft, not approval. Charts, links, and slide navigation work normally.";
    syncInspector();
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

  async function connectFrame() {
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
        else if (target.textContent !== field.text) reason = "source text changed";
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
      await navigate(slideIndex);
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
    if (composing) {
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
    if (composing) { afterComposition(save, "save"); return; }
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
      syncInspector();
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
      saving = false;
      renderStatus();
    }
  }

  function downloadDraft() {
    if (composing) { afterComposition(downloadDraft, "download your draft"); return; }
    if (!state) return;
    const recovery = {
      format: "nice-deck-draft-changes",
      version: 1,
      filename: publicText(basename(state.filename)),
      baseRevision: state.revision,
      createdAt: new Date().toISOString(),
      changes: [...drafts].map(([id, draft]) => ({ id, oldText: fields.get(id).text, text: draft.text })),
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
    if (composing) { afterComposition(reloadDisk, "reload from disk"); return; }
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

  function inspectorOpen(open) {
    $("inspector").hidden = !open;
    $("workspace").classList.toggle("inspector-closed", !open);
    $("toggle-inspector").setAttribute("aria-expanded", String(open));
  }

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
  $("toggle-inspector").addEventListener("click", () => afterComposition(() => {
    inspectorOpen($("inspector").hidden);
  }, "toggle the text panel"));
  $("slide-select").addEventListener("change", (event) => navigate(Number(event.target.value)));
  $("previous-slide").addEventListener("click", () => navigate(slideIndex - 1));
  $("next-slide").addEventListener("click", () => navigate(slideIndex + 1));
  frame.addEventListener("load", connectFrame);
  mirror.addEventListener("focus", () => { historyGroup++; });
  mirror.addEventListener("blur", () => { historyGroup++; });
  mirror.addEventListener("compositionstart", () => beginComposition(mirror, selectedId, "mirror"));
  mirror.addEventListener("compositionend", () => { if (composing?.origin === "mirror") finishComposition(); });
  mirror.addEventListener("input", (event) => {
    if (composing || event.isComposing || mode !== "edit" || !selectedId) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      syncInspector(true);
      undoRedo(event.inputType === "historyUndo" ? "undo" : "redo");
      return;
    }
    recordChange(selectedId, mirror.value, { origin: "mirror" });
  });
  mirror.addEventListener("beforeinput", (event) => {
    if (composing || event.isComposing || mode !== "edit") return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      if (event.cancelable) {
        event.preventDefault();
        undoRedo(event.inputType === "historyUndo" ? "undo" : "redo");
      }
    } else if (["insertParagraph", "insertLineBreak", "insertFromDrop"].includes(event.inputType) ||
               (event.data && newline.test(event.data))) {
      event.preventDefault();
      fieldError("Use a single line of source text. It wraps naturally on the slide.");
    }
  });
  mirror.addEventListener("paste", (event) => {
    if (mode !== "edit" || !selectedId) return;
    event.preventDefault();
    if (composing) { fieldError("Finish composing before pasting text."); return; }
    if (!event.clipboardData) { fieldError("Clipboard text is unavailable."); return; }
    if (!event.clipboardData.types.includes("text/plain")) { fieldError("Only plain-text clipboard content can be pasted."); return; }
    const original = event.clipboardData.getData("text/plain");
    const text = original.replace(/\r\n|[\r\n\u2028\u2029]/g, " ");
    mirror.setRangeText(text, mirror.selectionStart, mirror.selectionEnd, "end");
    recordChange(selectedId, mirror.value, { discrete: true, origin: "mirror" });
    if (text !== original) announce("Pasted as plain text. Line breaks were replaced with spaces.");
  });
  mirror.addEventListener("drop", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    // No parent arrow/space shortcuts: selects, text inputs, and the iframe own those keys.
    const target = event.target;
    if (target !== mirror && target.closest?.("input,textarea,select,[contenteditable]")) return;
    if (target === mirror && mode !== "edit") return;
    historyShortcut(event);
  });
  window.addEventListener("beforeunload", (event) => {
    if (isDirty() || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  async function start() {
    const compactViewport = window.matchMedia("(max-width: 760px)");
    inspectorOpen(!compactViewport.matches);
    compactViewport.addEventListener("change", (event) => afterComposition(() => {
      inspectorOpen(!event.matches);
    }, "resize the text panel"));
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
