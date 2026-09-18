import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sanctionedRuntimeRoot = resolve(here, "..", "..", "runtime");
const sanctionedRuntimeFiles = [
  "echarts.min.js",
  "charts.js",
];
const sanctionedRuntimeManifest = "chart-runtime.manifest.json";

export async function validateSanctionedRuntime(sources, { required = true } = {}) {
  if (!required) return [];
  const manifest = JSON.parse(
    await readFile(join(sanctionedRuntimeRoot, sanctionedRuntimeManifest), "utf8"),
  );
  const findings = [];
  for (const name of sanctionedRuntimeFiles) {
    const source = sources.find(
      ({ path }) => path === join("runtime", ...name.split("/")),
    );
    const expected = manifest.files?.[name]?.sha256;
    const actual = source ? createHash("sha256").update(source.content).digest("hex") : null;
    if (!expected || actual !== expected) {
      findings.push({
        file: name,
        message: "Sanctioned chart runtime hash does not match chart-runtime.manifest.json.",
      });
    }
  }
  return findings;
}

// Capture readiness is intentionally independent of exhaustive chart auditing.
export async function prepareCharts(page, { chartCount, captureMode, index, browserErrors }) {
  if (chartCount) {
    try {
      await page.evaluate(async () => {
        await window.niceDeckCharts.resize();
        const visibleCharts = [...document.querySelectorAll(
          ".slide:not([hidden]) [data-chart], .slide:not([hidden]) [data-echart]",
        )];
        const deadline = performance.now() + 5000;
        while (
          visibleCharts.some((element) => element.dataset.chartReady !== "true")
          && performance.now() < deadline
        ) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 25));
        }
        if (visibleCharts.some((element) => element.dataset.chartReady !== "true")) {
          throw new Error("visible chart readiness timed out after 5000ms");
        }
      });
    } catch (error) {
      browserErrors.push(`charts: readiness failed on slide ${index + 1}: ${error.message}`);
    }
  }
  if (chartCount && captureMode) {
    try {
      await page.evaluate(() => window.niceDeckCharts.prepareVisible());
    } catch (error) {
      browserErrors.push(`charts: reset failed on slide ${index + 1}: ${error.message}`);
    }
  }
}

export async function auditVisibleCharts(page, index) {
  return await page.evaluate((slideIndex) => {
    const slide = document.querySelector(".slide:not([hidden])") ?? document.querySelector(".slide");
    const findings = [];
    for (const element of slide?.querySelectorAll("[data-chart], [data-echart]") ?? []) {
      const rect = element.getBoundingClientRect();
      const svg = element.querySelector("svg");
      const marks = svg?.querySelectorAll("path, rect, circle, polygon").length ?? 0;
      if (rect.width <= 0 || rect.height <= 0) findings.push("container has zero dimensions");
      if (!svg || svg.getBoundingClientRect().width <= 0 || svg.getBoundingClientRect().height <= 0) {
        findings.push("SVG is missing or zero-dimensional");
      }
      if (marks === 0) findings.push("SVG has no visible marks");
      if (!element.dataset.visibleTakeaway) findings.push("visible takeaway metadata is missing");
      if (!slide.querySelector("[data-citation]")) findings.push("visible citation is missing");
      if (element.dataset.chartError === "true") findings.push("runtime error state is visible");
    }
    return findings.map((message) => ({ slide: slideIndex + 1, message }));
  }, index);
}

export async function auditReturningCharts(page, index) {
  return await page.evaluate((slideIndex) => {
    const slide = document.querySelector(".slide:not([hidden])");
    return [...(slide?.querySelectorAll("[data-chart], [data-echart]") ?? [])]
      .filter((element) => {
        const rect = element.querySelector("svg")?.getBoundingClientRect();
        return !rect || rect.width <= 0 || rect.height <= 0;
      })
      .map(() => ({ slide: slideIndex + 1, message: "chart failed after return navigation" }));
  }, index);
}
