#!/usr/bin/env node
/**
 * Migrate standard git-lfs pointer files to QPR-LFS-R2 format.
 *
 * Downloads binary content from GitHub LFS API (by OID), uploads to R2,
 * and swaps standard LFS pointers for QPR-LFS-R2 pointers.
 *
 * Does NOT rely on git-lfs smudge — works with .gitattributes
 * stripped of filter=lfs.
 *
 * Usage:
 *   node scripts/migrate-std-lfs-to-qpr.js
 *
 * Env vars:
 *   FILE_SERVER_URL  - Base URL of the LFS file-server worker
 *   GITHUB_TOKEN      - GitHub token (for LFS API auth)
 *   DRY_RUN=1         - Preview only, no changes
 *   CONCURRENCY=N     - Max parallel operations (default: 5)
 *   LIMIT=N           - Limit to N files (default: 0 = all)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL || "https://qpr-file-server.turingclub.workers.dev";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || "5", 10) || 5);
const LIMIT = parseInt(process.env.LIMIT || "0", 10) || 0;
const DRY_RUN = process.env.DRY_RUN === "1";
const UPLOAD_RETRIES = 3;
const QPR_HEADER = "# QPR-LFS-R2 v1";

const GITHUB_REPO = "IISERM/question-paper-repo";
const GITHUB_LFS_BATCH = `https://github.com/${GITHUB_REPO}.git/info/lfs/objects/batch`;

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }

const LFS_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "zip",
]);

// ── Step 1: Find standard git-lfs pointers in HEAD ────────────────

function findStdLfsPointers() {
  log("Finding standard git-lfs pointer files in HEAD...");

  let allBlobs;
  try {
    allBlobs = execSync(
      `git ls-tree -r HEAD --name-only`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    ).trim().split("\n").filter(Boolean);
  } catch (e) {
    throw new Error(`git ls-tree failed: ${e.message}`);
  }

  const candidates = allBlobs.filter(f => {
    const ext = path.extname(f).toLowerCase().replace(".", "");
    return LFS_EXTENSIONS.has(ext);
  });
  log(`  ${candidates.length} LFS-tracked files in HEAD.`);
  log(`  Checking for standard git-lfs pointers...`);

  const batchSize = 500;
  const stdLfsFiles = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const input = batch.map(f => `HEAD:${f}`).join("\n") + "\n";
    try {
      const output = execSync(`git cat-file --batch`, {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
      });
      const entries = output.split(/(?=^[0-9a-f]{40} )/m);
      let idx = 0;
      for (const entry of entries) {
        if (!entry.trim() || idx >= batch.length) continue;
        const lines = entry.split("\n");
        if (lines.length >= 2 && lines[1].startsWith("version https://git-lfs.github.com/spec")) {
          stdLfsFiles.push(batch[idx]);
        }
        idx++;
      }
    } catch (e) {
      for (const file of batch) {
        try {
          const content = execSync(
            `git cat-file -p "HEAD:${file}"`,
            { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 }
          );
          if (content.startsWith("version https://git-lfs.github.com/spec")) {
            stdLfsFiles.push(file);
          }
        } catch { /* skip */ }
      }
    }
    log(`  ... ${Math.min(i + batchSize, candidates.length)}/${candidates.length} scanned, ${stdLfsFiles.length} found`);
  }

  log(`  Found ${stdLfsFiles.length} files with standard git-lfs pointers.`);

  if (LIMIT > 0) {
    log(`  Limiting to first ${LIMIT} files.`);
    return stdLfsFiles.slice(0, LIMIT);
  }
  return stdLfsFiles;
}

// ── Helpers ──────────────────────────────────────────────────────

function parseStdLfsOid(content) {
  const oidMatch = content.match(/^oid sha256:([a-f0-9]{64})/m);
  return oidMatch ? `sha256:${oidMatch[1]}` : null;
}

function createQprPointer(oid, size) {
  return `${QPR_HEADER}\noid:${oid}\nsize:${size}\n`;
}

// ── Download from GitHub LFS API ──────────────────────────────────

