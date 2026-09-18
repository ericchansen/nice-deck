import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./files.mjs";
import { auditContrast } from "./checks/contrast.mjs";
import { prepareCharts } from "./checks/charts.mjs";

// Captures selected slides with readiness, contrast and browser-error checks.
// No source scan, exhaustive layout/viewport work, or review assessment lives here.
export async function captureSlides(page, {
  slideIds, isOutline, captureMode, renderDirectory, browserErrors,
}, onSlide) {
  const contrast = [];
  const contrastUnverified = [];
  const screenshots = [];
  const slideCount = await page.locator(".slide").count() || 1;
  const deckSlideIds = await page.locator(".slide").evaluateAll((slides) => (
    slides.map((slide) => slide.dataset.slideId || slide.id || null)
  ));
  const htmlSlideIds = await page.locator(".slide").evaluateAll((slides) => (
    slides.map((slide) => slide.id)
  ));
  const indices = slideIds === undefined
    ? Array.from({ length: slideCount }, (_, index) => index)
    : slideIds.map((id) => {
      const matches = deckSlideIds.flatMap((value, index) => (
        value === id || htmlSlideIds[index] === id ? [index] : []
      ));
      if (matches.length !== 1) throw new Error(`slide ID must match exactly one slide: ${id}`);
      return matches[0];
    }).sort((a, b) => a - b);
  if (new Set(indices).size !== indices.length) {
    throw new Error("slideIds must select unique slides, not multiple aliases of the same slide");
  }
  const runtimeReady = await page.evaluate(() => Boolean(window.__niceDeck));
  const fixedCanvasReady = await page.evaluate(() => (
    typeof window.__niceDeck?.geometry === "function"
    && typeof window.__niceDeck?.whenSettled === "function"
  ));
  if (!isOutline && !fixedCanvasReady) {
    browserErrors.push("runtime: decks must load the current fixed-canvas runtime/deck.js");
  }
  const chartCount = await page.locator("[data-echart], [data-chart]").count();
  if (slideCount > 1 && !runtimeReady) {
    browserErrors.push("runtime: multi-slide decks must load deck.js");
  }
  if (chartCount) {
    const chartRuntimeReady = await page.evaluate(() => Boolean(window.niceDeckCharts));
    if (!chartRuntimeReady) {
      browserErrors.push("charts: chart elements require the sanctioned nice-deck ECharts runtime");
    }
  }

  for (const index of indices) {
    if (runtimeReady) {
      await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
      await page.evaluate(() => window.__niceDeck.whenSettled?.());
    }
    // A slide revealed for the first time can start loading a font it is the
    // first to use. Measuring before that resolves yields fallback metrics.
    await page.evaluate(() => document.fonts?.ready);
    await prepareCharts(page, { chartCount, captureMode, index, browserErrors });
    await page.evaluate(() => new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    }));
    const visibleSlides = await page.locator(".slide:visible").count();
    if (slideCount > 1 && visibleSlides !== 1) {
      browserErrors.push(`visibility: expected 1 slide, found ${visibleSlides}`);
    }
    const unreadyCharts = await page.locator(
      `.slide:visible [data-echart]:not([data-chart-ready="true"]), `
      + `.slide:visible [data-chart]:not([data-chart-ready="true"])`,
    ).count();
    if (unreadyCharts) {
      browserErrors.push(
        `charts: slide ${index + 1} has ${unreadyCharts} chart(s) without data-chart-ready="true"`,
      );
    }
    // Audit supplies a per-slide measurement hook; feedback has no audit dependency.
    if (onSlide) await onSlide(index);

    const audit = await auditContrast(page, index);
    contrast.push(...audit.failures);
    contrastUnverified.push(...audit.unverified);

    const screenshot = join(
      renderDirectory,
      `slide-${String(index + 1).padStart(2, "0")}.png`,
    );
    await atomicWriteFile(screenshot, await page.screenshot());
    screenshots.push(screenshot);
  }

  return {
    slideCount, deckSlideIds, htmlSlideIds, indices, runtimeReady, fixedCanvasReady,
    screenshots, contrast, contrastUnverified,
  };
}

export async function hashScreenshots(screenshots) {
  return Promise.all(screenshots.map(async (screenshot) => (
    createHash("sha256").update(await readFile(screenshot)).digest("hex")
  )));
}
