// Browser probes are self-contained: Playwright serializes them without their
// module scope. Navigation, readiness waits and stress mutations belong to callers.
export const viewportMatrix = [
  { width: 1600, height: 900, name: "canonical" },
  { width: 1280, height: 720, name: "scaled-16-9" },
  { width: 640, height: 360, name: "small-16-9" },
  { width: 1600, height: 600, name: "wide-short" },
  { width: 700, height: 900, name: "narrow-tall" },
  { width: 520, height: 900, name: "side-panel" },
];

export function measureLayout({ paddingFallback = false } = {}) {
  const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
  if (!slide) return { missing: true, id: "", overflow: [], overlaps: [] };
  const style = getComputedStyle(slide);
  const rect = slide.getBoundingClientRect();
  const scale = window.__niceDeck?.geometry?.().scale ?? 1;
  const pad = (value) => {
    const number = Number.parseFloat(value);
    return paddingFallback && !Number.isFinite(number) ? 0 : number;
  };
  const box = {
    left: rect.left + pad(style.paddingLeft) * scale,
    right: rect.right - pad(style.paddingRight) * scale,
    top: rect.top + pad(style.paddingTop) * scale,
    bottom: rect.bottom - pad(style.paddingBottom) * scale,
  };
  const exempt = (element) => element.closest("[data-chart], [data-echart], svg, pre, code");
  const bleeds = (element) => element.closest("[data-bleed]");
  const label = (element) => {
    const cls = (element.className || "").toString().trim().split(/\s+/)[0];
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${text ? ` "${text}"` : ""}`;
  };

  const overflow = [];
  for (const element of slide.querySelectorAll("*")) {
    if (exempt(element) || bleeds(element)) continue;
    const current = element.getBoundingClientRect();
    if (current.width < 2 || current.height < 2) continue;
    const escapes = [];
    if (current.right > box.right + scale) escapes.push({ edge: "right", pixels: Math.round(current.right - box.right) });
    if (current.left < box.left - scale) escapes.push({ edge: "left", pixels: Math.round(box.left - current.left) });
    if (current.bottom > box.bottom + scale) escapes.push({ edge: "bottom", pixels: Math.round(current.bottom - box.bottom) });
    if (current.top < box.top - scale) escapes.push({ edge: "top", pixels: Math.round(box.top - current.top) });
    if (escapes.length) overflow.push({ escapes, label: label(element) });
  }

  // Own text, not a tag whitelist. Ancestor pairs are excluded below.
  const ownsText = (element) => [...element.childNodes]
    .some((node) => node.nodeType === 3 && node.textContent.trim());
  const texts = [...slide.querySelectorAll("*")]
    .filter((element) => !exempt(element) && ownsText(element));
  // Wrapping inline elements need per-line boxes, measured outside the pair loop.
  const measured = texts
    .map((element) => ({
      element,
      boxes: [...element.getClientRects()].filter((line) => line.width > 2 && line.height > 2),
    }))
    .filter((entry) => entry.boxes.length);
  const overlaps = [];
  for (let a = 0; a < measured.length; a += 1) {
    for (let b = a + 1; b < measured.length; b += 1) {
      if (measured[a].element.contains(measured[b].element)
        || measured[b].element.contains(measured[a].element)) continue;
      let worst = null;
      for (const first of measured[a].boxes) {
        for (const second of measured[b].boxes) {
          const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
          if (
            width > 2 * scale
            && height > 2 * scale
            && (!worst || width * height > worst.width * worst.height)
          ) {
            worst = { width, height };
          }
        }
      }
      if (worst) {
        overlaps.push({
          width: Math.round(worst.width),
          height: Math.round(worst.height),
          first: label(measured[a].element),
          second: label(measured[b].element),
        });
      }
    }
  }
  return { id: slide.dataset.slideId ?? "", overflow, overlaps };
}

export async function previewLayoutFindings(page, slideIndex) {
  const report = await page.evaluate(measureLayout, { paddingFallback: false });
  const findings = [
    ...report.overflow.map(({ escapes, label }) => (
      `overflows the slide ${escapes.map(({ edge, pixels }) => `${edge} by ${pixels}px`).join(" and ")}: ${label}`
    )),
    ...report.overlaps.map(({ width, height, first, second }) => (
      `text overlaps by ${width}x${height}px: ${first} over ${second}`
    )),
  ];
  return [...new Set(findings)].slice(0, 12).map((message) => ({ slide: slideIndex + 1, message }));
}

export async function standaloneLayoutReport(page) {
  const report = await page.evaluate(measureLayout, { paddingFallback: true });
  return {
    id: report.id,
    overflow: report.missing ? ["no .slide element found"] : [...new Set(
      report.overflow.map(({ escapes, label }) => (
        `${escapes.map(({ edge, pixels }) => `${edge} ${pixels}px`).join(", ")} :: ${label}`
      )),
    )],
    overlaps: [...new Set(report.overlaps.map(({ width, height, first, second }) => (
      `${width}x${height}px :: ${first} over ${second}`
    )))],
  };
}

// Preview-only policy: standalone layout testing intentionally does not invoke
// region, citation or prose checks.
export function measureRegions({ index, budget }) {
  if (document.documentElement.dataset.deckKind === "outline") return [];
  const slide = document.querySelector(".slide:not([hidden])")
    ?? document.querySelector(".slide");
  if (!slide) return [];

  const findings = [];
  const scale = window.__niceDeck?.geometry?.().scale ?? 1;
  const add = (name, message) => findings.push({ slide: index + 1, name, message });
  const round = (value) => Math.round(value * 100) / 100;
  const label = (element) => (
    element.dataset?.region
    || (typeof element.className === "string" ? element.className : "")
    || element.tagName.toLowerCase()
  );
  const regions = [...slide.querySelectorAll("[data-region]")]
    .filter((element) => !element.hasAttribute("data-grid-exception"))
    .map((element) => ({ element, rect: element.getBoundingClientRect(), label: label(element) }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);

  for (const edge of ["left", "right"]) {
    for (let first = 0; first < regions.length; first += 1) {
      for (let second = first + 1; second < regions.length; second += 1) {
        const a = regions[first];
        const b = regions[second];
        const vertical = a.rect.bottom <= b.rect.top + scale || b.rect.bottom <= a.rect.top + scale;
        if (!vertical) continue;
        const delta = Math.abs(a.rect[edge] - b.rect[edge]);
        if (delta > scale && delta <= 12 * scale) {
          add(
            "region-misaligned",
            `${a.label} and ${b.label} ${edge} edges differ by ${round(delta)}px; share one grid or declare data-grid-exception`,
          );
        }
      }
    }
  }
  for (const element of slide.querySelectorAll("*")) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.hasAttribute("data-grid-exception")) continue;
    if (element.closest("[data-chart], [data-echart], svg, pre, code, [data-bleed]")) continue;
    const style = getComputedStyle(element);
    if (style.position !== "absolute" && style.position !== "fixed") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width * rect.height <= 16) continue;
    const text = element.textContent?.trim() ?? "";
    if (text.length < 12) continue;
    add(
      "absolute-region",
      `${label(element)} is positioned ${style.position}; content regions belong to the slide grid`,
    );
  }

  const citations = [...slide.querySelectorAll("[data-citation]")];
  for (const citation of citations) {
    if (!citation.textContent?.trim()) continue;
    const links = [...citation.querySelectorAll("a[href]")];
    if (!links.length) {
      add("citation-not-linked", "citation prints a source without a link");
      continue;
    }
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        const target = href.slice(1);
        if (/^\d+$/.test(target)) {
          add("citation-index-anchor", `citation links to slide index ${href}; use the supporting slide's stable id`);
        } else if (!document.getElementById(target)) {
          add("citation-broken-anchor", `citation links to ${href}, which is not a slide in this deck`);
        }
      } else if (!/^https:\/\//i.test(href)) {
        add("citation-broken-anchor", `citation link ${href.slice(0, 60)} is neither an in-deck anchor nor HTTPS`);
      }
    }
  }
  if (slide.dataset.section !== "supporting") {
    const clone = slide.cloneNode(true);
    for (const removed of clone.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, svg, table, pre, code, figcaption, [data-citation], [data-chart], [data-echart]",
    )) {
      removed.remove();
    }
    const words = (clone.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (words > budget) {
      add(
        "slide-text-budget",
        `${words} words of prose exceed the ${budget}-word budget; cut it, chart it, or move it to a supporting slide`,
      );
    }
  }
  return findings;
}