async function fetchLfsDownloadUrl(oid) {
  const headers = {
    "Accept": "application/vnd.git-lfs+json",
    "Content-Type": "application/vnd.git-lfs+json",
    "User-Agent": "QPR-Migration",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const body = JSON.stringify({
    operation: "download",
    transfers: ["basic"],
    objects: [{ oid, size: 0 }],
  });

  const resp = await fetch(GITHUB_LFS_BATCH, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(`LFS batch request failed: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const obj = data.objects?.[0];
  if (obj?.error) {
    throw new Error(`LFS object error: ${obj.error.code} ${obj.error.message}`);
  }
  if (!obj?.actions?.download?.href) {
    throw new Error(`No download URL in LFS response`);
  }
  return obj.actions.download.href;
}

async function downloadLfsBinary(oid) {
  // Get signed download URL from GitHub LFS API
  const downloadUrl = await fetchLfsDownloadUrl(oid);

  const downloadHeaders = {};
  if (GITHUB_TOKEN) {
    downloadHeaders["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const resp = await fetch(downloadUrl, {
    headers: downloadHeaders,
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    throw new Error(`LFS download failed: HTTP ${resp.status}`);
  }

  return Buffer.from(await resp.arrayBuffer());
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
        const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
        warn(`    Retry ${attempt}/${UPLOAD_RETRIES} in ${delay}ms... (HTTP ${resp.status})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error(`R2 upload HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt < UPLOAD_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
        warn(`    Retry ${attempt}/${UPLOAD_RETRIES} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

// ── Migrate one file ─────────────────────────────────────────────

async function migrateOne(filePath) {
  const relPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;

  try {
    // 1. Get pointer content from HEAD for expected OID
    const pointerContent = execSync(
      `git cat-file -p "HEAD:${relPath}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 }
    );
    const expectedOid = parseStdLfsOid(pointerContent);
    if (!expectedOid) {
      return { status: "ERROR", message: "Could not parse OID from pointer", path: relPath };
    }

    // Already migrated?
    try {
      const wt = fs.readFileSync(relPath, "utf-8");
      if (wt.startsWith(QPR_HEADER)) {
        return { status: "SKIPPED", message: "Already QPR-LFS-R2", path: relPath };
      }
    } catch { /* binary, keep going */ }

    // 2. Download binary from GitHub LFS
    log(`  ${relPath} — downloading from GitHub LFS (${expectedOid})`);
    const binaryContent = await downloadLfsBinary(expectedOid);

    if (binaryContent.length === 0) {
      return { status: "ERROR", message: "Empty download", path: relPath };
    }

    // 3. Verify OID matches
    const hash = crypto.createHash("sha256").update(binaryContent).digest("hex");
    const oid = `sha256:${hash}`;
    if (oid !== expectedOid) {
      return { status: "ERROR", message: `OID mismatch: expected ${expectedOid}, got ${oid}`, path: relPath };
    }
    const size = binaryContent.length;

    log(`    Verified: ${(size / 1024).toFixed(1)} KB`);

    if (DRY_RUN) {
      return { status: "DRY_RUN", oid, size, path: relPath };
    }

    // 4. Upload to R2
    log(`    Uploading to R2...`);
    await uploadToR2(oid, binaryContent);

    // 5. Replace file with QPR pointer
    fs.writeFileSync(relPath, createQprPointer(oid, size), "utf-8");

    log(`    ✅`);
    return { status: "OK", oid, size, path: relPath };
  } catch (error) {
    return { status: "ERROR", message: error.message, path: relPath };
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  log("=== Standard LFS → QPR-LFS-R2 Migration ===\n");
  log(`File server  : ${FILE_SERVER_URL}`);
  log(`GitHub LFS   : ${GITHUB_REPO}`);
  log(`Concurrency  : ${CONCURRENCY}`);
  if (LIMIT > 0) log(`Limit        : ${LIMIT} files`);
  if (DRY_RUN) log("DRY RUN      : No files will be modified\n");

  if (!GITHUB_TOKEN) {
    warn("WARNING: GITHUB_TOKEN not set. LFS downloads may be rate-limited.");
  }

  const files = findStdLfsPointers();
  if (files.length === 0) {
    log("Nothing to migrate.");
    return;
  }

  const startTime = Date.now();
  const results = [];
  let migrated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(f => migrateOne(f)));
    results.push(...batchResults);

    const done = Math.min(i + CONCURRENCY, files.length);
    const ok = batchResults.filter(r => r.status === "OK").length;
    const dry = batchResults.filter(r => r.status === "DRY_RUN").length;
    const skip = batchResults.filter(r => r.status === "SKIPPED").length;
    const err = batchResults.filter(r => r.status === "ERROR").length;

    for (const r of batchResults) {
      if (r.status === "ERROR") warn(`  ❌ ${r.path}: ${r.message}`);
      else if (r.status === "SKIPPED") log(`  ⏭️  ${r.path}: ${r.message}`);
    }

    log(`  [${done}/${files.length}] OK: ${ok}, Dry: ${dry}, Skip: ${skip}, Err: ${err}\n`);

    migrated += ok + dry;
    skipped += skip;
    errors += err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n=== Done in ${elapsed}s ===`);
  log(`Migrated : ${migrated}`);
  log(`Skipped  : ${skipped}`);
  log(`Errors   : ${errors}`);

  const totalSize = results
    .filter(r => r.size)
    .reduce((s, r) => s + r.size, 0);
  log(`Total data uploaded: ${(totalSize / (1024 ** 3)).toFixed(2)} GB`);

  const summary = [
    `# Migration Report`,
    `# Generated: ${new Date().toISOString()}`,
    `# Elapsed: ${elapsed}s`,
    `# Migrated: ${migrated} | Skipped: ${skipped} | Errors: ${errors}`,
    `# Total data: ${(totalSize / (1024 ** 3)).toFixed(2)} GB`,
    `#`,
    ...results.map(r =>
      `${r.status} | ${r.path} | ${r.oid || ""} | ${r.size ? (r.size / 1024).toFixed(1) + " KB" : ""} | ${r.message || ""}`
    ),
  ].join("\n");

  if (!DRY_RUN) {
    fs.writeFileSync("scripts/std-lfs-migration-report.txt", summary, "utf-8");
  }

  if (errors > 0) {
    log(`\n⚠️  ${errors} file(s) had errors. Check the report.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
