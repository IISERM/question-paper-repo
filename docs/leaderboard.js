/**
 * Leaderboard functionality for QPR
 * Fetches and displays contributor statistics
 */

// Load leaderboard on page load
document.addEventListener("DOMContentLoaded", () => {
  loadLeaderboard();
});

/**
 * Fetch and display the leaderboard
 */
async function loadLeaderboard() {
  const loadingEl = document.getElementById("leaderboard-loading");
  const errorEl = document.getElementById("leaderboard-error");
  const containerEl = document.getElementById("leaderboard-container");

  try {
    // Fetch leaderboard data
    const response = await fetch("leaderboard.json");

    if (!response.ok) {
      throw new Error("Failed to load leaderboard data");
    }

    const data = await response.json();

    // Hide loading, show container
    loadingEl.style.display = "none";
    containerEl.style.display = "block";

    // Render the leaderboard
    renderLeaderboard(data);
  } catch (error) {
    console.error("Error loading leaderboard:", error);
    loadingEl.style.display = "none";
    errorEl.style.display = "block";
    errorEl.textContent = "Failed to load leaderboard. Please try again later.";
  }
}

/**
 * Render the leaderboard with data
 */
function renderLeaderboard(data) {
  const { contributors, last_updated } = data;

  // Update last updated time
  const updatedEl = document.getElementById("leaderboard-updated");
  const date = new Date(last_updated);
  updatedEl.textContent = `Last updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

  // Get top 3 for podium
  const top3 = contributors.slice(0, 3);
  const remaining = contributors.slice(3, 5); // Show only 5 total (3 + 2)

  // Render podium (top 3)
  renderPodium(top3);

  // Render remaining contributors
  renderList(remaining, 4); // Start rank from 4
}

/**
 * Render the podium for top 3 contributors
 */
function renderPodium(top3) {
  const podiumEl = document.querySelector(".leaderboard-podium");
  podiumEl.innerHTML = "";

  const medals = ["🥇", "🥈", "🥉"];

  top3.forEach((contributor, index) => {
    const rank = index + 1;
    const card = createPodiumCard(contributor, rank, medals[index]);
    podiumEl.appendChild(card);
  });
}

/**
 * Create a podium card for top 3
 */
function createPodiumCard(contributor, rank, medal) {
  const card = document.createElement("div");
  card.className = `podium-card rank-${rank}`;

  card.innerHTML = `
    <div class="podium-rank">${medal}</div>
    <img 
      src="${contributor.avatar_url}" 
      alt="${contributor.username}" 
      class="podium-avatar"
      onerror="this.src='https://github.com/identicons/${contributor.username}.png'"
    />
    <div class="podium-username">
      ${escapeHtml(contributor.username)}
    </div>
    <div class="podium-commits">${contributor.commits.toLocaleString()}</div>
    <div class="podium-commits-label">commits</div>
  `;

  return card;
}

/**
 * Render the list of remaining contributors
 */
function renderList(contributors, startRank) {
  const listEl = document.querySelector(".leaderboard-list");
  listEl.innerHTML = "";

  contributors.forEach((contributor, index) => {
    const rank = startRank + index;
    const item = createListItem(contributor, rank);
    listEl.appendChild(item);
  });
}

/**
 * Create a list item for a contributor
 */
function createListItem(contributor, rank) {
  const item = document.createElement("div");
  item.className = "leaderboard-item";

  item.innerHTML = `
    <div class="leaderboard-rank">#${rank}</div>
    <img 
      src="${contributor.avatar_url}" 
      alt="${contributor.username}" 
      class="leaderboard-avatar"
      onerror="this.src='https://github.com/identicons/${contributor.username}.png'"
    />
    <div class="leaderboard-info">
      <div class="leaderboard-username">
        ${escapeHtml(contributor.username)}
      </div>
      <div class="leaderboard-stats">Contributor</div>
    </div>
    <div class="leaderboard-commits">
      ${contributor.commits.toLocaleString()}
      <span class="leaderboard-commits-suffix">commits</span>
    </div>
  `;

  return item;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

