// nice-deck screenshot verifier.
//
// Loads a deck URL, walks every slide with ArrowRight, screenshots each one,
// and fails (non-zero exit) if the page logged any console errors or threw.
// This is the "verify before you report" gate, encoded.
//
// Requires a local Playwright install:  npm i playwright  (then npx playwright install chromium)
//
// Usage:
//   node check.js <url> [prefix] [outDir]
//   node check.js http://localhost:8000/deck.html stage ./_renders
//
// Screenshots are written to <outDir>/<prefix>-s<N>.png (default: cwd, prefix "slide").

const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright not found. Run:  npm i playwright && npx playwright install chromium');
  process.exit(2);
}

const url = process.argv[2];
const prefix = process.argv[3] || 'slide';
const outDir = process.argv[4] || '.';

if (!url) {
  console.error('usage: node check.js <url> [prefix] [outDir]');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: 'networkidle' });

  // Count slides from the DOM (falls back to 1 if the deck isn't .slide-based).
  const total = await page.$$eval('.slide', (els) => els.length).catch(() => 0) || 1;

  for (let n = 1; n <= total; n++) {
    // First and last slides often run typers / counters — give them longer.
    const wait = (n === 1 || n === total) ? 4200 : 3000;
    await page.waitForTimeout(wait);
    const file = path.join(outDir, `${prefix}-s${n}.png`);
    await page.screenshot({ path: file });
    process.stdout.write(`  ${String(n).padStart(2, '0')}/${String(total).padStart(2, '0')} ${file}\n`);
    if (n < total) await page.keyboard.press('ArrowRight');
  }

  await browser.close();

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} console error(s):`);
    errors.slice(0, 20).forEach((e) => console.error('  ' + e));
    process.exit(1);
  }
  console.log(`\nOK — ${total}/${total} slides, no errors.`);
})();
