// Maximum number of files allowed in a single "Download Folder" request.
const MAX_FOLDER_DOWNLOAD_FILES = 80;

// THEME MANAGEMENT
function initThemeToggle() {
  const themeToggle = document.getElementById("theme-toggle");
  const themeText = document.getElementById("theme-text");
  const sunIcon = document.getElementById("theme-icon-sun");
  const moonIcon = document.getElementById("theme-icon-moon");

  const savedTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  function updateThemeButton(theme) {
    if (theme === "dark") {
      themeText.textContent = "Light";
      sunIcon.style.display = "block";
      moonIcon.style.display = "none";
    } else {
      themeText.textContent = "Dark";
      sunIcon.style.display = "none";
      moonIcon.style.display = "block";
    }
  }

  updateThemeButton(savedTheme);

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateThemeButton(newTheme);
  });
}

// MAIN APPLICATION LOGIC
document.addEventListener("DOMContentLoaded", async () => {
  initThemeToggle();

  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const treeEl = document.getElementById("folder-tree");
  const lastUpdatedEl = document.getElementById("last-updated");
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search");

  let fullData = null;
  let allItems = []; // Flattened list for search

  // --- AUTH GATE ---
  const authGate = document.getElementById("auth-gate");
  const authContent = document.getElementById("authenticated-content");
  const introSection = document.getElementById("intro-section");
  const authGateLoading = document.getElementById("auth-gate-loading");
  const authGateSigninBtn = document.getElementById("auth-gate-signin-btn");

  // Show loading state while Firebase initializes
  authGate.style.display = "";
  authGateLoading.style.display = "";
  authGateSigninBtn.style.display = "none";
  introSection.style.display = "none";

  // Auth gate sign-in button handler
  authGateSigninBtn.addEventListener("click", async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({
        hd: "iisermohali.ac.in",
      });
      await firebase.auth().signInWithPopup(provider);
      // onAuthStateChanged will pick up the new user
    } catch (error) {
      console.error("Auth gate login error:", error);
      if (error.code !== "auth/popup-closed-by-user") {
        alert("Login failed: " + error.message);
      }
    }
  });

  // Wait for Firebase auth state before showing anything
  firebase.auth().onAuthStateChanged((user) => {
    authGateLoading.style.display = "none";
    authGateSigninBtn.style.display = "";

    if (!user) {
      // No user signed in — show auth gate
      authGate.style.display = "";
      authContent.style.display = "none";
      introSection.style.display = "none";
      loadingEl.style.display = "none";
      return;
    }

    // Check domain restriction
    if (!user.email || !user.email.endsWith("@iisermohali.ac.in")) {
      firebase.auth().signOut().then(() => {
        // Clear auth state from localStorage so header + other pages sync
        localStorage.removeItem("auth_type");
        localStorage.removeItem("user_email");
        localStorage.removeItem("user_name");
        authGate.style.display = "";
        authContent.style.display = "none";
        introSection.style.display = "none";
        loadingEl.style.display = "none";
        // Show subtle error hint
        const existingHint = authGate.querySelector(".auth-error-hint");
        if (existingHint) existingHint.remove();
        const errorHint = document.createElement("p");
        errorHint.className = "auth-error-hint";
        errorHint.textContent = "Please sign in with an @iisermohali.ac.in email address.";
        authGate.appendChild(errorHint);
      });
      return;
    }

    // Valid user — store auth state for other pages (header, contribute, submissions)
    localStorage.setItem("auth_type", "google");
    localStorage.setItem("user_email", user.email);
    localStorage.setItem("user_name", user.displayName || user.email.split("@")[0]);

    // Hide auth gate and load content
    authGate.style.display = "none";
    authContent.style.display = "";
    introSection.style.display = "";

    loadRepositoryData();
  });

  // --- HISTORY HANDLING (Back Button) ---
  window.addEventListener("popstate", (event) => {
    const state = event.state;
    if (state && state.path !== undefined) {
      renderCurrentView(state.path);
    } else {
      // Fallback to URL param
      const params = new URLSearchParams(window.location.search);
      renderCurrentView(params.get("path") || "");
    }
  });

  // --- DATA LOADING (called after auth verification) ---
  async function loadRepositoryData() {
    try {
      // 1. Load Data (Cache -> Network)
      fullData = await getRepositoryData();

      // 2. Flatten data for search index
      if (fullData && fullData.folders) {
        allItems = flattenRepository(fullData.folders);
      }

      loadingEl.style.display = "none";

      if (fullData.generated) {
        const date = new Date(fullData.generated);
        lastUpdatedEl.textContent = date.toLocaleString();
      }

      // 3. Render Initial View based on URL
      const urlParams = new URLSearchParams(window.location.search);
      renderCurrentView(urlParams.get("path") || "");

      // 4. Setup Search Listener
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim();

        if (query.length > 0) {
          // Search Mode
          clearSearchBtn.style.display = "block";
          const results = searchRepository(allItems, query);

          treeEl.innerHTML = "";
          treeEl.classList.add("search-mode");

          if (results.length === 0) {
            treeEl.innerHTML =
              '<p class="empty-message">No matching items found.</p>';
          } else {
            // Render top 100 results for performance
            renderSearchResults(results.slice(0, 100), treeEl);
          }
        } else {
          // Restore Navigation Mode
          clearSearchBtn.style.display = "none";
          treeEl.classList.remove("search-mode");

          // Get current path from URL state, not input
          const currentUrlParams = new URLSearchParams(window.location.search);
          renderCurrentView(currentUrlParams.get("path") || "");
        }
      });

      clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input"));
      });
    } catch (error) {
      console.error("Error:", error);
      loadingEl.style.display = "none";
      errorEl.textContent = "Failed to load repository data. Please refresh.";
      errorEl.style.display = "block";
    }
  }

  // --- NAVIGATION FUNCTION (SPA) ---
  // Attached to window so elements created outside this scope can call it
  window.navigateTo = function (path) {
    // Update URL
    const newUrl = path
      ? `?path=${encodeURIComponent(path)}`
      : window.location.pathname;
    window.history.pushState({ path }, "", newUrl);

    // Clear search if user navigates
    if (searchInput.value) {
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      treeEl.classList.remove("search-mode");
    }

    renderCurrentView(path);
  };

  // --- DATA HELPER ---
  async function getRepositoryData() {
    console.log("[Network] Fetching repository data");
    const response = await fetch("data.json");
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }
    return await response.json();
  }

  // --- VIEW RENDERER ---
  function renderCurrentView(path) {
    treeEl.innerHTML = "";

    // Always clear any previous "Download Folder" button/error so it never
    // persists when navigating to a different folder (idempotent).
    removeFolderDownloadButton();

    let currentFolder = null;
    if (path) {
      currentFolder = findFolderByPath(fullData.folders, path);
    }

    // Update Title & Description
    const intro = document.querySelector(".intro-section");
    if (currentFolder) {
      document.getElementById("page-title").textContent = currentFolder.name;
      document.getElementById("page-description").style.display = "none";
    } else {
      // Root view
      if (path) {
        // Path requested but not found in data
        treeEl.innerHTML = '<p class="empty-message">Folder not found.</p>';
        return;
      }
      document.getElementById("page-title").textContent =
        "Browse the Repository";
      document.getElementById("page-description").style.display = "block";
    }

    // Update Breadcrumbs
    // Remove old breadcrumb if exists
    const oldBreadcrumb = intro.querySelector(".breadcrumb");
    if (oldBreadcrumb) oldBreadcrumb.remove();

    // Add new breadcrumb
    addBreadcrumbs(path);

    // Show the "Download Folder" button only for year folders (exactly 3 path
    // segments, e.g. "EES/202/2024") with a sane file count.
    const pathSegments = path ? path.split("/").filter(Boolean) : [];
    if (currentFolder && pathSegments.length === 3) {
      const { files, count } = collectFolderFiles(currentFolder);
      if (count >= 1 && count <= MAX_FOLDER_DOWNLOAD_FILES) {
        createFolderDownloadButton(currentFolder, files);
      }
    }

    // Determine items to show
    let itemsToRender = currentFolder
      ? currentFolder.children
      : fullData.folders;

    // Filter out hidden folders from root
    if (!currentFolder) {
      itemsToRender = itemsToRender.filter(
        (item) => !item.name.startsWith(".")
      );
    }

    renderTree(itemsToRender, treeEl, path);
  }
});

