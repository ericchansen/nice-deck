import { captureSlides, hashScreenshots } from "./capture.mjs";
import { auditVisibleCharts, auditReturningCharts } from "./checks/charts.mjs";
import { measureRegions, previewLayoutFindings, previewViewportFindings, viewportMatrix } from "./checks/layout.mjs";

async function auditLayout(page, slideIndex, budget) {
  return page.evaluate(measureRegions, { index: slideIndex, budget });
}

async function auditViewport(page, viewport, slideIndex) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForFunction(
    ({ width, height }) => {
      const geometry = window.__niceDeck?.geometry?.();
      return geometry
        && Math.abs(geometry.viewportWidth - width) < 1
        && Math.abs(geometry.viewportHeight - height) < 1;
    },
    { width: viewport.width, height: viewport.height },
  );
  await page.evaluate(async () => {
    await window.__niceDeck?.whenSettled?.();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  await page.evaluate((index) => window.__niceDeck?.goTo(index), slideIndex);
  await page.evaluate(() => window.__niceDeck?.whenSettled?.());
  return previewViewportFindings(page, viewport, slideIndex);
}

// The audit path wraps capture, not the other way around. Review assessment
// remains in the outer workflow, after the complete preview record is assembled.
export async function auditDeck(page, options, { budget }) {
  const chartAudit = [];
  const layoutIssues = [];
  const captured = await captureSlides(page, options, async (index) => {
    chartAudit.push(...await auditVisibleCharts(page, index));
    layoutIssues.push(...await previewLayoutFindings(page, index));
    layoutIssues.push(...await auditLayout(page, index, budget));
  });
  const { slideCount, runtimeReady, fixedCanvasReady, screenshots } = captured;
  const { captureMode } = options;
  if (!captureMode && slideCount > 1 && runtimeReady) {
    for (let index = slideCount - 1; index >= 0; index -= 1) {
      await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
      await page.evaluate(() => window.niceDeckCharts?.resize());
      await page.evaluate(() => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }));
      const returnIssues = await auditReturningCharts(page, index);
      chartAudit.push(...returnIssues);
    }
  }

  const screenshotHashes = await hashScreenshots(screenshots);
  const viewportAudit = [];
  if (fixedCanvasReady) {
    for (const viewport of viewportMatrix) {
      for (let index = 0; index < slideCount; index += 1) {
        viewportAudit.push(...await auditViewport(page, viewport, index));
        viewportAudit.push(...(await auditLayout(page, index, budget)).map((finding) => ({
          viewport: viewport.name,
          slide: index + 1,
          message: finding.message,
        })));
      }
    }
    for (const width of [1400, 1100, 800, 520]) {
      for (let index = 0; index < slideCount; index += 1) {
        viewportAudit.push(...await auditViewport(page, {
          width,
          height: 900,
          name: `live-resize-${width}`,
        }, index));
      }
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => window.__niceDeck.whenSettled?.());
  } else if (runtimeReady) {
    viewportAudit.push({
      viewport: "runtime",
      slide: 1,
      message: "fixed-canvas runtime geometry is unavailable",
    });
  }
  return { ...captured, screenshotHashes, chartAudit, layoutIssues, viewportAudit };
}
