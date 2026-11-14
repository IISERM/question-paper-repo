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

  // Handle empty contributors
  if (!contributors || contributors.length === 0) {
    const containerEl = document.getElementById("leaderboard-container");
    containerEl.innerHTML = '<p style="text-align: center; padding: 2rem;">No contributors found yet. Be the first to contribute!</p>';
    containerEl.style.display = "block";
    return;
  }

  // Update last updated time
  const updatedEl = document.getElementById("leaderboard-updated");
  const date = new Date(last_updated);
  updatedEl.textContent = `Last updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

  // Render podium (top 3)
  const top3 = contributors.slice(0, 3);
  renderPodium(top3);

  const DEFAULT_LIST_LIMIT = 7; // Top 3 on podium + 7 in list = Top 10
  let isExpanded = false;

  const containerEl = document.getElementById("leaderboard-container");

  // Remove existing toggle button if re-rendering
  const existingToggle = document.querySelector(".leaderboard-toggle-wrapper");
  if (existingToggle) existingToggle.remove();

  function updateList() {
    const listContributors = isExpanded
      ? contributors.slice(3)
      : contributors.slice(3, 3 + DEFAULT_LIST_LIMIT);
    renderList(listContributors, 4);
  }

  updateList();

  // If there are more than 10 contributors, show toggle button
  if (contributors.length > 3 + DEFAULT_LIST_LIMIT) {
    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "leaderboard-toggle-wrapper";

    const toggleBtn = document.createElement("button");
    toggleBtn.id = "leaderboard-toggle-btn";
    toggleBtn.className = "btn-leaderboard-toggle";
    toggleBtn.type = "button";
    toggleBtn.textContent = `Show All (${contributors.length} contributors)`;

    toggleBtn.addEventListener("click", () => {
      isExpanded = !isExpanded;
      updateList();
      toggleBtn.textContent = isExpanded
        ? "Show Less"
        : `Show All (${contributors.length} contributors)`;
    });

    toggleWrapper.appendChild(toggleBtn);

    const footerEl = document.querySelector(".leaderboard-footer");
    if (footerEl) {
      containerEl.insertBefore(toggleWrapper, footerEl);
    } else {
      containerEl.appendChild(toggleWrapper);
    }
  }
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

  // Use name if available, otherwise username
  const displayName = contributor.name || contributor.username;
  
  card.innerHTML = `
    <div class="podium-rank">${medal}</div>
    <img 
      src="${contributor.avatar_url}" 
      alt="${displayName}" 
      class="podium-avatar"
      onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&size=200'"
    />
    <div class="podium-username">
      ${escapeHtml(displayName)}
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

  // Use name if available, otherwise username
  const displayName = contributor.name || contributor.username;

  item.innerHTML = `
    <div class="leaderboard-rank">#${rank}</div>
    <img 
      src="${contributor.avatar_url}" 
      alt="${displayName}" 
      class="leaderboard-avatar"
      onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&size=200'"
    />
    <div class="leaderboard-info">
      <div class="leaderboard-username">
        ${escapeHtml(displayName)}
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

