#!/usr/bin/env node
/**
 * Fix corrupted QPR-LFS-R2 pointers.
 *
 * The second migration run re-hashed QPR pointer text instead of real
 * binaries and uploaded garbage to R2. The correct binaries from the
 * first migration (commit 1c6e4be^) are still in R2.
 *
 * Strategy: for each file with a QPR pointer in HEAD, check if the
 * pointer is wrong (size < 500 bytes = pointer text). If so, try to
 * recover the correct OID by reconstructing the std-lfs pointer and
 * re-smudging via git lfs.
 */

const fs = require("fs");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const FILE_SERVER_URL =
  process.env.FILE_SERVER_URL || "https://qpr-file-server.turingclub.workers.dev";
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || "5", 10) || 5);
const DRY_RUN = process.env.DRY_RUN === "1";
const UPLOAD_RETRIES = 3;
const QPR_HEADER = "# QPR-LFS-R2 v1";

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }

const EXT_GLOB =
  "'*.pdf' '*.doc' '*.docx' '*.ppt' '*.pptx' " +
  "'*.xls' '*.xlsx' '*.jpg' '*.jpeg' '*.png' " +
  "'*.gif' '*.webp' '*.bmp' '*.svg' '*.zip'";

// ── Find QPR pointers with wrong sizes ───────────────────────────