export function measureViewport({
  width, height, checkSettled = false, requireGeometry = false,
  tolerance = 1.5, scaleTolerance = 0.002, scrollTolerance = 1,
}) {
  // The standalone command historically requires geometry and a slide, while
  // preview reports missing geometry as a finding.
  const geometry = requireGeometry ? window.__niceDeck.geometry() : window.__niceDeck?.geometry?.();
  const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
  if (!requireGeometry && (!geometry || !slide)) {
    return [{ kind: "missing", message: "fixed-canvas runtime geometry is unavailable" }];
  }
  const findings = [];
  const expectedScale = Math.min(width / geometry.designWidth, height / geometry.designHeight);
  const rect = slide.getBoundingClientRect();
  const expectedWidth = geometry.designWidth * expectedScale;
  const expectedHeight = geometry.designHeight * expectedScale;
  if (Math.abs(geometry.scale - expectedScale) > scaleTolerance) {
    findings.push({ kind: "scale", message: `scale ${geometry.scale} does not match ${expectedScale}` });
  }
  if (
    Math.abs(rect.width - expectedWidth) > tolerance
    || Math.abs(rect.height - expectedHeight) > tolerance
  ) {
    findings.push({ kind: "size", message: `slide is ${rect.width}x${rect.height}, expected ${expectedWidth}x${expectedHeight}` });
  }
  if (
    Math.abs(rect.left - (width - expectedWidth) / 2) > tolerance
    || Math.abs(rect.top - (height - expectedHeight) / 2) > tolerance
  ) {
    findings.push({
      kind: "center",
      message: `slide is not centered: ${rect.left},${rect.top}; expected `
        + `${(width - expectedWidth) / 2},${(height - expectedHeight) / 2}`,
    });
  }
  if (checkSettled && document.documentElement.dataset.niceDeckSettled !== "true") {
    findings.push({ kind: "settled", message: "runtime scaling did not settle" });
  }
  if (
    document.documentElement.scrollWidth > width + scrollTolerance
    || document.documentElement.scrollHeight > height + scrollTolerance
  ) {
    findings.push({ kind: "scroll", message: "viewport has unexpected scrolling" });
  }
  return findings;
}

export async function previewViewportFindings(page, viewport, slideIndex) {
  const findings = await page.evaluate(measureViewport, {
    width: viewport.width, height: viewport.height, checkSettled: true,
  });
  return findings.map(({ message }) => ({ viewport: viewport.name, slide: slideIndex + 1, message }));
}

export async function standaloneViewportFindings(page, width, height) {
  const findings = await page.evaluate(measureViewport, { width, height, requireGeometry: true });
  const messages = {
    scale: "incorrect scale",
    size: "incorrect rendered size",
    center: "canvas is not centered",
    scroll: "unexpected scrollbars",
  };
  return findings.map(({ kind }) => messages[kind]);
}
