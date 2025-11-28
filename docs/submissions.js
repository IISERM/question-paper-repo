/**
 * Submissions Page - Displays user's own PRs from the repository
 * Requires Google authentication and filters by user email
 */

// GitHub repository details
const REPO_OWNER = "IISERM";
const REPO_NAME = "question-paper-repo";

// Pagination settings
const ITEMS_PER_PAGE = 10;

// State
let currentUser = null;
let allSubmissions = [];
let filteredSubmissions = [];
let currentPage = 1;
let totalPages = 1;

// DOM Elements
let signinPrompt, mainContent;
let loadingEl, errorEl, containerEl, listEl, noResultsEl, paginationEl;
let statusFilter, searchInput, refreshBtn;
let totalPrsEl, openPrsEl, mergedPrsEl, closedPrsEl;
let headerLoginBtn, headerUserInfo, headerUsername, headerLogoutBtn;

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  signinPrompt = document.getElementById("signin-prompt");
  mainContent = document.getElementById("main-content");
  
  loadingEl = document.getElementById("submissions-loading");
  errorEl = document.getElementById("submissions-error");
  containerEl = document.getElementById("submissions-container");
  listEl = document.getElementById("submissions-list");
  noResultsEl = document.getElementById("no-results");
  paginationEl = document.getElementById("pagination");
  
  statusFilter = document.getElementById("status-filter");
  searchInput = document.getElementById("search-files");
  refreshBtn = document.getElementById("refresh-btn");
  
  totalPrsEl = document.getElementById("total-prs");
  openPrsEl = document.getElementById("open-prs");
  mergedPrsEl = document.getElementById("merged-prs");
  closedPrsEl = document.getElementById("closed-prs");
  
  // Header auth elements
  headerLoginBtn = document.getElementById("header-login-btn");
  headerUserInfo = document.getElementById("header-user-info");
  headerUsername = document.getElementById("header-username");
  headerLogoutBtn = document.getElementById("header-logout-btn");

  // Set up event listeners
  headerLoginBtn?.addEventListener("click", handleGoogleLogin);
  headerLogoutBtn?.addEventListener("click", handleLogout);
  
  statusFilter?.addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });
  searchInput?.addEventListener("input", debounce(() => {
    currentPage = 1;
    applyFilters();
  }, 300));
  refreshBtn?.addEventListener("click", loadSubmissions);
  
  document.getElementById("retry-btn")?.addEventListener("click", loadSubmissions);

  // Check for existing auth
  checkExistingAuth();

  // Set up theme toggle
  setupThemeToggle();
});

/**
 * Check for existing authentication
 */
function checkExistingAuth() {
  const authType = localStorage.getItem("auth_type");
  const userEmail = localStorage.getItem("user_email");
  const userName = localStorage.getItem("user_name");

  if (authType === "google" && userEmail) {
    currentUser = { email: userEmail, name: userName };
    showLoggedInState();
    loadSubmissions();
  } else {
    showLoggedOutState();
  }
}

/**
 * Handle Google login
 */
async function handleGoogleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({
      hd: "iisermohali.ac.in", // Restrict to IISER Mohali domain
    });

    const result = await firebase.auth().signInWithPopup(provider);
    const user = result.user;

    // Verify email domain
    if (!user.email.endsWith("@iisermohali.ac.in")) {
      await firebase.auth().signOut();
      alert("Please sign in with your @iisermohali.ac.in email address.");
      return;
    }

    // Store auth info
    localStorage.setItem("auth_type", "google");
    localStorage.setItem("user_email", user.email);
    localStorage.setItem("user_name", user.displayName || user.email.split("@")[0]);

    currentUser = {
      email: user.email,
      name: user.displayName || user.email.split("@")[0],
    };

    showLoggedInState();
    loadSubmissions();
  } catch (error) {
    console.error("Google login error:", error);
    if (error.code !== "auth/popup-closed-by-user") {
      alert("Login failed: " + error.message);
    }
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    await firebase.auth().signOut();
  } catch (error) {
    console.error("Logout error:", error);
  }

  localStorage.removeItem("auth_type");
  localStorage.removeItem("user_email");
  localStorage.removeItem("user_name");

  currentUser = null;
  allSubmissions = [];
  filteredSubmissions = [];
  currentPage = 1;

  showLoggedOutState();
}

