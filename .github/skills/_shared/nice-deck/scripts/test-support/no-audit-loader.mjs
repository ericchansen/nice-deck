// Loaded only by the feedback boundary test's isolated child process. Throw on
// invocation (not import), so accidental audit work cannot hide behind [].
export async function load(url, context, nextLoad) {
  const exports = url.endsWith("/lib/audit.mjs")
    ? ["auditDeck"]
    : url.endsWith("/scripts/scan.mjs")
      ? ["scanWorkspace", "scanSource", "formatFindings"]
      : url.endsWith("/scripts/review.mjs")
        ? ["assessReview"]
        : null;
  if (!exports) return nextLoad(url, context);
  return {
    format: "module",
    shortCircuit: true,
    source: exports.map((name) => (
      `export function ${name}() { throw new Error("forbidden feedback operation: ${name}"); }`
    )).join("\n"),
  };
}
