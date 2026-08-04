/**
 * R2 Orphan Cleanup Script
 *
 * Scans the R2 bucket for LFS objects, compares against OIDs referenced
 * in the git repo's LFS pointers, and deletes orphans (objects in R2
 * that no longer have a corresponding pointer file in the repo).
 *
 * Usage (GitHub Actions):
 *   node scripts/r2-sync-cleanup.js
 *
 * Environment:
 *   DRY_RUN=1          Preview only, no deletion (default: 1)
 *   WRANGLER_DIR       Path to wrangler project directory (default: cloudflare-worker/file-server)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.env.DRY_RUN !== "0";
const WRANGLER_DIR = process.env.WRANGLER_DIR || "cloudflare-worker/file-server";
const OID_PATTERN = /^sha256:[a-f0-9]{64}$/;

function log(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function die(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function wrangler(cmd) {
  try {
    return execSync(`npx wrangler ${cmd}`, {
      cwd: WRANGLER_DIR,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024, // 50 MB
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const stderr = e.stderr || "";
    log(`[wrangler error] ${stderr.slice(0, 500)}`);
    throw e;
  }
}

// ────────────────────────────────────────────────────────────────────
// Step 1: List all objects in R2
// ────────────────────────────────────────────────────────────────────
function listR2Objects() {
  log("Listing R2 objects (this may take a moment)...");
  const output = wrangler("r2 object list qpr-lfs --json --no-cursor");

  let data;
  try {
    data = JSON.parse(output);
  } catch (e) {
    die(`Failed to parse wrangler output: ${e.message}\nOutput: ${output.slice(0, 500)}`);
  }

  // Handle various wrangler output shapes:
  // - Array of strings: ["sha256:abc...", "sha256:def..."]
  // - Array of objects: [{key: "...", size: ...}, ...]
  // - Object with result/keys: {result: [...], ...}
  let items;
  if (Array.isArray(data)) {
    items = data;
  } else if (data && Array.isArray(data.result)) {
    items = data.result;
  } else if (data && Array.isArray(data.keys)) {
    items = data.keys;
  } else {
    die(`Unexpected wrangler output format. Data keys: ${Object.keys(data || {}).join(", ")}`);
  }

  const keys = new Set();
  for (const item of items) {
    const key = typeof item === "string" ? item : (item.key || item.name || String(item));
    keys.add(key);
  }

  // Warn about non-OID-format keys
  const nonOidKeys = [...keys].filter((k) => !OID_PATTERN.test(k));
  if (nonOidKeys.length > 0) {
    warn(`Note: ${nonOidKeys.length} R2 object(s) have non-OID keys (will be excluded from cleanup):`);
    nonOidKeys.slice(0, 10).forEach((k) => warn(`  ${k}`));
    if (nonOidKeys.length > 10) warn(`  ... and ${nonOidKeys.length - 10} more`);
  }

  log(`Found ${keys.size} object(s) in R2 (${nonOidKeys.length} non-OID).`);
  return { keys, nonOidKeys: new Set(nonOidKeys) };
}

// ────────────────────────────────────────────────────────────────────
// Step 2: Extract all LFS pointer OIDs from the git repo
// ────────────────────────────────────────────────────────────────────
function extractLfsOids() {
  log("Extracting LFS pointer OIDs from git repo...");

  // Use git grep with attr filter to only search LFS-tracked files.
  // This is dynamic — it reads .gitattributes to know which files have filter=lfs.
  let output;
  try {
    // Match both formats: QPR-LFS-R2 ("oid:sha256:...") and std git-lfs ("oid sha256:...")
    output = execSync(
      `git grep -hE '^oid[: ] sha256:' -- ':(attr:filter=lfs)'`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (e) {
    // git grep returns exit code 1 if no matches found — that's OK
    if (e.status === 1 && (!e.stderr || e.stderr.length === 0)) {
      output = "";
    } else {
      throw e;
    }
  }

  const oids = new Set();
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const match = line.match(/^oid[: ]\s*(sha256:[a-f0-9]{64})/);
    if (match) {
      oids.add(match[1]);
    }
  }

  log(`Found ${oids.size} unique OID(s) in LFS pointers.`);
  return oids;
}

// ────────────────────────────────────────────────────────────────────
// Step 3: Find and delete orphans
// ────────────────────────────────────────────────────────────────────
function deleteOrphan(oid) {
  try {
    wrangler(`r2 object delete "qpr-lfs/${oid}"`);
    return true;
  } catch (e) {
    warn(`  Failed: ${e.message}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────
async function main() {
  log("=== R2 Orphan Cleanup ===");
  log(`Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "LIVE (will delete)"}`);
  log("");

  // 1. List R2
  const { keys: r2Keys, nonOidKeys } = listR2Objects();

  // 2. Extract LFS OIDs from repo
  const lfsOids = extractLfsOids();

  // 3. Compute orphans (in R2 but not in git)
  //    Exclude non-OID keys from orphan detection — they may be intentional non-LFS objects
  const orphans = [...r2Keys].filter(
    (key) => OID_PATTERN.test(key) && !lfsOids.has(key)
  );

  log("");
  log(`Orphans (in R2 but not in git): ${orphans.length}`);

  if (orphans.length === 0) {
    log("R2 is in sync with git. Nothing to do.");
    return;
  }

  // Print orphans (limit display to 50 for readability)
  const displayCount = Math.min(orphans.length, 50);
  for (let i = 0; i < displayCount; i++) {
    log(`  ${orphans[i]}`);
  }
  if (orphans.length > 50) {
    log(`  ... and ${orphans.length - 50} more`);
  }
  log("");

  if (DRY_RUN) {
    log("DRY RUN: No objects deleted.");
    log("Re-run with DRY_RUN=0 to perform actual cleanup.");
    return;
  }

  // 4. Delete orphans
  log(`Deleting ${orphans.length} orphaned object(s)...`);
  let deleted = 0;
  let failed = 0;

  for (const oid of orphans) {
    log(`Deleting: ${oid}`);
    if (deleteOrphan(oid)) {
      deleted++;
    } else {
      failed++;
    }
  }

  log("");
  log(`Done. Deleted: ${deleted}, Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
