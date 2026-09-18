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
import {
  standaloneLayoutReport,
  standaloneViewportFindings,
  viewportMatrix,
} from "../lib/checks/layout.mjs";

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

    const report = await standaloneLayoutReport(page);

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
    for (const { width, height } of viewportMatrix) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__niceDeck.whenSettled());
      for (let index = 0; index < slideCount; index += 1) {
        await page.evaluate((slideIndex) => window.__niceDeck.goTo(slideIndex), index);
        await page.evaluate(() => window.__niceDeck.whenSettled());
        const report = await standaloneViewportFindings(page, width, height);
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