// SEARCH & UTILITY FUNCTIONS

// Recursively flatten the tree into a list of {name, path, isFile}
function flattenRepository(folders, parentPath = "") {
  let items = [];
  folders.forEach((item) => {
    const fullPath =
      item.path || (parentPath ? `${parentPath}/${item.name}` : item.name);

    // Add the item itself
    items.push({ ...item, path: fullPath });

    // Add children
    if (item.children) {
      items = items.concat(flattenRepository(item.children, fullPath));
    }
  });
  return items;
}

// Fuzzy search with scoring
function searchRepository(items, query) {
  const lowerQuery = query.toLowerCase();
  // Split by space or slash to handle "Math/201" or "Math 201"
  const terms = lowerQuery.split(/[\s/]+/).filter((t) => t.length > 0);

  if (terms.length === 0) return [];

  return items
    .map((item) => {
      const name = item.name.toLowerCase();
      const path = item.path.toLowerCase();
      let score = 0;

      // 1. STRICT FILTER: All terms must appear somewhere in the path
      const allTermsMatch = terms.every((term) => path.includes(term));
      if (!allTermsMatch) return null;

      // 2. SCORING ALGORITHM

      // Exact name match gets huge bonus
      if (name === lowerQuery) score += 100;
      // Name starts with query
      else if (name.startsWith(lowerQuery)) score += 50;

      // Path starts with query (good for "Math/201")
      if (path.startsWith(lowerQuery)) score += 40;

      // Bonus for terms appearing in the filename specifically
      terms.forEach((term) => {
        if (name.includes(term)) score += 10;
        if (name.startsWith(term)) score += 5;
      });

      // Penalize depth (we want top-level matches first)
      // Count slashes: fewer slashes = higher up
      const depth = (path.match(/\//g) || []).length;
      score -= depth * 3;

      // Slight preference for folders if everything else is equal
      if (!item.isFile) score += 2;

      return { item, score };
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.score - a.score) // Sort descending by score
    .map((r) => r.item);
}

function findFolderByPath(folders, path) {
  const parts = path.split("/");
  let current = folders;
  let folder = null;

  for (const part of parts) {
    if (!current) break;
    folder = current.find((item) => item.name === part && !item.isFile);
    if (!folder) return null;
    current = folder.children;
  }
  return folder;
}

/**
 * Recursively walks a folder's `children`, counting file nodes and collecting
 * their metadata. Returns `{ files, count }` where `files` is
 * `[{ path, oid, name }]` for every node with `isFile === true` (oid is the
 * node's `lfsOid`, possibly null if the file has no LFS backing).
 */
function collectFolderFiles(folder) {
  const files = [];

  function walk(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.isFile === true) {
        files.push({
          path: node.path,
          oid: node.lfsOid || null,
          name: node.name,
        });
      } else if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(folder ? folder.children : []);
  return { files, count: files.length };
}

// --- FOLDER DOWNLOAD (client-side ZIP) ---

// Remove the "Download Folder" button + any inline error message. Idempotent:
// safe to call on every render even when no button exists.
function removeFolderDownloadButton() {
  const btn = document.getElementById("download-folder-btn");
  if (btn) btn.remove();
  const err = document.getElementById("download-folder-error");
  if (err) err.remove();
}

// Create the "Download Folder" button and append it to the intro section.
function createFolderDownloadButton(folder, fileList) {
  const intro = document.querySelector(".intro-section");
  if (!intro) return;

  const button = document.createElement("button");
  button.id = "download-folder-btn";
  button.className = "btn-primary download-folder-btn";
  button.type = "button";
  button.setAttribute("aria-label", "Download folder as a ZIP archive");

  // Download icon
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "download-folder-btn-icon");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");
  icon.innerHTML =
    '<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>';

  // Spinner (hidden by default)
  const spinner = document.createElement("span");
  spinner.className = "download-folder-btn-spinner";
  spinner.setAttribute("aria-hidden", "true");

  // Label
  const label = document.createElement("span");
  label.className = "download-folder-btn-label";
  label.textContent = "Download Folder";

  button.appendChild(icon);
  button.appendChild(spinner);
  button.appendChild(label);

  button.addEventListener("click", () =>
    handleFolderDownload(button, folder, fileList)
  );

  intro.appendChild(button);
}

function showFolderDownloadError(message) {
  const intro = document.querySelector(".intro-section");
  if (!intro) return;

  // Replace any existing inline error to avoid stacking
  removeFolderDownloadError();

  const err = document.createElement("p");
  err.id = "download-folder-error";
  err.className = "download-folder-error";
  err.textContent = message;
  intro.appendChild(err);
}

function removeFolderDownloadError() {
  const err = document.getElementById("download-folder-error");
  if (err) err.remove();
}

async function handleFolderDownload(button, folder, fileList) {
  const label = button.querySelector(".download-folder-btn-label");
  const spinner = button.querySelector(".download-folder-btn-spinner");
  const icon = button.querySelector(".download-folder-btn-icon");

  const setLoading = (loading) => {
    button.disabled = loading;
    if (icon) icon.style.display = loading ? "none" : "";
    if (spinner) spinner.style.display = loading ? "inline-block" : "none";
  };

  removeFolderDownloadError();
  setLoading(true);
  label.textContent = "Preparing…";

  try {
    if (typeof JSZip === "undefined") {
      throw new Error(
        "ZIP library failed to load. Please refresh the page and try again."
      );
    }

    const user = firebase.auth().currentUser;
    if (!user) {
      throw new Error("Please sign in to download this folder.");
    }
    const token = await user.getIdToken();

    // Only send files that actually have an LFS OID (defensive: all files are
    // R2-backed now, but never assume).
    const files = fileList.filter((f) => f.oid);
    if (files.length === 0) {
      throw new Error("No downloadable files in this folder.");
    }

    const nameByPath = {};
    for (const f of files) nameByPath[f.path] = f.name;

    const requestFiles = files.map((f) => ({ path: f.path, oid: f.oid }));

    const resp = await fetch(`${QPR_CONFIG.WORKER_URL}/api/sign-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, files: requestFiles }),
    });

    if (!resp.ok) {
      const errorBody = await resp
        .json()
        .catch(() => ({ error: `Server error: ${resp.status}` }));
      throw new Error(
        errorBody.error || `Failed to prepare download (${resp.status}).`
      );
    }

    const { signedUrls } = await resp.json();

    if (!Array.isArray(signedUrls) || signedUrls.length === 0) {
      throw new Error("No signed URLs returned. Please try again.");
    }

    const zip = new JSZip();

    for (const entry of signedUrls) {
      const fileResp = await fetch(entry.signedUrl);
      if (!fileResp.ok) {
        throw new Error(
          `Failed to download "${entry.path}": HTTP ${fileResp.status}.`
        );
      }
      const buf = await fileResp.arrayBuffer();

      // Year-folder files are direct children, so use `file.name` as the zip
      // entry name (e.g. "Quiz 3.pdf"). Fall back to the path leaf if missing.
      const entryName = nameByPath[entry.path] || entry.path.split("/").pop();
      zip.file(entryName, buf);
    }

    label.textContent = "Zipping…";
    const blob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder.name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Folder download failed:", err);
    showFolderDownloadError(
      err && err.message ? err.message : "Download failed. Please try again."
    );
    label.textContent = "Failed";
    setTimeout(() => {
      label.textContent = "Download Folder";
    }, 2500);
  } finally {
    setLoading(false);
  }
}

// DOM ELEMENT CREATION

function addBreadcrumbs(currentPath) {
  const introSection = document.querySelector(".intro-section");
  const breadcrumbDiv = document.createElement("div");
  breadcrumbDiv.className = "breadcrumb";

  // Home link
  const homeLink = document.createElement("a");
  homeLink.href = "#";
  homeLink.textContent = "Home";
  homeLink.onclick = (e) => {
    e.preventDefault();
    window.navigateTo("");
  };
  breadcrumbDiv.appendChild(homeLink);

  if (currentPath) {
    const parts = currentPath.split("/");
    let pathSoFar = "";

    parts.forEach((part, index) => {
      const separator = document.createElement("span");
      separator.textContent = " / ";
      separator.className = "breadcrumb-separator";
      breadcrumbDiv.appendChild(separator);

      pathSoFar += (pathSoFar ? "/" : "") + part;
      const thisPath = pathSoFar; // Capture for closure

      if (index === parts.length - 1) {
        // Current item (text only)
        const current = document.createElement("span");
        current.textContent = part;
        current.className = "breadcrumb-current";
        breadcrumbDiv.appendChild(current);
      } else {
        // Parent item (link)
        const link = document.createElement("a");
        link.href = `?path=${encodeURIComponent(thisPath)}`;
        link.textContent = part;
        link.onclick = (e) => {
          e.preventDefault();
          window.navigateTo(thisPath);
        };
        breadcrumbDiv.appendChild(link);
      }
    });
  }

  introSection.appendChild(breadcrumbDiv);
}

function renderTree(items, parentElement, basePath = "") {
  if (!items || items.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.textContent = "No items found.";
    emptyMsg.className = "empty-message";
    parentElement.appendChild(emptyMsg);
    return;
  }

  // Sort: Folders first, then files with natural/alphanumerical sorting
  items.sort((a, b) => {
    if (a.isFile === b.isFile) return naturalSort(a.name, b.name);
    return a.isFile ? 1 : -1;
  });

  items.forEach((item) => {
    if (item.isFile) {
      parentElement.appendChild(createFileElement(item));
    } else {
      parentElement.appendChild(createFolderElement(item, basePath));
    }
  });
}

// Natural/alphanumerical sort function
function naturalSort(a, b) {
  const ax = [];
  const bx = [];

  a.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    ax.push([num || Infinity, str || ""]);
  });
  b.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    bx.push([num || Infinity, str || ""]);
  });

  while (ax.length && bx.length) {
    const an = ax.shift();
    const bn = bx.shift();
    const nn = an[0] - bn[0] || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }

  return ax.length - bx.length;
}

function renderSearchResults(items, container) {
  items.forEach((item) => {
    if (item.isFile) {
      container.appendChild(createFileSearchElement(item));
    } else {
      container.appendChild(createFolderSearchElement(item));
    }
  });
}

// --- ELEMENT FACTORIES ---

function createFolderElement(folder, basePath) {
  const div = document.createElement("div");
  div.className = "folder-item";

  const link = document.createElement("a");
  link.className = "folder-link";
  const newPath = basePath ? `${basePath}/${folder.name}` : folder.name;

  // SPA Navigation
  link.href = `?path=${encodeURIComponent(newPath)}`;
  link.onclick = (e) => {
    e.preventDefault();
    window.navigateTo(newPath);
  };

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "item-icon folder-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");
  icon.innerHTML =
    '<path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19z"/>';

  const name = document.createElement("span");
  name.className = "folder-name";
  name.appendChild(icon);
  name.appendChild(document.createTextNode(folder.name));

  const count = document.createElement("span");
  count.className = "folder-count";
  const itemCount = folder.children ? folder.children.length : 0;
  count.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""}`;

  link.appendChild(name);
  link.appendChild(count);
  div.appendChild(link);

  return div;
}

function createFolderSearchElement(folder) {
  const div = document.createElement("div");
  div.className = "folder-item";

  const link = document.createElement("a");
  link.className = "folder-link";

  // SPA Navigation
  link.href = `?path=${encodeURIComponent(folder.path)}`;
  link.onclick = (e) => {
    e.preventDefault();
    window.navigateTo(folder.path);
  };

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "item-icon folder-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");
  icon.innerHTML =
    '<path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19z"/>';

  const meta = document.createElement("div");
  meta.className = "search-result-meta";

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folder.name;

  const pathEl = document.createElement("span");
  pathEl.className = "search-result-path";
  pathEl.textContent = folder.path;

  meta.appendChild(name);
  meta.appendChild(pathEl);

  link.appendChild(icon);
  link.appendChild(meta);
  div.appendChild(link);

  return div;
}

/**
 * Sets up a file link to fetch a signed URL on click.
 * Prevents direct access to file server URLs by requiring authentication.
 * @param {HTMLAnchorElement} link - The anchor element to attach click handler to
 * @param {string} filePath - The file path on the server
 * @param {string} oid - The LFS OID for the file
 */
function setupSignedFileLink(link, filePath, oid) {
  link.href = "#";
  link.style.cursor = "pointer";
  link.title = "Click to open (requires sign-in)";

  link.addEventListener("click", async (e) => {
    e.preventDefault();

    // Disable link and show loading state
    const originalText = link.textContent;
    link.style.pointerEvents = "none";
    link.textContent = "⏳ Generating secure link...";

    try {
      // Get current Firebase user token
      const user = firebase.auth().currentUser;
      if (!user) {
        alert("Please sign in to access files.");
        return;
      }

      const token = await user.getIdToken();

      // Request signed URL from worker
      const response = await fetch(`${QPR_CONFIG.WORKER_URL}/api/sign-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, filePath, oid }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(error.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      // Open the signed URL in a new tab
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Failed to generate signed URL:", err);
      alert(`Failed to open file: ${err.message}`);
    } finally {
      // Restore link state
      link.textContent = originalText;
      link.style.pointerEvents = "auto";
    }
  });
}

function createFileElement(file) {
  const div = document.createElement("div");
  div.className = "file-item";

  const link = document.createElement("a");
  const fileName = file.name.toLowerCase();
  const isPdf = fileName.endsWith(".pdf");

  link.className = isPdf ? "file-link" : "file-link file-link-other";
  if (file.lfsOid) {
    setupSignedFileLink(link, file.path, file.lfsOid);
  } else {
    link.href = `https://github.com/IISERM/question-paper-repo/raw/main/${file.path}`;
    link.target = "_blank";
  }
  link.rel = "noopener noreferrer";

  const name = document.createElement("span");
  name.className = "file-name";

  // Icon selection
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute(
    "class",
    isPdf ? "item-icon file-icon" : "item-icon file-icon file-icon-other"
  );
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");

  if (isPdf) {
    icon.innerHTML =
      '<path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/><path d="M4.603 14.087a.81.81 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.198-.307.526-.568.897-.787a7.68 7.68 0 0 1 1.482-.645 19.697 19.697 0 0 0 1.062-2.227 7.269 7.269 0 0 1-.43-1.295c-.086-.4-.119-.796-.046-1.136.075-.354.274-.672.65-.823.192-.077.4-.12.602-.077a.7.7 0 0 1 .477.365c.088.164.12.356.127.538.007.188-.012.396-.047.614-.084.51-.27 1.134-.52 1.794a10.954 10.954 0 0 0 .98 1.686 5.753 5.753 0 0 1 1.334.05c.364.066.734.195.96.465.12.144.193.32.2.518.007.192-.047.382-.138.563a1.04 1.04 0 0 1-.354.416.856.856 0 0 1-.51.138c-.331-.014-.654-.196-.933-.417a5.712 5.712 0 0 1-.911-.95 11.651 11.651 0 0 0-1.997.406 11.307 11.307 0 0 1-1.02 1.51c-.292.35-.609.656-.927.787a.793.793 0 0 1-.58.029zm1.379-1.901c-.166.076-.32.156-.459.238-.328.194-.541.383-.647.547-.094.145-.096.25-.04.361.01.022.02.036.026.044a.266.266 0 0 0 .035-.012c.137-.056.355-.235.635-.572a8.18 8.18 0 0 0 .45-.606zm1.64-1.33a12.71 12.71 0 0 1 1.01-.193 11.744 11.744 0 0 1-.51-.858 20.801 20.801 0 0 1-.5 1.05zm2.446.45c.15.163.296.3.435.41.24.19.407.253.498.256a.107.107 0 0 0 .07-.015.307.307 0 0 0 .094-.125.436.436 0 0 0 .059-.2.095.095 0 0 0-.026-.063c-.052-.062-.2-.152-.518-.209a3.876 3.876 0 0 0-.612-.053zM8.078 7.8a6.7 6.7 0 0 0 .2-.828c.031-.188.043-.343.038-.465a.613.613 0 0 0-.032-.198.517.517 0 0 0-.145.04c-.087.035-.158.106-.196.283-.04.192-.03.469.046.822.024.111.054.227.09.346z"/>';
  } else if (
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".gif") ||
    fileName.endsWith(".webp")
  ) {
    icon.innerHTML =
      '<path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>';
  } else {
    icon.innerHTML =
      '<path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zM4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1h-7zM4 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1h-4z"/>';
  }

  name.appendChild(icon);
  name.appendChild(document.createTextNode(file.name));

  link.appendChild(name);
  div.appendChild(link);

  return div;
}

function createFileSearchElement(file) {
  const div = document.createElement("div");
  div.className = "file-item";

  const link = document.createElement("a");
  const fileName = file.name.toLowerCase();
  const isPdf = fileName.endsWith(".pdf");

  link.className = isPdf ? "file-link" : "file-link file-link-other";
  if (file.lfsOid) {
    setupSignedFileLink(link, file.path, file.lfsOid);
  } else {
    link.href = `https://github.com/IISERM/question-paper-repo/raw/main/${file.path}`;
    link.target = "_blank";
  }
  link.rel = "noopener noreferrer";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute(
    "class",
    isPdf ? "item-icon file-icon" : "item-icon file-icon file-icon-other"
  );
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");

  if (isPdf) {
    icon.innerHTML =
      '<path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/><path d="M4.603 14.087a.81.81 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.198-.307.526-.568.897-.787a7.68 7.68 0 0 1 1.482-.645 19.697 19.697 0 0 0 1.062-2.227 7.269 7.269 0 0 1-.43-1.295c-.086-.4-.119-.796-.046-1.136.075-.354.274-.672.65-.823.192-.077.4-.12.602-.077a.7.7 0 0 1 .477.365c.088.164.12.356.127.538.007.188-.012.396-.047.614-.084.51-.27 1.134-.52 1.794a10.954 10.954 0 0 0 .98 1.686 5.753 5.753 0 0 1 1.334.05c.364.066.734.195.96.465.12.144.193.32.2.518.007.192-.047.382-.138.563a1.04 1.04 0 0 1-.354.416.856.856 0 0 1-.51.138c-.331-.014-.654-.196-.933-.417a5.712 5.712 0 0 1-.911-.95 11.651 11.651 0 0 0-1.997.406 11.307 11.307 0 0 1-1.02 1.51c-.292.35-.609.656-.927.787a.793.793 0 0 1-.58.029zm1.379-1.901c-.166.076-.32.156-.459.238-.328.194-.541.383-.647.547-.094.145-.096.25-.04.361.01.022.02.036.026.044a.266.266 0 0 0 .035-.012c.137-.056.355-.235.635-.572a8.18 8.18 0 0 0 .45-.606zm1.64-1.33a12.71 12.71 0 0 1 1.01-.193 11.744 11.744 0 0 1-.51-.858 20.801 20.801 0 0 1-.5 1.05zm2.446.45c.15.163.296.3.435.41.24.19.407.253.498.256a.107.107 0 0 0 .07-.015.307.307 0 0 0 .094-.125.436.436 0 0 0 .059-.2.095.095 0 0 0-.026-.063c-.052-.062-.2-.152-.518-.209a3.876 3.876 0 0 0-.612-.053zM8.078 7.8a6.7 6.7 0 0 0 .2-.828c.031-.188.043-.343.038-.465a.613.613 0 0 0-.032-.198.517.517 0 0 0-.145.04c-.087.035-.158.106-.196.283-.04.192-.03.469.046.822.024.111.054.227.09.346z"/>';
  } else if (
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".gif") ||
    fileName.endsWith(".webp")
  ) {
    icon.innerHTML =
      '<path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>';
  } else {
    icon.innerHTML =
      '<path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zM4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1h-4z"/>';
  }

  const meta = document.createElement("div");
  meta.className = "search-result-meta";

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = file.name;

  const pathEl = document.createElement("span");
  pathEl.className = "search-result-path";
  pathEl.textContent = file.path;

  meta.appendChild(name);
  meta.appendChild(pathEl);

  link.appendChild(icon);
  link.appendChild(meta);
  div.appendChild(link);

  return div;
}
