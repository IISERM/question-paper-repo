#!/usr/bin/env node
/**
 * Fix QPR-LFS-R2 pointers whose R2 upload was pointer text instead of binary.
 *
 * The first migration wrote QPR pointers to the working tree but git-lfs
 * didn't smudge them (QPR text isn't a valid LFS pointer). The "binary"
 * uploaded to R2 was actually the QPR pointer text itself (~40-60 bytes).
 *
 * Real fix: reconstruct std-lfs pointers, git-lfs pull to get real binaries,
 * re-upload to R2, write QPR pointers again.
 *
 * Usage:
 *   node scripts/migrate-std-lfs-to-qpr.js
 *
 * Env vars:
 *   FILE_SERVER_URL  - Base URL of the LFS file-server worker
 *   DRY_RUN=1        - Preview only, no changes
 *   CONCURRENCY=N    - Max parallel uploads (default: 5)
 *   LIMIT=N          - Limit to N files (default: 0 = all)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL || "https://qpr-file-server.turingclub.workers.dev";
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || "5", 10) || 5);
const LIMIT = parseInt(process.env.LIMIT || "0", 10) || 0;
const DRY_RUN = process.env.DRY_RUN === "1";
const UPLOAD_RETRIES = 3;
const QPR_HEADER = "# QPR-LFS-R2 v1";

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }

// ── Find all QPR pointer files in HEAD ───────────────────────────

function findQprPointers() {
  log("Finding QPR-LFS-R2 pointer files in HEAD...");
  let output;
  try {
    output = execSync(
      `git grep -l '^# QPR-LFS-R2' HEAD -- '*.pdf' '*.doc' '*.docx' '*.ppt' '*.pptx' '*.xls' '*.xlsx' '*.jpg' '*.jpeg' '*.png' '*.gif' '*.webp' '*.bmp' '*.svg' '*.zip'`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    ).trim();
  } catch (e) {
    if (e.status === 1) { output = ""; }
    else { throw e; }
  }
  const files = output ? output.split("\n").filter(Boolean) : [];
  log(`  Found ${files.length} QPR pointer files.`);
  if (LIMIT > 0) return files.slice(0, LIMIT);
  return files;
}

// ── Parse QPR pointer to get OID ─────────────────────────────────

function parseQprPointer(filePath) {
  const content = execSync(
    `git cat-file -p "HEAD:${filePath}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 }
  );
  const oidMatch = content.match(/^oid:sha256:([a-f0-9]{64})$/m);
  const sizeMatch = content.match(/^size:(\d+)$/m);
  return {
    oid: oidMatch ? `sha256:${oidMatch[1]}` : null,
    committedSize: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
  };
}

// ── Reconstruct std-lfs pointer and git-lfs pull ─────────────────

function smudgeViaLfs(filePath, oid) {
  const relPath = filePath.startsWith("HEAD:") ? filePath.slice(5) : filePath;
  // Write std-lfs pointer text — git-lfs will smudge it
  const stdPointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid.slice(7)}\nsize 0\n`;
  fs.writeFileSync(relPath, stdPointer, "utf-8");
  // git lfs pull for this specific file
  try {
    execSync(`git lfs pull --include="${relPath}" --exclude=""`, {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
    });
  } catch (e) {
    throw new Error(`git lfs pull failed: ${e.stderr || e.message}`);
  }
  return fs.readFileSync(relPath);
}

// ── Upload to R2 ─────────────────────────────────────────────────

async function uploadToR2(oid, binaryContent) {
  const url = `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(oid)}`;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: binaryContent,
        signal: AbortSignal.timeout(120000),
      });
      if (resp.ok) return;
      const text = await resp.text().catch(() => "");
      if (attempt < UPLOAD_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2**attempt, 15000)));
      } else {
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt < UPLOAD_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2**attempt, 15000)));
      } else { throw e; }
    }
  }
}

// ── Migrate one file ─────────────────────────────────────────────

async function migrateOne(filePath) {
  const relPath = filePath.startsWith("HEAD:") ? filePath.slice(5) : filePath;
  try {
    const { oid, committedSize } = parseQprPointer(filePath);
    if (!oid) return { status: "ERROR", message: "Could not parse OID", path: relPath };

    // Check if R2 already has real binary (not pointer text)
    // Pointer text is ~40-60 bytes. Real binaries are at least 1 KB.
    const checkUrl = `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(oid)}`;
    let existingSize = 0;
    try {
      const headResp = await fetch(checkUrl, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      if (headResp.ok) {
        existingSize = parseInt(headResp.headers.get("content-length") || "0", 10);
      }
    } catch { /* can't check, proceed */ }

    if (existingSize > 500) {
      // Already has real binary in R2 — just fix the size in the pointer
      log(`  ${relPath}: R2 has ${(existingSize/1024).toFixed(1)} KB, fixing pointer size...`);
      if (!DRY_RUN) {
        fs.writeFileSync(relPath, `# QPR-LFS-R2 v1\noid:${oid}\nsize:${existingSize}\n`, "utf-8");
      }
      return { status: "OK", oid, size: existingSize, path: relPath };
    }

    // Need to get real binary from GitHub LFS
    log(`  ${relPath}: R2 has ${existingSize} bytes (pointer text). Fetching binary from GitHub LFS...`);

    // Reconstruct std-lfs pointer, git lfs pull to smudge
    const binary = smudgeViaLfs(filePath, oid);
    if (binary.length < 500) {
      return { status: "ERROR", message: `Smudged content too small (${binary.length} bytes)`, path: relPath };
    }

    // Verify hash
    const hash = crypto.createHash("sha256").update(binary).digest("hex");
    const actualOid = `sha256:${hash}`;
    if (actualOid !== oid) {
      return { status: "ERROR", message: `OID mismatch: expected ${oid}, got ${actualOid}`, path: relPath };
    }

    log(`    Smudged: ${(binary.length/1024).toFixed(1)} KB`);

    if (DRY_RUN) {
      return { status: "DRY_RUN", oid, size: binary.length, path: relPath };
    }

    // Upload to R2 (overwrite pointer text with real binary)
    await uploadToR2(oid, binary);

    // Write QPR pointer with correct size
    fs.writeFileSync(relPath, `# QPR-LFS-R2 v1\noid:${oid}\nsize:${binary.length}\n`, "utf-8");

    return { status: "OK", oid, size: binary.length, path: relPath };
  } catch (error) {
    return { status: "ERROR", message: error.message, path: relPath };
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  log("=== QPR-LFS-R2 Binary Fix ===\n");
  log(`File server : ${FILE_SERVER_URL}`);
  log(`Concurrency : ${CONCURRENCY}`);
  if (DRY_RUN) log("DRY RUN     : No files will be modified\n");

  const files = findQprPointers();
  if (files.length === 0) {
    log("No QPR pointer files found.");
    return;
  }

  // Strip HEAD: prefix from git grep output
  const cleanFiles = files.map(f => f.startsWith("HEAD:") ? f.slice(5) : f);

  const startTime = Date.now();
  const results = [];
  let fixed = 0, errors = 0;

  for (let i = 0; i < cleanFiles.length; i += CONCURRENCY) {
    const batch = cleanFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(f => migrateOne(f)));
    results.push(...batchResults);

    const done = Math.min(i + CONCURRENCY, cleanFiles.length);
    const ok = batchResults.filter(r => r.status === "OK").length;
    const dry = batchResults.filter(r => r.status === "DRY_RUN").length;
    const err = batchResults.filter(r => r.status === "ERROR").length;

    for (const r of batchResults) {
      if (r.status === "ERROR") warn(`  ❌ ${r.path}: ${r.message}`);
    }
    log(`  [${done}/${cleanFiles.length}] OK: ${ok}, Dry: ${dry}, Err: ${err}\n`);
    fixed += ok + dry;
    errors += err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n=== Done in ${elapsed}s ===`);
  log(`Fixed  : ${fixed}`);
  log(`Errors : ${errors}`);

  const summary = [
    `# QPR Binary Fix Report`,
    `# Generated: ${new Date().toISOString()}`,
    `# Elapsed: ${elapsed}s`,
    `# Fixed: ${fixed} | Errors: ${errors}`,
    `#`,
    ...results.map(r => `${r.status} | ${r.path} | ${r.oid || ""} | ${r.size ? (r.size/1024).toFixed(1)+" KB" : ""} | ${r.message || ""}`),
  ].join("\n");

  if (!DRY_RUN) {
    fs.writeFileSync("scripts/qpr-binary-fix-report.txt", summary, "utf-8");
  }

  if (errors > 0) {
    log(`\n⚠️  ${errors} file(s) had errors.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
