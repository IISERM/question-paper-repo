#!/usr/bin/env node
/**
 * LFS Migration Script
 *
 * Scans the repository for binary files (PDFs, images, etc.) and converts
 * them to Git LFS pointers. Uploads the binary content to the Cloudflare R2
 * bucket via the qpr-file-server worker.
 *
 * Running: node scripts/migrate-to-lfs.js
 *
 * Env vars:
 *   FILE_SERVER_URL  - Base URL of the LFS file-server worker (default: https://files.qpr.turingclub.workers.dev)
 *   DRY_RUN          - Set to "1" to preview without making changes
 *   CONCURRENCY      - Max parallel uploads (default: 10)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════
// Configuration — must match worker LFS_EXTENSIONS
// ═══════════════════════════════════════════════════════════════

const LFS_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "zip",
]);

const LFS_POINTER_HEADER = "version https://git-lfs.github.com/spec/v1";

const SKIP_DIRS = new Set([".git", "node_modules", "cloudflare-worker", "scripts", "docs"]);

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || "https://files.qpr.turingclub.workers.dev";
const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function isLFSExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  return LFS_EXTENSIONS.has(ext);
}

function shouldSkipPath(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some((p) => SKIP_DIRS.has(p));
}

function isAlreadyPointer(content) {
  return typeof content === "string" && content.startsWith(LFS_POINTER_HEADER);
}

/**
 * Compute SHA-256 of binary content and build LFS pointer.
 * Returns { pointer, oid, size, binary } — never throws.
 */
function createLFSPointer(binaryContent) {
  const hash = crypto.createHash("sha256").update(binaryContent).digest("hex");
  const oid = `sha256:${hash}`;
  const size = binaryContent.length;
  const pointer = `version https://git-lfs.github.com/spec/v1\noid ${oid}\nsize ${size}\n`;
  return { pointer, oid, size, binary: binaryContent };
}

async function uploadToR2(oid, binaryContent) {
  const url = `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(oid)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: binaryContent,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

function walkFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        results.push(...walkFiles(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  console.log("=== LFS Migration ===\n");
  console.log(`File server : ${FILE_SERVER_URL}`);
  console.log(`Concurrency : ${CONCURRENCY}`);
  if (DRY_RUN) console.log("DRY RUN     : No files will be modified\n");

  // 1. Find candidate files
  console.log("Scanning repository for binary files...");
  const allFiles = walkFiles(".");
  const candidates = allFiles.filter((f) => isLFSExtension(f) && !shouldSkipPath(f));
  console.log(`Found ${candidates.length} files with LFS extensions.\n`);

  if (candidates.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // 2. Classify: already pointers vs needs migration
  const toMigrate = [];
  let alreadyDone = 0;

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (isAlreadyPointer(content)) {
        alreadyDone++;
      } else {
        toMigrate.push(filePath);
      }
    } catch {
      // Binary file that can't be read as utf-8 — definitely needs migration
      toMigrate.push(filePath);
    }
  }

  console.log(`Already LFS pointers : ${alreadyDone}`);
  console.log(`Need migration      : ${toMigrate.length}\n`);

  if (toMigrate.length === 0) {
    console.log("All files are already migrated.");
    return;
  }

  // 3. Migrate with batching/concurrency
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const reportLines = [];

  async function migrateOne(filePath) {
    const relPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
    try {
      // Read as binary
      const binaryContent = fs.readFileSync(filePath);

      // Skip empty files
      if (binaryContent.length === 0) {
        console.log(`  SKIP (empty) : ${relPath}`);
        skipped++;
        reportLines.push(`${relPath} | SKIPPED | empty file`);
        return;
      }

      // Check again as binary to catch edge cases
      const headerStr = binaryContent.slice(0, 50).toString("utf-8");
      if (headerStr.startsWith(LFS_POINTER_HEADER)) {
        console.log(`  SKIP (pointer) : ${relPath}`);
        skipped++;
        reportLines.push(`${relPath} | SKIPPED | already LFS pointer`);
        return;
      }

      // Compute pointer
      const { pointer, oid, size } = createLFSPointer(binaryContent);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] ${relPath} → ${oid} (${(size / 1024).toFixed(1)} KB)`);
        reportLines.push(`${relPath} | WOULD_MIGRATE | ${oid} | ${size} bytes`);
        migrated++;
        return;
      }

      // Upload to R2
      console.log(`  UPLOAD ${relPath} → ${oid} (${(size / 1024).toFixed(1)} KB)`);
      await uploadToR2(oid, binaryContent);

      // Replace file with pointer
      fs.writeFileSync(filePath, pointer, "utf-8");

      migrated++;
      reportLines.push(`${relPath} | OK | ${oid} | ${size} bytes`);
    } catch (error) {
      console.error(`  ERROR ${relPath}: ${error.message}`);
      errors++;
      reportLines.push(`${relPath} | ERROR | ${error.message}`);
    }
  }

  // Process in batches with concurrency limit
  for (let i = 0; i < toMigrate.length; i += CONCURRENCY) {
    const batch = toMigrate.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(migrateOne));
    // Progress
    const done = Math.min(i + CONCURRENCY, toMigrate.length);
    console.log(`  ... ${done}/${toMigrate.length} files processed\n`);
  }

  // 4. Write summary report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = [
    `# LFS Migration Report`,
    `# Generated: ${new Date().toISOString()}`,
    `# Elapsed: ${elapsed}s`,
    `# Migrated: ${migrated} | Skipped: ${skipped} | Errors: ${errors}`,
    `#`,
    ...reportLines,
  ].join("\n");

  if (!DRY_RUN) {
    fs.writeFileSync("scripts/lfs-migration-report.txt", summary, "utf-8");
  }

  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(`Migrated : ${migrated}`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Errors   : ${errors}`);
  console.log(`Report   : scripts/lfs-migration-report.txt`);

  if (errors > 0) {
    console.error(`\n⚠️  ${errors} file(s) had errors. Check the report for details.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
