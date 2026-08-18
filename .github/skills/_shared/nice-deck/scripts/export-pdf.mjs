import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { atomicWriteFile, previewDeck } from "./preview.mjs";

const viewport = { width: 1600, height: 900 };
const pageSize = { width: 1280, height: 720 };

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function exportDocument(slides) {
  const scaleX = pageSize.width / viewport.width;
  const scaleY = pageSize.height / viewport.height;
  // In-deck citation anchors survive as internal PDF links when both ends live
  // in the printed document, so map each slide id to its printed page.
  const pageForSlideId = new Map(
    slides.map((slide, index) => [slide.slideId, `nd-page-${index + 1}`]).filter(([id]) => id),
  );
  const pages = slides.map((slide, index) => {
    const links = slide.links.map((link) => {
      const target = link.href.startsWith("#")
        ? pageForSlideId.get(link.href.slice(1))
        : null;
      if (link.href.startsWith("#") && !target) return "";
      const href = target ? `#${target}` : link.href;
      const left = Math.max(0, Math.min(viewport.width, link.x));
      const top = Math.max(0, Math.min(viewport.height, link.y));
      const right = Math.max(0, Math.min(viewport.width, link.x + link.width));
      const bottom = Math.max(0, Math.min(viewport.height, link.y + link.height));
      const width = (right - left) * scaleX;
      const height = (bottom - top) * scaleY;
      if (width <= 0 || height <= 0) return "";
      return `<a href="${escapeHtml(href)}" style="left:${left * scaleX}px;top:${top * scaleY}px;width:${width}px;height:${height}px"></a>`;
    }).join("");
    return `<section id="nd-page-${index + 1}"><img src="data:image/png;base64,${slide.image}">${links}</section>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${pageSize.width}px ${pageSize.height}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  section {
    position: relative;
    width: ${pageSize.width}px;
    height: ${pageSize.height}px;
    break-after: page;
    overflow: hidden;
  }
  section:last-child { break-after: auto; }
  img { display: block; width: 100%; height: 100%; }
  a { position: absolute; display: block; }
</style>
</head>
<body>${pages}</body>
</html>`;
}

export async function exportDeck({ sourcePath, outputPath } = {}) {
  if (!sourcePath) throw new Error("sourcePath is required");
  const source = resolve(sourcePath);
  const extension = extname(source);
  const output = resolve(outputPath ?? `${source.slice(0, -extension.length)}.pdf`);
  await mkdir(dirname(output), { recursive: true });

  const preview = await previewDeck({ sourcePath: source, keepServer: true });
  let browser;
  try {
    if (!preview.ok) {
      throw new Error(`preview failed; inspect ${preview.previewFile}`);
    }

    browser = await chromium.launch();
    const context = await browser.newContext({
      reducedMotion: "reduce",
      serviceWorkers: "block",
      viewport,
    });
    const page = await context.newPage();
    await page.goto(preview.url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready);

    const runtimeReady = await page.evaluate(() => Boolean(window.__niceDeck));
    if (preview.screenshots.length > 1 && !runtimeReady) {
      throw new Error("multi-slide decks must load deck.js");
    }

    const slides = [];
    const skippedLinks = [];
    for (let index = 0; index < preview.screenshots.length; index += 1) {
      if (runtimeReady) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
      }
      await page.evaluate(() => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }));
      const linkData = await page.locator(".slide:visible").evaluateAll((elements) => {
        const slide = elements[0];
        const slideIds = new Set(
          [...document.querySelectorAll(".slide[id]")].map((element) => element.id),
        );
        const links = [];
        const skipped = [];
        for (const anchor of slide?.querySelectorAll("a[href]") ?? []) {
          const href = anchor.getAttribute("href").trim();
          const internal = href.startsWith("#") && slideIds.has(href.slice(1));
          if (!/^(?:https?:|mailto:)/i.test(href) && !internal) {
            skipped.push(href);
            continue;
          }
          const rect = anchor.getBoundingClientRect();
          links.push({ href, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        return { links, skipped, slideId: slide?.id ?? "" };
      });
      skippedLinks.push(...linkData.skipped);
      slides.push({
        image: (await readFile(preview.screenshots[index])).toString("base64"),
        links: linkData.links,
        slideId: linkData.slideId,
      });
    }

    await page.setContent(exportDocument(slides), { waitUntil: "load" });
    const pdf = await page.pdf({
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      printBackground: true,
    });
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error(`invalid PDF output: ${output}`);
    }
    await atomicWriteFile(output, pdf);

    return {
      links: slides.reduce((total, slide) => total + slide.links.length, 0),
      output,
      pages: slides.length,
      skippedLinks,
      sourceHash: preview.sourceHash,
    };
  } finally {
    await Promise.all([
      browser?.close() ?? Promise.resolve(),
      preview.server.close(),
    ]);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("usage: node export-pdf.mjs <deck.html> [deck.pdf]");
    process.exit(2);
  }

  try {
    const result = await exportDeck({
      sourcePath,
      outputPath: process.argv[3],
    });
    console.log(`pdf: ${result.output}`);
    console.log(`pages: ${result.pages}`);
    console.log(`links: ${result.links}`);
    if (result.skippedLinks.length) {
      console.log(`skipped unsupported links: ${result.skippedLinks.join(", ")}`);
    }
    console.log(`source hash: ${result.sourceHash}`);
  } catch (error) {
    console.error(`PDF export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
