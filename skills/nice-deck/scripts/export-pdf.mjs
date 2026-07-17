import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { previewDeck } from "./preview.mjs";

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
  const pages = slides.map((slide) => {
    const links = slide.links.map((link) => {
      const left = Math.max(0, link.x) * scaleX;
      const top = Math.max(0, link.y) * scaleY;
      const width = Math.min(viewport.width - link.x, link.width) * scaleX;
      const height = Math.min(viewport.height - link.y, link.height) * scaleY;
      if (width <= 0 || height <= 0) return "";
      return `<a href="${escapeHtml(link.href)}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"></a>`;
    }).join("");
    return `<section><img src="data:image/png;base64,${slide.image}">${links}</section>`;
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
    for (let index = 0; index < preview.screenshots.length; index += 1) {
      if (runtimeReady) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
      }
      await page.evaluate(() => new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
      }));
      const links = await page.locator(".slide:visible a[href]").evaluateAll((anchors) => (
        anchors.map((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return {
            href: anchor.getAttribute("href"),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        })
      ));
      slides.push({
        image: (await readFile(preview.screenshots[index])).toString("base64"),
        links,
      });
    }

    await page.setContent(exportDocument(slides), { waitUntil: "load" });
    await page.pdf({
      path: output,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      printBackground: true,
    });
    const pdf = await readFile(output);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error(`invalid PDF output: ${output}`);
    }

    return {
      links: slides.reduce((total, slide) => total + slide.links.length, 0),
      output,
      pages: slides.length,
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
    console.log(`source hash: ${result.sourceHash}`);
  } catch (error) {
    console.error(`PDF export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
