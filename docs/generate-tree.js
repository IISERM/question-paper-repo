#!/usr/bin/env node
// This script generates the folder structure data using GitHub API
// It should be run during the GitHub Actions build process

const fs = require("fs");
const path = require("path");

const IGNORE_DIRS = [".git", "node_modules", "docs", "cloudflare-worker"];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "IISERM/question-paper-repo";

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

function buildTreeStructure(apiTree) {
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
    } else if (item.children) {
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

    // Build nested structure
    const tree = buildTreeStructure(apiTree);

    // Convert to array format and filter to only folders at root level
    const folders = convertToArray(tree).filter((item) => !item.isFile);

    const data = {
      generated: new Date().toISOString(),
      folders: folders,
    };

    // Write to data.json
    const outputPath = path.join(__dirname, "data.json");
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
