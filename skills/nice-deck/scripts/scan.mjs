import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const rules = [
  {
    name: "gradient-text",
    pattern: /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/i,
    message: "Gradient text is banned. Use solid color, weight, or size.",
  },
  {
    name: "side-stripe",
    pattern: /border-(?:left|right)\s*:\s*(?:[2-9]|\d\d)\s*px/i,
    message: "Use a full border, background tint, icon, or no accent.",
  },
  {
    name: "numbered-eyebrow",
    pattern: /class=["'][^"']*(?:kicker|eyebrow)[^"']*["']|>\s*0[1-9]\s*(?:&nbsp;|\s|\/|·)/i,
    message: "Drop repeated eyebrow scaffolding unless the number carries order.",
  },
  {
    name: "cream-token",
    pattern: /--(?:paper|cream|sand|linen|ivory|parchment|bone|flour|wheat|biscuit)\b/i,
    message: "Warm-paper defaults are banned. Choose color from the deck brief.",
  },
  {
    name: "glass-default",
    pattern: /backdrop-filter\s*:\s*blur/i,
    message: "Decorative glassmorphism is banned.",
  },
];

export function scanSource(source) {
  const findings = [];

  for (const rule of rules) {
    const match = source.match(rule.pattern);
    if (match) {
      findings.push({
        name: rule.name,
        message: rule.message,
        sample: match[0].trim().slice(0, 60),
      });
    }
  }

  if (
    /@keyframes|transition\s*:|animation\s*:/i.test(source)
    && !/prefers-reduced-motion/i.test(source)
  ) {
    findings.push({
      name: "no-reduced-motion",
      message: "Animation requires a prefers-reduced-motion alternative.",
      sample: "",
    });
  }

  return findings;
}

export async function scanFile(file) {
  return scanSource(await readFile(file, "utf8"));
}

export function formatFindings(findings) {
  if (!findings.length) return "clean - no deterministic design issues";
  return findings
    .map((finding) => (
      `${finding.file ? `${finding.file}: ` : ""}[${finding.name}] ${finding.message}`
      + `${finding.sample ? ` (${finding.sample})` : ""}`
    ))
    .join("\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scan.mjs <file.html|file.css>");
    process.exit(2);
  }

  try {
    const findings = await scanFile(file);
    const output = formatFindings(findings);
    (findings.length ? console.error : console.log)(output);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`cannot scan ${file}: ${error.message}`);
    process.exitCode = 2;
  }
}