function findBrokenQprPointers() {
  log("Finding QPR pointer files with bad sizes (< 500 bytes = pointer text)...");
  const all = findQprFiles();
  const broken = [];

  for (const file of all) {
    try {
      const content = execSync(
        `git cat-file -p "HEAD:${file}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 }
      );
      const sizeMatch = content.match(/^size:(\d+)$/m);
      const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
      if (size < 500) {
        broken.push({ path: file, size });
      }
    } catch {
      broken.push({ path: file, size: 0 });
    }
  }

  log(`  Found ${broken.length} broken pointers out of ${all.length} total.`);
  return broken;
}

function findQprFiles() {
  let output;
  try {
    output = execSync(
      `git grep -l '^# QPR-LFS-R2' HEAD -- ${EXT_GLOB}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    ).trim();
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  return output ? output.split("\n").filter(Boolean).map(f => f.startsWith("HEAD:") ? f.slice(5) : f) : [];
}

// ── Try to recover binary from git history ───────────────────────

function makeStdPointer(hexOid) {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${hexOid}\nsize 0\n`;
}

function getHistoricalStdLfsOid(filePath) {
  // Search backwards through commits to find the last std-lfs pointer
  const commits = execSync(
    `git log --oneline -20 -- "${filePath}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim().split("\n").map(l => l.split(" ")[0]);

  for (const commit of commits) {
    try {
      const content = execSync(
        `git cat-file -p "${commit}:${filePath}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 }
      );
      const m = content.match(/^oid sha256:([a-f0-9]{64})$/m);
      if (content.startsWith("version https://git-lfs.github.com/spec") && m) {
        return m[1];
      }
    } catch { continue; }
  }
  return null;
}

function smudgeLfsBinary(hexOid) {
  const pointer = makeStdPointer(hexOid);
  const result = spawnSync("git", ["lfs", "smudge"], {
    input: pointer,
    encoding: "buffer",
    maxBuffer: 200 * 1024 * 1024,
    timeout: 120000,
  });
  if (result.status !== 0) return null;
  if (!result.stdout || result.stdout.length < 500) return null;
  return result.stdout;
}

// ── Upload to R2 ─────────────────────────────────────────────────

async function uploadToR2(oid, binary) {
  const url = `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(oid)}`;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: binary,
        signal: AbortSignal.timeout(120000),
      });
      if (resp.ok) return;
      if (attempt < UPLOAD_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 15000)));
      } else {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt < UPLOAD_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 15000)));
      } else { throw e; }
    }
  }
}

// ── Fix one file ─────────────────────────────────────────────────

async function fixOne(filePath) {
  const relPath = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  try {
    // 1. Check if R2 already has real binary for the current OID
    const currentContent = execSync(
      `git cat-file -p "HEAD:${relPath}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 }
    );
    const oidMatch = currentContent.match(/^oid:sha256:([a-f0-9]{64})$/m);
    if (!oidMatch) return { status: "ERROR", message: "No OID in pointer", path: relPath };
    const currentOid = `sha256:${oidMatch[1]}`;

    // Check R2
    const checkResp = await fetch(
      `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(currentOid)}`,
      { method: "GET", signal: AbortSignal.timeout(30000) }
    );
    if (checkResp.ok) {
      const buf = Buffer.from(await checkResp.arrayBuffer());
      if (buf.length > 500) {
        // R2 has real binary — just fix the size
        log(`  ${relPath}: R2 has ${(buf.length/1024).toFixed(1)} KB, fixing pointer`);
        if (!DRY_RUN) {
          fs.writeFileSync(relPath, `${QPR_HEADER}\noid:${currentOid}\nsize:${buf.length}\n`, "utf-8");
        }
        return { status: "OK", oid: currentOid, size: buf.length, path: relPath };
      }
    }

    // 2. Try to find original std-LFS OID from git history
    log(`  ${relPath}: searching git history for original std-lfs OID...`);
    const hexOid = getHistoricalStdLfsOid(relPath);
    if (!hexOid) {
      return { status: "ERROR", message: "Could not find std-lfs OID in git history", path: relPath };
    }
    const originalOid = `sha256:${hexOid}`;

    // 3. Check if original OID exists in R2
    const origCheck = await fetch(
      `${FILE_SERVER_URL}/lfs/objects/${encodeURIComponent(originalOid)}`,
      { method: "GET", signal: AbortSignal.timeout(30000) }
    );
    if (origCheck.ok) {
      const buf = Buffer.from(await origCheck.arrayBuffer());
      if (buf.length > 500) {
        log(`  ${relPath}: found original binary in R2 (${(buf.length/1024).toFixed(1)} KB)`);
        if (!DRY_RUN) {
          fs.writeFileSync(relPath, `${QPR_HEADER}\noid:${originalOid}\nsize:${buf.length}\n`, "utf-8");
        }
        return { status: "OK", oid: originalOid, size: buf.length, path: relPath };
      }
    }

    // 4. Try to smudge from GitHub LFS
    log(`  ${relPath}: not in R2, trying git lfs smudge from ${hexOid.slice(0,16)}...`);
    const binary = smudgeLfsBinary(hexOid);
    if (!binary || binary.length < 500) {
      return { status: "ERROR", message: "Cannot smudge — binary not available via git lfs", path: relPath };
    }

    log(`  ${relPath}: smudged ${(binary.length/1024).toFixed(1)} KB`);

    if (DRY_RUN) {
      return { status: "DRY_RUN", oid: originalOid, size: binary.length, path: relPath };
    }

    // Upload and write pointer
    await uploadToR2(originalOid, binary);
    fs.writeFileSync(relPath, `${QPR_HEADER}\noid:${originalOid}\nsize:${binary.length}\n`, "utf-8");
    return { status: "OK", oid: originalOid, size: binary.length, path: relPath };
  } catch (error) {
    return { status: "ERROR", message: error.message, path: relPath };
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  log("=== QPR Pointer Fix ===\n");
  log(`File server : ${FILE_SERVER_URL}`);
  if (DRY_RUN) log("DRY RUN     : No files will be modified\n");

  const broken = findBrokenQprPointers();
  if (broken.length === 0) {
    log("No broken pointers found.");
    return;
  }

  const startTime = Date.now();
  const results = [];
  let fixed = 0, errors = 0;

  for (let i = 0; i < broken.length; i += CONCURRENCY) {
    const batch = broken.slice(i, i + CONCURRENCY).map(b => b.path);
    const batchResults = await Promise.all(batch.map(f => fixOne(f)));
    results.push(...batchResults);

    const done = Math.min(i + CONCURRENCY, broken.length);
    const ok = batchResults.filter(r => r.status === "OK").length;
    const dry = batchResults.filter(r => r.status === "DRY_RUN").length;
    const err = batchResults.filter(r => r.status === "ERROR").length;

    for (const r of batchResults) {
      if (r.status === "ERROR") warn(`  ❌ ${r.path}: ${r.message}`);
    }
    log(`  [${done}/${broken.length}] OK: ${ok}, Dry: ${dry}, Err: ${err}\n`);
    fixed += ok + dry;
    errors += err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\n=== Done in ${elapsed}s ===`);
  log(`Fixed  : ${fixed}`);
  log(`Errors : ${errors}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