/**
 * Show logged out state
 */
function showLoggedOutState() {
  // Header
  headerLoginBtn.style.display = "flex";
  headerUserInfo.style.display = "none";
  
  // Page content
  signinPrompt.style.display = "flex";
  mainContent.style.display = "none";
}

/**
 * Show logged in state
 */
function showLoggedInState() {
  // Header
  headerLoginBtn.style.display = "none";
  headerUserInfo.style.display = "flex";
  headerUsername.textContent = currentUser.email.split("@")[0];
  
  // Page content
  signinPrompt.style.display = "none";
  mainContent.style.display = "block";
}

/**
 * Fetch user's submissions from GitHub API
 */
async function loadSubmissions() {
  if (!currentUser) return;

  showLoading();
  currentPage = 1;
  
  try {
    // Fetch all PRs (we'll filter client-side by user email)
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=all&per_page=100&sort=created&direction=desc`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const prs = await response.json();
    
    // Process and filter PRs for current user
    const allPrs = prs.map(pr => processSubmission(pr));
    
    // Filter to only show user's submissions
    allSubmissions = allPrs.filter(pr => {
      // Match by email in PR body
      if (pr.contributorEmail && currentUser.email) {
        return pr.contributorEmail.toLowerCase() === currentUser.email.toLowerCase();
      }
      return false;
    });
    
    // Update stats
    updateStats();
    
    // Apply filters and render
    applyFilters();
    
    showContainer();
    
    // Fetch comments for all submissions (in background)
    fetchAllComments();
  } catch (error) {
    console.error("Error loading submissions:", error);
    showError(error.message);
  }
}

/**
 * Process a PR to extract submission info
 */
function processSubmission(pr) {
  // Parse contributor info from PR body
  const contributorInfo = parseContributorFromBody(pr.body);
  
  // Determine status
  let status = "open";
  if (pr.merged_at) {
    status = "merged";
  } else if (pr.state === "closed") {
    status = "closed";
  }
  
  // Extract files info from PR body if available
  const filesInfo = parseFilesFromBody(pr.body);
  
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    status: status,
    createdAt: new Date(pr.created_at),
    updatedAt: new Date(pr.updated_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    url: pr.html_url,
    contributor: contributorInfo.name || pr.user.login,
    contributorEmail: contributorInfo.email,
    files: filesInfo,
    body: pr.body,
    comments: [], // Will be populated later
  };
}

/**
 * Fetch comments for a specific PR
 */
async function fetchPRComments(prNumber) {
  try {
    // Fetch issue comments (general PR comments, not code review comments)
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${prNumber}/comments`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    
    if (!response.ok) {
      console.warn(`Failed to fetch comments for PR #${prNumber}`);
      return [];
    }
    
    const comments = await response.json();
    return comments.map(comment => ({
      id: comment.id,
      body: comment.body,
      author: comment.user.login,
      authorAvatar: comment.user.avatar_url,
      createdAt: new Date(comment.created_at),
      isBot: comment.user.type === "Bot",
    }));
  } catch (error) {
    console.error(`Error fetching comments for PR #${prNumber}:`, error);
    return [];
  }
}

/**
 * Fetch comments for all user's submissions
 */
async function fetchAllComments() {
  // Fetch comments for each submission in parallel (with rate limit consideration)
  const batchSize = 5; // Fetch 5 at a time to avoid rate limits
  
  for (let i = 0; i < allSubmissions.length; i += batchSize) {
    const batch = allSubmissions.slice(i, i + batchSize);
    const commentPromises = batch.map(async (submission) => {
      const comments = await fetchPRComments(submission.number);
      submission.comments = comments;
    });
    
    await Promise.all(commentPromises);
  }
  
  // Re-render to show comments
  renderSubmissions();
}

/**
 * Parse contributor name and email from PR body
 */
