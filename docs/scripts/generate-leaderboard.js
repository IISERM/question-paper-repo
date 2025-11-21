const fs = require("fs");
const path = require("path");

const EXCLUDED_USERNAMES = new Set([
  "Darsh-A",
  "Darsh Suhas Ambade",
  "PseudoFractal",
  "pseudofractal",
]);

const README_PATH = path.join(process.cwd(), "README.md");
const OUTPUT_JSON_PATH = path.join(process.cwd(), "docs", "leaderboard.json");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // format: owner/repo

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.error(
    "❌ Error: GITHUB_TOKEN and GITHUB_REPOSITORY environment variables are required."
  );
  process.exit(1);
}

const [REPO_OWNER, REPO_NAME] = GITHUB_REPOSITORY.split("/");
const HEADERS = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "Contributor-Leaderboard-Generator",
};

async function fetchAllCommits() {
  console.log("Fetching all commits from repository...");

  const authorCommits = new Map();
  let page = 1;
  const perPage = 100;
  let totalCommits = 0;

  while (true) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${perPage}&page=${page}`;

    try {
      const response = await fetch(url, { headers: HEADERS });

      if (response.status === 409) {
        console.log("Repository is empty.");
        return new Map();
      }

      if (!response.ok) {
        throw new Error(
          `GitHub API Error: ${response.status} ${response.statusText}`
        );
      }

      const commits = await response.json();

      if (commits.length === 0) break;

      for (const item of commits) {
        const commit = item.commit;
        const author = commit.author;

        if (!author) continue;

        const name = author.name || "Unknown";
        const email = author.email || "unknown@example.com";

        // Skip Bots
        const committerEmail = commit.committer ? commit.committer.email : "";
        const isBot =
          name.toLowerCase().includes("[bot]") ||
          email.toLowerCase().includes("bot@") ||
          email.includes("github-actions[bot]") ||
          email.includes("dependabot[bot]") ||
          committerEmail.toLowerCase().includes("bot@") ||
          committerEmail.toLowerCase().includes("[bot]");

        if (isBot) continue;

        const key = `${name}|${email}`;
        authorCommits.set(key, (authorCommits.get(key) || 0) + 1);
        totalCommits++;
      }

      console.log(`  Processed page ${page} (${commits.length} commits)...`);
      if (commits.length < perPage) break;
      page++;

      if (page > 1000) {
        console.warn("  Warning: Reached page limit (1000)");
        break;
      }
    } catch (error) {
      console.error("Failed to fetch commits:", error);
      process.exit(1);
    }
  }

  console.log(`Total commits processed: ${totalCommits}`);
  console.log(`Unique authors found: ${authorCommits.size}`);
  return authorCommits;
}

function processContributors(authorCommits) {
  const contributors = [];

  for (const [key, count] of authorCommits.entries()) {
    const [name, email] = key.split("|");

    let username = null;
    let avatarUrl = null;
    let profileUrl = null;

    if (email.includes("users.noreply.github.com")) {
      const parts = email.split("@")[0];
      username = parts.includes("+") ? parts.split("+")[1] : parts;
    }

    const displayName = username || name;
    if (EXCLUDED_USERNAMES.has(displayName) || EXCLUDED_USERNAMES.has(name)) {
      console.log(`  Excluding: ${displayName} (${name})`);
      continue;
    }

    if (username) {
      avatarUrl = `https://github.com/${username}.png`;
      profileUrl = `https://github.com/${username}`;
    } else {
      username = name;
      avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=200`;
    }

    contributors.push({
      username: username || name,
      name: name,
      email: email,
      avatar_url: avatarUrl,
      profile_url: profileUrl,
      commits: count,
    });
  }

  return contributors.sort((a, b) => b.commits - a.commits);
}

async function updateReadme(contributors) {
  console.log("Updating README.md...");

  if (!fs.existsSync(README_PATH)) {
    console.warn("README.md not found, skipping update.");
    return;
  }

  let content = fs.readFileSync(README_PATH, "utf8");

  let leaderboardMd = "## 🏆 Contributor Leaderboard\n\n";
  leaderboardMd += "Top contributors based on commit count:\n\n";
  leaderboardMd += "| Rank | Contributor | Commits |\n";
  leaderboardMd += "|------|-------------|--------:|\n";

  const top5 = contributors.slice(0, 5);
  top5.forEach((contributor, index) => {
    const rankNum = index + 1;
    let rankIcon = `${rankNum}`;
    if (rankNum === 1) rankIcon = "🥇";
    if (rankNum === 2) rankIcon = "🥈";
    if (rankNum === 3) rankIcon = "🥉";

    const displayName = contributor.name || contributor.username;
    leaderboardMd += `| ${rankIcon} | ${displayName} | ${contributor.commits} |\n`;
  });

  leaderboardMd += `\n*Last updated: ${new Date().toISOString().replace("T", " ").substring(0, 19)} UTC*\n`;

  const startMarker = "## 🏆 Contributor Leaderboard";
  const oldStartMarker = "## Commit leaderboard (metric: files)";

  const replaceSection = (marker) => {
    const startIdx = content.indexOf(marker);
    if (startIdx === -1) return false;

    const nextSectionIdx = content.indexOf("\n## ", startIdx + marker.length);
    if (nextSectionIdx === -1) {
      content = content.substring(0, startIdx) + leaderboardMd + "\n";
    } else {
      content =
        content.substring(0, startIdx) +
        leaderboardMd +
        "\n" +
        content.substring(nextSectionIdx);
    }
    return true;
  };

  if (!replaceSection(startMarker)) {
    if (!replaceSection(oldStartMarker)) {
      content += "\n" + leaderboardMd;
    }
  }

  fs.writeFileSync(README_PATH, content, "utf8");
  console.log("README.md updated successfully");
}

async function generateJson(contributors) {
  console.log("Generating docs/leaderboard.json...");

  const data = {
    last_updated: new Date().toISOString(),
    total_contributors: contributors.length,
    contributors: contributors,
  };

  const docsDir = path.dirname(OUTPUT_JSON_PATH);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log("leaderboard.json generated successfully");
}

async function main() {
  try {
    const authorCommits = await fetchAllCommits();
    const contributors = processContributors(authorCommits);

    await updateReadme(contributors);
    await generateJson(contributors);

    console.log("✅ Leaderboard updated successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
