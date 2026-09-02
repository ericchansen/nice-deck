#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

export const requiredReviewRoles = [
  "cold-read",
  "art-direction",
  "image-text-proof",
  "geometry-citations",
];

function isWithin(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function resolveWorkspace(workspace) {
  if (!workspace) throw new Error("workspace is required");
  return realpath(resolve(workspace));
}

async function resolvePreview(root, previewPath) {
  const path = resolve(previewPath ?? join(root, "_renders", "preview.json"));
  if (!isWithin(root, path)) throw new Error("preview record must stay inside the workspace");
  if (!await exists(path)) throw new Error(`preview record is missing: ${path}`);
  return { path, value: await readJson(path, "preview record") };
}

async function generatedAssets(root) {
  const manifestPath = join(root, "visual-manifest.json");
  if (!await exists(manifestPath)) return [];
  const manifest = await readJson(manifestPath, "visual manifest");
  const assets = [];
  for (const slide of manifest.slides ?? []) {
    if (!slide.generatedAsset) continue;
    const path = resolve(root, slide.generatedAsset);
    if (!isWithin(root, path) || !await exists(path)) {
      throw new Error(`generated asset is missing or outside workspace: ${slide.generatedAsset}`);
    }
    assets.push({
      slideId: String(slide.id),
      file: relative(root, path),
      sha256: await sha256(path),
    });
  }
  return assets;
}

function roleTemplate(role) {
  return {
    role,
    verdict: "pending",
    reviewerContext: "screenshot-first",
    reviewedScreenshotHashes: [],
    findings: [],
    reviewedAt: null,
  };
}

export async function initReview({ workspace, previewPath } = {}) {
  const root = await resolveWorkspace(workspace);
  const preview = await resolvePreview(root, previewPath);
  if (!preview.value.ok) throw new Error("mechanically failing previews cannot enter adversarial review");
  const sourceHash = String(preview.value.sourceHash ?? "");
  if (!/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error("preview sourceHash is missing or invalid");
  if (
    !Array.isArray(preview.value.screenshots)
    || preview.value.screenshots.length === 0
    || preview.value.screenshots.length !== preview.value.screenshotHashes?.length
  ) {
    throw new Error("preview screenshots and hashes are incomplete");
  }

  const reviewRoot = resolve(root, "reviews", sourceHash);
  if (!isWithin(root, reviewRoot)) throw new Error("review directory resolves outside workspace");
  await mkdir(reviewRoot, { recursive: true });
  const reviewPath = join(reviewRoot, "review.json");
  if (await exists(reviewPath)) return { root, reviewPath, created: false };

  const screenshots = [];
  for (let index = 0; index < preview.value.screenshots.length; index += 1) {
    const source = resolve(preview.value.screenshots[index]);
    if (!await exists(source)) throw new Error(`preview screenshot is missing: ${source}`);
    const file = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const destination = join(reviewRoot, file);
    await copyFile(source, destination);
    const hash = await sha256(destination);
    if (hash !== preview.value.screenshotHashes[index]) {
      throw new Error(`preview screenshot hash mismatch: ${basename(source)}`);
    }
    screenshots.push({ slide: index + 1, file, sha256: hash });
  }

  const record = {
    version: 1,
    sourceHash,
    previewFile: relative(root, preview.path),
    createdAt: new Date().toISOString(),
    screenshots,
    generatedAssets: await generatedAssets(root),
    roles: requiredReviewRoles.map(roleTemplate),
  };
  await writeFile(reviewPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return { root, reviewPath, created: true };
}

function sameSet(first, second) {
  return first.length === second.length
    && [...first].sort().every((value, index) => value === [...second].sort()[index]);
}

function reviewShapeFindings(review) {
  const findings = [];
  const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return ["review record must be an object"];
  }
  if (review.version !== 1) findings.push("review version must be 1");
  if (!validHash(review.sourceHash)) findings.push("review sourceHash is invalid");
  if (!Array.isArray(review.screenshots) || review.screenshots.length === 0) {
    findings.push("review screenshots must be a non-empty array");
  } else {
    for (const screenshot of review.screenshots) {
      if (
        !screenshot
        || !Number.isInteger(screenshot.slide)
        || screenshot.slide < 1
        || typeof screenshot.file !== "string"
        || !screenshot.file
        || !validHash(screenshot.sha256)
      ) {
        findings.push("review screenshot entry is invalid");
        break;
      }
    }
  }
  if (!Array.isArray(review.generatedAssets)) {
    findings.push("review generatedAssets must be an array");
  } else {
    for (const asset of review.generatedAssets) {
      if (
        !asset
        || typeof asset.slideId !== "string"
        || !asset.slideId
        || typeof asset.file !== "string"
        || !asset.file
        || !validHash(asset.sha256)
      ) {
        findings.push("review generated-asset entry is invalid");
        break;
      }
    }
  }
  if (!Array.isArray(review.roles)) {
    findings.push("review roles must be an array");
  } else {
    for (const role of review.roles) {
      if (
        !role
        || !requiredReviewRoles.includes(role.role)
        || !["pending", "approve", "revise"].includes(role.verdict)
        || role.reviewerContext !== "screenshot-first"
        || !Array.isArray(role.reviewedScreenshotHashes)
        || role.reviewedScreenshotHashes.some((value) => !validHash(value))
        || !Array.isArray(role.findings)
        || role.findings.some((value) => typeof value !== "string")
        || !(role.reviewedAt === null || typeof role.reviewedAt === "string")
      ) {
        findings.push(`review role entry is invalid: ${role?.role ?? "unknown"}`);
      }
    }
  }
  return findings;
}

async function currentReviewEvidence(root, preview) {
  return {
    sourceHash: preview.sourceHash,
    screenshots: preview.screenshotHashes ?? [],
    generatedAssets: await generatedAssets(root),
  };
}

export async function assessReview({ workspace, previewPath, previewRecord } = {}) {
  const root = await resolveWorkspace(workspace);
  const preview = previewRecord ?? (await resolvePreview(root, previewPath)).value;
  const sourceHash = String(preview.sourceHash ?? "");
  const reviewPath = join(root, "reviews", sourceHash, "review.json");
  const result = {
    status: "missing",
    path: relative(root, reviewPath),
    requiredRoles: requiredReviewRoles,
    findings: [],
  };
  if (!await exists(reviewPath)) {
    const reviewsRoot = join(root, "reviews");
    if (await exists(reviewsRoot)) {
      for (const entry of await readdir(reviewsRoot, { withFileTypes: true })) {
        if (
          entry.isDirectory()
          && entry.name !== sourceHash
          && await exists(join(reviewsRoot, entry.name, "review.json"))
        ) {
          return {
            ...result,
            status: "stale",
            findings: ["a prior review exists for different rendered content"],
          };
        }
      }
    }
    return result;
  }

  let review;
  try {
    review = await readJson(reviewPath, "review record");
  } catch (error) {
    return { ...result, status: "rejected", findings: [error.message] };
  }
  const shapeFindings = reviewShapeFindings(review);
  if (shapeFindings.length) {
    return { ...result, status: "rejected", findings: shapeFindings };
  }
  const reviewRoot = resolve(reviewPath, "..");
  for (const screenshot of review.screenshots) {
    const path = resolve(reviewRoot, screenshot.file);
    if (
      !isWithin(reviewRoot, path)
      || !await exists(path)
      || await sha256(path) !== screenshot.sha256
    ) {
      return {
        ...result,
        status: "stale",
        findings: [`review screenshot is missing or changed: ${screenshot.file}`],
      };
    }
  }
  const evidence = await currentReviewEvidence(root, preview);
  if (review.version !== 1 || review.sourceHash !== evidence.sourceHash) {
    return { ...result, status: "stale", findings: ["review source hash does not match preview"] };
  }
  const reviewedScreenshots = (review.screenshots ?? []).map(({ sha256: hash }) => hash);
  if (!sameSet(reviewedScreenshots, evidence.screenshots)) {
    return { ...result, status: "stale", findings: ["review screenshot hashes do not match preview"] };
  }
  const currentAssets = new Map(evidence.generatedAssets.map((asset) => (
    [`${asset.slideId}\0${asset.file}`, asset.sha256]
  )));
  if (
    (review.generatedAssets ?? []).length !== currentAssets.size
    || (review.generatedAssets ?? []).some((asset) => (
      currentAssets.get(`${asset.slideId}\0${asset.file}`) !== asset.sha256
    ))
  ) {
    return { ...result, status: "stale", findings: ["review generated-asset hashes do not match workspace"] };
  }

  const roles = new Map();
  for (const role of review.roles ?? []) {
    if (roles.has(role.role)) {
      result.findings.push(`duplicate review role: ${role.role}`);
    }
    roles.set(role.role, role);
  }
  for (const name of requiredReviewRoles) {
    const role = roles.get(name);
    if (!role) {
      result.findings.push(`missing review role: ${name}`);
      continue;
    }
    if (
      role.reviewerContext !== "screenshot-first"
      || !sameSet(role.reviewedScreenshotHashes ?? [], evidence.screenshots)
    ) {
      result.findings.push(`${name} did not confirm the exact screenshots`);
    }
    if (role.verdict === "revise" || (role.findings ?? []).length) {
      result.findings.push(`${name} requires revision`);
    } else if (role.verdict !== "approve" || !role.reviewedAt) {
      result.findings.push(`${name} is pending`);
    }
  }
  if (result.findings.some((item) => item.includes("requires revision"))) {
    return { ...result, status: "rejected" };
  }
  if (result.findings.length) return { ...result, status: "pending" };
  return { ...result, status: "approved" };
}

export async function validateReview(options = {}) {
  const result = await assessReview(options);
  if (result.status !== "approved") {
    throw new Error(`adversarial review is ${result.status}: ${result.findings.join("; ") || result.path}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const command = process.argv[2];
  const workspace = process.argv[3];
  const previewPath = process.argv[4];
  try {
    if (command === "init") {
      const result = await initReview({ workspace, previewPath });
      console.log(`review ${result.created ? "created" : "exists"}: ${result.reviewPath}`);
    } else if (command === "validate") {
      const result = await validateReview({ workspace, previewPath });
      console.log(`review approved: ${result.path}`);
    } else {
      throw new Error("usage: review.mjs <init|validate> <workspace> [preview.json]");
    }
  } catch (error) {
    console.error(`review ${command ?? "command"} failed: ${error.message}`);
    process.exitCode = 1;
  }
}
