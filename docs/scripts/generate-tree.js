#!/usr/bin/env node
// This script generates the folder structure data using GitHub API
// It should be run during the GitHub Actions build process

const fs = require("fs");
const path = require("path");

const IGNORE_DIRS = [".git", "node_modules", "docs", "cloudflare-worker", "scripts"];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "IISERM/question-paper-repo";

const LFS_BINARY_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".zip",
]);

async function fetchGitHubTree() {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/git/trees/main?recursive=1`;
  
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "GitHub-Pages-Generator",
  };
  
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  console.log("Fetching repository tree from GitHub API...");
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (data.truncated) {
    console.warn("Warning: Tree response was truncated. Some files may be missing.");
  }
  
  return data.tree; // Array of {path, type, sha, size, ...}
}

async function isLFSPointer(sha) {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/git/blobs/${sha}`;

  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "GitHub-Pages-Generator",
  };

  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    console.warn(`  Failed to fetch blob ${sha}: ${response.status}`);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    // Response may not be JSON (e.g., rate-limit HTML page)
    return null;
  }
  // GitHub API returns blob content as base64 encoded
  const content = Buffer.from(data.content, data.encoding || "base64").toString("utf-8");

  // Only treat QPR-LFS-R2 pointers as own LFS files (served from R2).
  // Standard git-lfs pointers will fall through to GitHub raw URLs.
  if (content.startsWith("# QPR-LFS-R2") ||
      content.startsWith("version https://qpr-lfs-r2.internal/spec")) {
    const lines = content.split("\n");
    const oidMatch = lines[1] && lines[1].match(/^oid[: ]sha256:([a-f0-9]{64})/);
    if (oidMatch) {
      return `sha256:${oidMatch[1]}`;
    }
  }

  return null;
}

async function buildLfsOidMap(apiTree) {
  const lfsOidMap = new Map();

  const blobItems = apiTree.filter((item) => {
    if (item.type !== "blob") return false;
    const lastDot = item.path.lastIndexOf(".");
    if (lastDot === -1) return false;
    const ext = item.path.slice(lastDot).toLowerCase();
    return LFS_BINARY_EXTENSIONS.has(ext);
  });

  // Load OID cache from previous runs (set via LFS_OID_CACHE_PATH or default)
  const cachePath = process.env.LFS_OID_CACHE_PATH || path.join(__dirname, "..", "lfs-oid-cache.json");
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    // No cache yet — first run
  }

  let cached = 0;
  let fetched = 0;
  let skipped = 0;

  console.log(`Checking ${blobItems.length} binary files for LFS pointers...`);

  for (let i = 0; i < blobItems.length; i++) {
    const item = blobItems[i];
    const cacheKey = `${item.path}@${item.sha}`;

    // Use cached result if SHA matches (file hasn't changed)
    if (cache[cacheKey] !== undefined) {
      if (cache[cacheKey]) {
        lfsOidMap.set(item.path, cache[cacheKey]);
      }
      cached++;
      continue;
    }

    // New or changed file — fetch from API
    fetched++;
    if (fetched > 1) {
      await new Promise((r) => setTimeout(r, 100)); // Rate limiting
    }
    const oid = await isLFSPointer(item.sha);
    cache[cacheKey] = oid || null;
    if (oid) {
      lfsOidMap.set(item.path, oid);
      console.log(`  LFS: ${item.path} -> ${oid}`);
    }
  }

  // Save updated cache
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  console.log(`Found ${lfsOidMap.size} LFS files (${cached} cached, ${fetched} fetched).`);
  return lfsOidMap;
}

function buildTreeStructure(apiTree, lfsOidMap) {
  const root = {};

  // Filter out ignored directories and build tree
  const filteredTree = apiTree.filter((item) => {
    const parts = item.path.split("/");
    return !IGNORE_DIRS.some((ignore) => parts.includes(ignore));
  });

  filteredTree.forEach((item) => {
    const parts = item.path.split("/");
    let current = root;

    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          children: {},
        };
      }

      // If this is the last part and it's a file
      if (index === parts.length - 1 && item.type === "blob") {
        current[part].isFile = true;
        if (lfsOidMap && lfsOidMap.has(item.path)) {
          current[part].lfsOid = lfsOidMap.get(item.path);
        }
        delete current[part].children; // Files don't have children
      } else {
        current = current[part].children;
      }
    });
  });

  return root;
}

function convertToArray(tree) {
  return Object.values(tree).map((item) => {
    const result = {
      name: item.name,
      path: item.path,
    };

    if (item.isFile) {
      result.isFile = true;
    }
    if (item.lfsOid) {
      result.lfsOid = item.lfsOid;
    }
    if (item.children) {
      result.children = convertToArray(item.children);
      // Sort children: directories first, then files, both alphabetically
      result.children.sort((a, b) => {
        if (a.isFile && !b.isFile) return 1;
        if (!a.isFile && b.isFile) return -1;
        return a.name.localeCompare(b.name);
      });
    }

    return result;
  });
}

async function main() {
  try {
    // Fetch tree from GitHub API
    const apiTree = await fetchGitHubTree();
    console.log(`Fetched ${apiTree.length} items from GitHub API`);

    // Extract LFS OIDs for binary files (skipped when SKIP_LFS_OID is set)
    let lfsOidMap = new Map();
    if (process.env.SKIP_LFS_OID === "1") {
      console.log("Skipping LFS OID extraction (SKIP_LFS_OID=1)");
    } else {
      console.log("Extracting LFS OIDs...");
      lfsOidMap = await buildLfsOidMap(apiTree);
    }

    // Build nested structure
    const tree = buildTreeStructure(apiTree, lfsOidMap);

    // Convert to array format and filter to only folders at root level
    const folders = convertToArray(tree).filter((item) => !item.isFile);

    const data = {
      generated: new Date().toISOString(),
      folders: folders,
    };

    // Write to data.json
    const outputPath = path.join(__dirname, "..", "data.json");
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

    console.log("Tree structure generated successfully!");
    console.log(`Output: ${outputPath}`);
    console.log(`Total root folders: ${folders.length}`);
  } catch (error) {
    console.error("Error generating tree structure:", error);
    process.exit(1);
  }
}

main();