function parseContributorFromBody(body) {
  if (!body) return { name: null, email: null };
  
  const result = { name: null, email: null };
  
  // Look for "Contributed by:" pattern
  const contributedByMatch = body.match(/\*\*Contributed by:\*\*\s*(.+)/i);
  if (contributedByMatch) {
    result.email = contributedByMatch[1].trim();
  }
  
  // Look for "Google Account:" pattern
  const googleAccountMatch = body.match(/\*\*Google Account:\*\*\s*(.+)/i);
  if (googleAccountMatch) {
    result.name = googleAccountMatch[1].trim();
  }
  
  // Fallback: look for email pattern
  if (!result.email) {
    const emailMatch = body.match(/([a-zA-Z0-9._%+-]+@iisermohali\.ac\.in)/i);
    if (emailMatch) {
      result.email = emailMatch[1];
    }
  }
  
  // If no name found, extract from email
  if (!result.name && result.email) {
    const emailPrefix = result.email.split("@")[0];
    result.name = emailPrefix;
  }
  
  return result;
}

/**
 * Parse files information from PR body
 */
function parseFilesFromBody(body) {
  if (!body) return [];
  
  const files = [];
  
  // Look for "Files Added:" section
  const filesSection = body.match(/### Files Added:([\s\S]*?)(?=---|$)/i);
  if (filesSection) {
    // Extract file paths
    const fileMatches = filesSection[1].matchAll(/- \*\*([^*]+)\*\*\/:|  - ([^\n]+)/g);
    let currentFolder = "";
    
    for (const match of fileMatches) {
      if (match[1]) {
        currentFolder = match[1].trim();
      } else if (match[2]) {
        files.push({
          folder: currentFolder,
          name: match[2].trim(),
          path: currentFolder ? `${currentFolder}/${match[2].trim()}` : match[2].trim(),
        });
      }
    }
  }
  
  return files;
}

/**
 * Update statistics display
 */
function updateStats() {
  const total = allSubmissions.length;
  const open = allSubmissions.filter(c => c.status === "open").length;
  const merged = allSubmissions.filter(c => c.status === "merged").length;
  const closed = allSubmissions.filter(c => c.status === "closed").length;
  
  totalPrsEl.textContent = total;
  openPrsEl.textContent = open;
  mergedPrsEl.textContent = merged;
  closedPrsEl.textContent = closed;
}

/**
 * Apply filters to submissions
 */
function applyFilters() {
  const statusValue = statusFilter?.value || "all";
  const searchValue = searchInput?.value.toLowerCase().trim() || "";
  
  filteredSubmissions = allSubmissions.filter(submission => {
    // Status filter
    if (statusValue !== "all" && submission.status !== statusValue) {
      return false;
    }
    
    // Search filter
    if (searchValue) {
      const searchableText = [
        submission.title,
        ...submission.files.map(f => f.path),
        ...submission.files.map(f => f.name),
      ].filter(Boolean).join(" ").toLowerCase();
      
      if (!searchableText.includes(searchValue)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Calculate total pages
  totalPages = Math.ceil(filteredSubmissions.length / ITEMS_PER_PAGE);
  if (totalPages === 0) totalPages = 1;
  
  // Ensure current page is valid
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  
  renderSubmissions();
}

/**
 * Go to specific page
 */
function goToPage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderSubmissions();
  
  // Scroll to top of list
  listEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Render submissions list with pagination
 */
function renderSubmissions() {
  listEl.innerHTML = "";
  
  if (filteredSubmissions.length === 0) {
    noResultsEl.style.display = "flex";
    if (paginationEl) paginationEl.style.display = "none";
    return;
  }
  
  noResultsEl.style.display = "none";
  
  // Calculate slice for current page
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageSubmissions = filteredSubmissions.slice(startIndex, endIndex);
  
  // Render submissions for current page
  pageSubmissions.forEach(submission => {
    const card = createSubmissionCard(submission);
    listEl.appendChild(card);
  });
  
  // Render pagination
  renderPagination();
}

/**
 * Render pagination controls
 */
function renderPagination() {
  if (!paginationEl) return;
  
  // Hide pagination if only one page
  if (totalPages <= 1) {
    paginationEl.style.display = "none";
    return;
  }
  
  paginationEl.style.display = "flex";
  paginationEl.innerHTML = "";
  
  // Page info
  const pageInfo = document.createElement("span");
  pageInfo.className = "pagination-info";
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  
  // Previous button
  const prevBtn = document.createElement("button");
  prevBtn.className = "pagination-btn";
  prevBtn.disabled = currentPage === 1;
  prevBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
    </svg>
    Prev
  `;
  prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
  
  // Page numbers
  const pageNumbers = document.createElement("div");
  pageNumbers.className = "pagination-numbers";
  
  // Determine which page numbers to show
  const pagesToShow = getPageNumbers(currentPage, totalPages);
  
  pagesToShow.forEach((page, index) => {
    if (page === "...") {
      const ellipsis = document.createElement("span");
      ellipsis.className = "pagination-ellipsis";
      ellipsis.textContent = "...";
      pageNumbers.appendChild(ellipsis);
    } else {
      const pageBtn = document.createElement("button");
      pageBtn.className = `pagination-num ${page === currentPage ? "active" : ""}`;
      pageBtn.textContent = page;
      pageBtn.addEventListener("click", () => goToPage(page));
      pageNumbers.appendChild(pageBtn);
    }
  });
  
  // Next button
  const nextBtn = document.createElement("button");
  nextBtn.className = "pagination-btn";
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.innerHTML = `
    Next
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  `;
  nextBtn.addEventListener("click", () => goToPage(currentPage + 1));
  
  // Assemble pagination
  paginationEl.appendChild(prevBtn);
  paginationEl.appendChild(pageNumbers);
  paginationEl.appendChild(nextBtn);
  paginationEl.appendChild(pageInfo);
}

/**
 * Get page numbers to display with ellipsis
 */
function getPageNumbers(current, total) {
  if (total <= 7) {
    // Show all pages
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  
  const pages = [];
  
  // Always show first page
  pages.push(1);
  
  if (current > 3) {
    pages.push("...");
  }
  
  // Show pages around current
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  
  for (let i = start; i <= end; i++) {
    if (!pages.includes(i)) {
      pages.push(i);
    }
  }
  
  if (current < total - 2) {
    pages.push("...");
  }
  
  // Always show last page
  if (!pages.includes(total)) {
    pages.push(total);
  }
  
  return pages;
}

/**
 * Create a submission card element
 */
function createSubmissionCard(submission) {
  const card = document.createElement("div");
  card.className = `contribution-card status-${submission.status}`;
  
  // Status badge
  const statusBadge = getStatusBadge(submission.status);
  
  // Format dates
  const createdDate = formatDate(submission.createdAt);
  
  // Files preview
  const filesPreview = submission.files.length > 0 
    ? createFilesPreview(submission.files) 
    : "";
  
  // Comments section
  const commentsSection = createCommentsSection(submission.comments);
  
  card.innerHTML = `
    <div class="contribution-header">
      <div class="contribution-meta">
        <div class="contribution-info">
          <span class="contribution-author">${escapeHtml(submission.title)}</span>
          <span class="contribution-email">PR #${submission.number}</span>
        </div>
      </div>
      ${statusBadge}
    </div>
    
    <div class="contribution-body">
      ${filesPreview}
      ${commentsSection}
      
      <div class="contribution-footer">
        <span class="contribution-date">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
          </svg>
          Submitted ${createdDate}
        </span>
        <a href="${submission.url}" target="_blank" rel="noopener" class="contribution-link">
          View on GitHub
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
            <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
          </svg>
        </a>
      </div>
    </div>
  `;
  
  return card;
}

/**
 * Create comments section HTML
 */
function createCommentsSection(comments) {
  // Filter out bot comments and empty comments
  const humanComments = comments.filter(c => !c.isBot && c.body.trim());
  
  if (humanComments.length === 0) {
    return "";
  }
  
  let html = `
    <div class="pr-comments">
      <div class="comments-header">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2.5a2 2 0 0 0-1.6.8L8 14.333 6.1 11.8a2 2 0 0 0-1.6-.8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.9 2.533a1 1 0 0 0 1.6 0l1.9-2.533a1 1 0 0 1 .8-.4H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
        </svg>
        <span>${humanComments.length} comment${humanComments.length !== 1 ? "s" : ""} from maintainers</span>
      </div>
      <div class="comments-list">`;
  
  humanComments.forEach(comment => {
    const commentDate = formatDate(comment.createdAt);
    const formattedBody = formatCommentBody(comment.body);
    
    html += `
      <div class="comment-item">
        <div class="comment-meta">
          <img src="${comment.authorAvatar}" alt="${escapeHtml(comment.author)}" class="comment-avatar" loading="lazy" />
          <span class="comment-author">${escapeHtml(comment.author)}</span>
          <span class="comment-date">${commentDate}</span>
        </div>
        <div class="comment-body">${formattedBody}</div>
      </div>`;
  });
  
  html += `</div></div>`;
  
  return html;
}

/**
 * Format comment body - simple markdown-like formatting
 */
function formatCommentBody(body) {
  if (!body) return "";
  
  let formatted = escapeHtml(body);
  
  // Convert line breaks
  formatted = formatted.replace(/\n/g, "<br>");
  
  // Bold text **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  
  // Italic text *text* or _text_
  formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  formatted = formatted.replace(/_([^_]+)_/g, "<em>$1</em>");
  
  // Inline code `code`
  formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
  
  return formatted;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status) {
  const badges = {
    open: `<span class="status-badge badge-open">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8z"/>
      </svg>
      Pending Review
    </span>`,
    merged: `<span class="status-badge badge-merged">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
      </svg>
      Merged
    </span>`,
    closed: `<span class="status-badge badge-closed">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
      </svg>
      Closed
    </span>`,
  };
  
  return badges[status] || badges.open;
}

/**
 * Create files preview HTML
 */
function createFilesPreview(files) {
  if (files.length === 0) return "";
  
  const maxDisplay = 5;
  const displayFiles = files.slice(0, maxDisplay);
  const remaining = files.length - maxDisplay;
  
  let html = `<div class="contribution-files">
    <div class="files-header">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zM4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1h-7zM4 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1h-4z"/>
      </svg>
      <span>${files.length} file${files.length !== 1 ? "s" : ""} uploaded</span>
    </div>
    <ul class="files-list">`;
  
  displayFiles.forEach(file => {
    html += `<li class="file-entry">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
      </svg>
      <span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
    </li>`;
  });
  
  if (remaining > 0) {
    html += `<li class="file-entry file-more">+${remaining} more file${remaining !== 1 ? "s" : ""}</li>`;
  }
  
  html += `</ul></div>`;
  
  return html;
}

/**
 * Format date for display
 */
function formatDate(date) {
  if (!date) return "";
  
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
    }
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  } else if (days === 1) {
    return "yesterday";
  } else if (days < 7) {
    return `${days} days ago`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  } else {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Debounce function for search input
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * UI State functions
 */
function showLoading() {
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  containerEl.style.display = "none";
}

function showError(message) {
  loadingEl.style.display = "none";
  errorEl.style.display = "flex";
  containerEl.style.display = "none";
  document.getElementById("error-message").textContent = message;
}

function showContainer() {
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  containerEl.style.display = "block";
}

/**
 * Theme toggle functionality
 */
function setupThemeToggle() {
  const themeToggle = document.getElementById("theme-toggle");
  const themeText = document.getElementById("theme-text");
  const sunIcon = document.getElementById("theme-icon-sun");
  const moonIcon = document.getElementById("theme-icon-moon");

  function updateThemeUI(theme) {
    if (theme === "dark") {
      sunIcon.style.display = "none";
      moonIcon.style.display = "block";
      themeText.textContent = "Dark";
    } else {
      sunIcon.style.display = "block";
      moonIcon.style.display = "none";
      themeText.textContent = "Light";
    }
  }

  // Initialize UI based on current theme
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  updateThemeUI(currentTheme);

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const newTheme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateThemeUI(newTheme);
  });
}
