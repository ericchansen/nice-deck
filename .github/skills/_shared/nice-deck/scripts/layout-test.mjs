#!/usr/bin/env node
// Detects the two failure modes a fixed-size slide has and a web page does not:
// an element escaping the slide's padding box, and two text elements overlapping.
//
//   node scripts/layout-test.mjs <url> [stress]
//
// stress defaults to 1 (copy as authored). Pass 1.8 to inflate every heading,
// note, evidence and caveat by 80% and prove the layout has headroom.
// Exits 0 when every slide passes, 1 when any slide fails, 2 on bad usage.

import { chromium } from "playwright";

const url = process.argv[2];
const stress = Number(process.argv[3] ?? 1);
if (!url || !Number.isFinite(stress) || stress < 1 || stress > 5) {
  console.error("usage: node scripts/layout-test.mjs <url> [stress 1-5]");
  process.exit(2);
}

let failed = 0;
let slideCount = 0;
let viewportFailures = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.fonts?.ready);

  slideCount = await page.evaluate(() => document.querySelectorAll(".slide").length);
  if (slideCount === 0) throw new Error("no .slide elements found, so there is nothing to check");
  const hasRuntime = await page.evaluate(() => typeof window.__niceDeck?.goTo === "function");
  if (!hasRuntime) {
    throw new Error("fixed-canvas runtime is required for every deck; sync runtime/deck.js");
  }
  const hasFixedCanvasRuntime = await page.evaluate(() => (
    typeof window.__niceDeck?.geometry === "function"
    && typeof window.__niceDeck?.whenSettled === "function"
  ));
  if (hasRuntime && !hasFixedCanvasRuntime) {
    throw new Error("fixed-canvas runtime is unavailable; sync runtime/deck.js before layout testing");
  }

  for (let index = 1; index <= slideCount; index += 1) {
    if (hasRuntime) await page.evaluate((slide) => window.__niceDeck.goTo(slide), index - 1);
    await page.waitForTimeout(500);

    if (stress > 1) {
      await page.evaluate((factor) => {
        const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
        const targets = "h1, h2, h3, [data-contract-field], .head-note, .reason, .caveat, .question, .sheet-sub";
        for (const element of slide.querySelectorAll(targets)) {
          if (element.dataset.stressed) continue;
          element.dataset.stressed = "1";
          const extra = Math.round(element.textContent.trim().length * (factor - 1));
          // append rather than assign, so nested <em>/<a> children survive
          element.append(document.createTextNode(` ${"wider ".repeat(Math.ceil(extra / 6))}`));
        }
      }, stress);
      await page.waitForTimeout(500);
    }

    const report = await page.evaluate(() => {
      const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
      if (!slide) return { id: "", overflow: ["no .slide element found"], overlaps: [] };
      const style = getComputedStyle(slide);
      const rect = slide.getBoundingClientRect();
      const scale = window.__niceDeck?.geometry?.().scale ?? 1;
      const pad = (value) => (Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0);
      const box = {
        left: rect.left + pad(style.paddingLeft) * scale,
        right: rect.right - pad(style.paddingRight) * scale,
        top: rect.top + pad(style.paddingTop) * scale,
        bottom: rect.bottom - pad(style.paddingBottom) * scale,
      };
      const exempt = (element) => element.closest("[data-chart], [data-echart], svg, pre, code");
      // A full-bleed background is allowed to escape the padding box, but it
      // has to say so. Overlap checking still applies to it.
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
        if (current.right > box.right + scale) escapes.push(`right ${Math.round(current.right - box.right)}px`);
        if (current.left < box.left - scale) escapes.push(`left ${Math.round(box.left - current.left)}px`);
        if (current.bottom > box.bottom + scale) escapes.push(`bottom ${Math.round(current.bottom - box.bottom)}px`);
        if (current.top < box.top - scale) escapes.push(`top ${Math.round(box.top - current.top)}px`);
        if (escapes.length) overflow.push(`${escapes.join(", ")} :: ${label(element)}`);
      }

      // Any element that renders its own text, regardless of tag. A hard-coded
      // tag list silently misses small, em, figcaption and text-bearing divs.
      const ownsText = (element) => [...element.childNodes]
        .some((node) => node.nodeType === 3 && node.textContent.trim());
      const texts = [...slide.querySelectorAll("*")]
        .filter((element) => !exempt(element) && ownsText(element));
      // Per-line boxes, not the bounding rect: a wrapping inline element's
      // bounding rect spans every line it touches and would falsely overlap
      // anything else on those lines. Measuring once per element also keeps
      // getClientRects out of the O(n^2) inner loop.
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
            overlaps.push(`${Math.round(worst.width)}x${Math.round(worst.height)}px :: ${label(measured[a].element)} over ${label(measured[b].element)}`);
          }
        }
      }
      return {
        id: slide.dataset.slideId ?? "",
        overflow: [...new Set(overflow)],
        overlaps: [...new Set(overlaps)],
      };
    });

    if (report.overflow.length || report.overlaps.length) {
      failed += 1;
      console.log(`FAIL ${index} ${report.id}`);
      report.overflow.slice(0, 6).forEach((line) => console.log(`   overflow: ${line}`));
      report.overlaps.slice(0, 6).forEach((line) => console.log(`   overlap : ${line}`));
    } else {
      console.log(`ok   ${index} ${report.id}`);
    }
  }

  if (hasRuntime) {
    const viewports = [
      [1600, 900],
      [1280, 720],
      [640, 360],
      [1600, 600],
      [700, 900],
      [520, 900],
    ];
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__niceDeck.whenSettled());
      for (let index = 0; index < slideCount; index += 1) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
        await page.evaluate(() => window.__niceDeck.whenSettled());
        const report = await page.evaluate(({ expectedWidth, expectedHeight }) => {
          const geometry = window.__niceDeck.geometry();
          const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
          const rect = slide.getBoundingClientRect();
          const scale = Math.min(
            expectedWidth / geometry.designWidth,
            expectedHeight / geometry.designHeight,
          );
          const width = geometry.designWidth * scale;
          const height = geometry.designHeight * scale;
          const tolerance = 1.5;
          const findings = [];
          if (Math.abs(geometry.scale - scale) > 0.002) findings.push("incorrect scale");
          if (Math.abs(rect.width - width) > tolerance || Math.abs(rect.height - height) > tolerance) {
            findings.push("incorrect rendered size");
          }
          if (
            Math.abs(rect.left - (expectedWidth - width) / 2) > tolerance
            || Math.abs(rect.top - (expectedHeight - height) / 2) > tolerance
          ) {
            findings.push("canvas is not centered");
          }
          if (
            document.documentElement.scrollWidth > expectedWidth + 1
            || document.documentElement.scrollHeight > expectedHeight + 1
          ) {
            findings.push("unexpected scrollbars");
          }
          return findings;
        }, { expectedWidth: width, expectedHeight: height });
        if (report.length) {
          viewportFailures += 1;
          console.log(`FAIL viewport ${width}x${height}, slide ${index + 1}: ${report.join(", ")}`);
        } else {
          console.log(`ok   viewport ${width}x${height}, slide ${index + 1}`);
        }
      }
    }
    failed += viewportFailures;
  }
} finally {
  await browser.close();
}

console.log(failed
  ? `\n${failed} slide or viewport checks fail at stress=${stress}`
  : `\nPASS at stress=${stress}: no overflow, text overlap, or viewport scaling failures`);
process.exit(failed ? 1 : 0);
