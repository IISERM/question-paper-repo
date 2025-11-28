/**
 * QPR Contribution System - Frontend Logic
 */

// Configuration
const CONFIG = {
  WORKER_URL:
    window.QPR_CONFIG?.WORKER_URL ||
    "https://qpr-contribution-worker.turingclub.workers.dev",
  GITHUB_CLIENT_ID: "Ov23linzqUpdM2As790u",
  GITHUB_REPO_OWNER: "IISERM",
  GITHUB_REPO_NAME: "question-paper-repo",
  MAX_FILE_SIZE: 7.5 * 1024 * 1024,
  MAX_BATCH_SIZE: 7.5 * 1024 * 1024,
  ALLOWED_EXTENSIONS: [
    "pdf",
    "jpg",
    "jpeg",
    "png",
    "docx",
    "pptx",
    "xlsx",
    "zip",
    "txt",
    "ipynb",
    "py",
    "csv",
    "tsv",
    "html",
  ],
};

// State management
let state = {
  token: null,
  username: null,
  authType: null,
  userEmail: null,
  userName: null,
  userPhoto: null,
  uploadGroups: [],
  userForkName: null,
};

function injectDynamicStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .native-camera-input { display: none; }
    
    /* Preview Modal Styles */
    .preview-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 9999;
        display: none; align-items: center; justify-content: center;
    }
    .preview-content {
        width: 90%; height: 90%; background: #222;
        border-radius: 8px; overflow: hidden; position: relative;
        display: flex; align-items: center; justify-content: center;
    }
    .btn-close-preview {
        position: absolute; top: 15px; right: 15px;
        background: rgba(0,0,0,0.6); color: white; border: none;
        border-radius: 50%; width: 35px; height: 35px; font-size: 20px;
        cursor: pointer; z-index: 10;
        display: flex; align-items: center; justify-content: center;
    }
    .btn-close-preview:hover { background: rgba(200, 0, 0, 0.8); }
    
    /* Merge Tool Rotation */
    .merge-thumb-wrapper {
        width: 60px; height: 60px; display: flex;
        align-items: center; justify-content: center; overflow: hidden;
        background: #000; border-radius: 4px;
    }
    .merge-thumb { transition: transform 0.3s ease; }
    .merge-controls { display: flex; gap: 4px; }
  `;
  document.head.appendChild(style);
}

// Initialize page
document.addEventListener("DOMContentLoaded", () => {
  injectDynamicStyles();
  initThemeToggle();
  checkAuthStatus();
  setupEventListeners();
  addInitialUploadGroup();
  setupPreviewModal();
});

// Theme Toggle
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

// Auth Status
function checkAuthStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const username = urlParams.get("username");
  const error = urlParams.get("error");

  if (error) {
    showError(`Authentication failed: ${error}`);
    return;
  }

  if (token && username) {
    state.token = token;
    state.username = username;
    state.authType = "github";
    localStorage.setItem("github_token", token);
    localStorage.setItem("github_username", username);
    localStorage.setItem("auth_type", "github");
    window.history.replaceState({}, document.title, window.location.pathname);
    showAuthenticatedUI();
    return;
  }

  const authType = localStorage.getItem("auth_type");
  if (authType === "google") {
    const userEmail = localStorage.getItem("user_email");
    const userName = localStorage.getItem("user_name");
    if (userEmail && userName) {
      state.authType = "google";
      state.userEmail = userEmail;
      state.userName = userName;
      state.userPhoto = localStorage.getItem("user_photo");
      showAuthenticatedUI();
    }
  } else if (authType === "github") {
    const storedToken = localStorage.getItem("github_token");
    const storedUsername = localStorage.getItem("github_username");
    if (storedToken && storedUsername) {
      state.token = storedToken;
      state.username = storedUsername;
      state.authType = "github";
      showAuthenticatedUI();
    }
  }
}

function setupEventListeners() {
  document
    .getElementById("google-login-btn")
    .addEventListener("click", initiateGoogleLogin);
  document
    .getElementById("github-login-btn")
    .addEventListener("click", initiateGitHubLogin);
  document.getElementById("logout-btn").addEventListener("click", logout);
  document
    .getElementById("add-folder-btn")
    .addEventListener("click", addUploadGroup);
  document
    .getElementById("contribution-form")
    .addEventListener("submit", handleSubmit);
  document.getElementById("retry-btn").addEventListener("click", resetForm);
  document
    .getElementById("contribute-more-btn")
    .addEventListener("click", resetForm);
  document.getElementById("copy-pr-link").addEventListener("click", copyPRLink);
}

// Auth Functions
async function initiateGoogleLogin() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    const user = result.user;
    const allowedDomain = "iisermohali.ac.in";
    if (!user.email.endsWith(`@${allowedDomain}`)) {
      await auth.signOut();
      showError(`Access restricted to ${allowedDomain} email addresses only.`);
      return;
    }
    state.authType = "google";
    state.userEmail = user.email;
    state.userName = user.displayName || user.email.split("@")[0];
    state.userPhoto = user.photoURL;
    localStorage.setItem("auth_type", "google");
    localStorage.setItem("user_email", user.email);
    localStorage.setItem("user_name", state.userName);
    localStorage.setItem("user_photo", user.photoURL || "");
    showAuthenticatedUI();
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user")
      showError(`Google sign-in failed: ${error.message}`);
  }
}

function initiateGitHubLogin() {
  const redirectUri = `${CONFIG.WORKER_URL}/auth/callback`;
  const scope = "public_repo";
  const state = Math.random().toString(36).substring(7);
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
}

async function logout() {
  if (state.authType === "google") await auth.signOut().catch(console.error);
  state = {
    token: null,
    username: null,
    authType: null,
    userEmail: null,
    userName: null,
    userPhoto: null,
    uploadGroups: [],
  };
  localStorage.clear();
  document.getElementById("auth-section").style.display = "block";
  document.getElementById("user-section").style.display = "none";
  document.getElementById("upload-section").style.display = "none";
}

function showAuthenticatedUI() {
  const usernameElement = document.getElementById("username");
  if (state.authType === "google") {
    usernameElement.innerHTML = `<strong>${state.userName}</strong> (${state.userEmail})`;
  } else {
    usernameElement.textContent = state.username;
  }
  document.getElementById("auth-section").style.display = "none";
  document.getElementById("user-section").style.display = "block";
  document.getElementById("upload-section").style.display = "block";
}

// ==========================================
// UPLOAD GROUP & FILE HANDLING
// ==========================================

function addInitialUploadGroup() {
  addUploadGroup();
}

function addUploadGroup() {
  const groupId = `group-${Date.now()}`;
  const groupIndex = state.uploadGroups.length;

  const groupHTML = `
        <div class="upload-group" id="${groupId}">
            <div class="upload-group-header">
                <h4>Folder ${groupIndex + 1}</h4>
                ${groupIndex > 0 ? `<button type="button" class="btn-remove" onclick="removeUploadGroup('${groupId}')">Remove</button>` : ""}
            </div>
            <div class="path-builder">
                <div class="form-group">
                    <label for="${groupId}-subject">Subject <span class="required">*</span></label>
                    <select id="${groupId}-subject" class="form-select" required onchange="updatePathPreview('${groupId}')">
                        <option value="">Select Subject</option>
                        <option value="BIO">BIO</option>
                        <option value="CHM">CHM</option>
                        <option value="EES">EES</option>
                        <option value="HSS">HSS</option>
                        <option value="IDC">IDC</option>
                        <option value="MTH">MTH</option>
                        <option value="PHY">PHY</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="${groupId}-coursecode">Course Code <span class="required">*</span></label>
                    <input type="text" id="${groupId}-coursecode" class="form-input" placeholder="e.g., 403" pattern="[0-9]{3}" maxlength="3" required oninput="validateCourseCode('${groupId}')" onchange="updatePathPreview('${groupId}')"/>
                </div>
                <div class="form-group">
                    <label for="${groupId}-year">Year <span class="required">*</span></label>
                    <input type="text" id="${groupId}-year" class="form-input" placeholder="e.g., 2025" pattern="[0-9]{4}" maxlength="4" required oninput="validateYear('${groupId}')" onchange="updatePathPreview('${groupId}')"/>
                </div>
                <div class="form-group">
                    <label for="${groupId}-foldertype">Folder Type (optional)</label>
                    <select id="${groupId}-foldertype" class="form-select" onchange="handleFolderTypeChange('${groupId}')">
                        <option value="">None</option>
                        <option value="Midsem">Midsem</option>
                        <option value="Endsem">Endsem</option>
                        <option value="Quiz">Quiz</option>
                        <option value="Custom">Custom...</option>
                    </select>
                    <small class="form-hint">Choose a standard folder or create a custom one</small>
                </div>
                <div class="form-group" id="${groupId}-custom-folder-group" style="display: none;">
                    <label for="${groupId}-customfolder">Custom Folder Name</label>
                    <input type="text" id="${groupId}-customfolder" class="form-input" placeholder="e.g., Assignments, Notes" oninput="handleCustomFolderInput('${groupId}')" onchange="updatePathPreview('${groupId}')"/>
                    <div id="${groupId}-folder-suggestion" class="folder-suggestion" style="display: none;"></div>
                </div>
                <div class="path-preview">
                    <strong>Path:</strong> <code id="${groupId}-path-display">Select options above</code>
                </div>
            </div>
            <div class="form-group">
                <div class="file-upload-actions">
                    <label for="${groupId}-files" style="margin:0">Files <span class="required">*</span></label>
                    
                    <!-- NATIVE CAMERA INPUT -->
                    <input type="file" id="${groupId}-camera" class="native-camera-input" 
                           accept="image/*" capture="environment" 
                           onchange="handleCameraCapture('${groupId}', this)">
                           
                    <button type="button" class="btn-camera" onclick="document.getElementById('${groupId}-camera').click()">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/>
                        </svg>
                        Take Photo
                    </button>
                </div>
                <div class="file-upload-area" id="${groupId}-drop-zone">
                    <input type="file" id="${groupId}-files" class="file-input" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.pptx,.xlsx,.zip,.txt" onchange="handleFileSelect('${groupId}')"/>
                    <label for="${groupId}-files" class="file-upload-label">
                        <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>
                        <span class="upload-text">Click to upload or drag and drop</span>
                    </label>
                </div>
                <div id="${groupId}-file-list" class="file-list"></div>
                <div class="tools-bar">
                    <button type="button" class="btn-tool btn-tool-pine" onclick="openMergeTool('${groupId}')">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
                        Merge Images to PDF
                    </button>
                </div>
            </div>
        </div>
    `;

  document
    .getElementById("upload-groups")
    .insertAdjacentHTML("beforeend", groupHTML);
  state.uploadGroups.push({ id: groupId, files: [], fileNames: {} });
  setupDragAndDrop(groupId);
}

window.removeUploadGroup = function (groupId) {
  document.getElementById(groupId)?.remove();
  state.uploadGroups = state.uploadGroups.filter((g) => g.id !== groupId);
  document.querySelectorAll(".upload-group").forEach((group, index) => {
    group.querySelector("h4").textContent = `Folder ${index + 1}`;
  });
};

// Handle Native Camera Input
window.handleCameraCapture = function (groupId, inputElement) {
  if (inputElement.files && inputElement.files[0]) {
    const file = inputElement.files[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newFile = new File([file], `photo-${timestamp}.jpg`, {
      type: file.type,
    });

    addFileToGroup(groupId, newFile);
    inputElement.value = ""; // Reset so we can capture again
  }
};

function setupDragAndDrop(groupId) {
  const dropZone = document.getElementById(`${groupId}-drop-zone`);
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(
      eventName,
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      false
    );
  });
  dropZone.addEventListener("dragenter", () =>
    dropZone.classList.add("drag-over")
  );
  dropZone.addEventListener("dragover", () =>
    dropZone.classList.add("drag-over")
  );
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("drag-over")
  );
  dropZone.addEventListener("drop", (e) => {
    dropZone.classList.remove("drag-over");
    document.getElementById(`${groupId}-files`).files = e.dataTransfer.files;
    handleFileSelect(groupId);
  });
}

window.handleFileSelect = function (groupId) {
  const input = document.getElementById(`${groupId}-files`);
  const newFiles = Array.from(input.files);
  const group = state.uploadGroups.find((g) => g.id === groupId);
  const existingFiles = group ? [...group.files] : [];

  const validNewFiles = [];
  const errors = [];
  const oversizedFiles = [];

  newFiles.forEach((file) => {
    if (file.size > CONFIG.MAX_FILE_SIZE) {
      oversizedFiles.push({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2),
      });
      errors.push(file.name);
      return;
    }
    if (
      !CONFIG.ALLOWED_EXTENSIONS.includes(
        file.name.split(".").pop().toLowerCase()
      )
    ) {
      return;
    }
    validNewFiles.push(file);
  });

  const allFiles = [...existingFiles, ...validNewFiles];

  if (oversizedFiles.length > 0) {
    alert(`Skipped ${oversizedFiles.length} files larger than 7.5MB.`);
    showOversizedFileWarning(groupId, oversizedFiles);
  } else {
    removeOversizedFileWarning(groupId);
  }

  if (group) {
    group.files = allFiles;
    allFiles.forEach((file, index) => {
      if (!group.fileNames[index]) group.fileNames[index] = file.name;
    });
  }

  updateFileListUI(groupId, allFiles, group);
};

function updateFileListUI(groupId, files, group) {
  const fileList = document.getElementById(`${groupId}-file-list`);
  fileList.innerHTML = files
    .map((file, index) => {
      const customName = group.fileNames[index] || file.name;
      return `
        <div class="file-item">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
            </svg>
            <input type="text" class="file-name-input" value="${customName}" onchange="updateFileName('${groupId}', ${index}, this.value)"/>
            
            <!-- PREVIEW BUTTON -->
            <button type="button" class="btn-icon-small" onclick="previewFile('${groupId}', ${index})" title="Preview" style="margin-right: 5px; cursor: pointer;">👁️</button>
            
            <span class="file-size">${formatFileSize(file.size)}</span>
            <button type="button" class="btn-remove-file" onclick="removeFile('${groupId}', ${index})">×</button>
        </div>`;
    })
    .join("");
}

// Add a file programmatically (used by camera & merge)
function addFileToGroup(groupId, file) {
  const group = state.uploadGroups.find((g) => g.id === groupId);
  if (!group) return;

  group.files.push(file);
  const index = group.files.length - 1;
  group.fileNames[index] = file.name;
  updateFileListUI(groupId, group.files, group);
}

window.removeFile = function (groupId, index) {
  const group = state.uploadGroups.find((g) => g.id === groupId);
  if (group) {
    group.files.splice(index, 1);
    const newFileNames = {};
    Object.keys(group.fileNames).forEach((key) => {
      const k = parseInt(key);
      if (k < index) newFileNames[k] = group.fileNames[k];
      else if (k > index) newFileNames[k - 1] = group.fileNames[k];
    });
    group.fileNames = newFileNames;
    updateFileListUI(groupId, group.files, group);
  }
};

window.updateFileName = function (groupId, index, newName) {
  const group = state.uploadGroups.find((g) => g.id === groupId);
  if (group && newName.trim()) {
    group.fileNames[index] = newName.trim();
  }
};

// ==========================================
// PREVIEW SYSTEM
// ==========================================

function setupPreviewModal() {
  // Create modal in DOM if not exists
  if (!document.getElementById("preview-modal")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
            <div id="preview-modal" class="preview-overlay">
                <div class="preview-content">
                    <button class="btn-close-preview" onclick="closePreview()">×</button>
                    <div id="preview-container" style="width:100%; height:100%; display:flex; justify-content:center; align-items:center;"></div>
                </div>
            </div>
        `
    );
  }
}

window.previewFile = function (groupId, index) {
  const group = state.uploadGroups.find((g) => g.id === groupId);
  if (!group || !group.files[index]) return;

  const file = group.files[index];
  const fileURL = URL.createObjectURL(file);
  const modal = document.getElementById("preview-modal");
  const container = document.getElementById("preview-container");

  container.innerHTML = "";

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = fileURL;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    container.appendChild(img);
  } else if (file.type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = fileURL;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    container.appendChild(iframe);
  } else {
    container.innerHTML = `<p style="color:#ccc">Preview not available for this file type.</p>`;
  }

  modal.style.display = "flex";
  modal.dataset.currentUrl = fileURL;
};

window.closePreview = function () {
  const modal = document.getElementById("preview-modal");
  modal.style.display = "none";
  if (modal.dataset.currentUrl) {
    URL.revokeObjectURL(modal.dataset.currentUrl);
    modal.dataset.currentUrl = "";
  }
};

// ==========================================
// MERGE TOOL WITH ROTATION
// ==========================================
let activeMergeGroupId = null;
let mergeCandidates = [];

window.openMergeTool = function (groupId) {
  const group = state.uploadGroups.find((g) => g.id === groupId);
  if (!group || group.files.length === 0) {
    alert("No files to merge.");
    return;
  }

  // Filter images and initialize rotation state
  mergeCandidates = [];
  group.files.forEach((file, index) => {
    const name = group.fileNames[index] || file.name;
    if (file.type.startsWith("image/") || name.match(/\.(jpg|jpeg|png)$/i)) {
      mergeCandidates.push({
        file,
        index,
        name,
        selected: true,
        rotation: 0, // Track rotation (0, 90, 180, 270)
      });
    }
  });

  if (mergeCandidates.length < 1) {
    alert("No image files found to merge.");
    return;
  }

  activeMergeGroupId = groupId;
  renderMergeList();

  const timestamp = new Date().toISOString().slice(0, 10);
  document.getElementById("merge-filename").value =
    `Scanned_Doc_${timestamp}.pdf`;
  document.getElementById("merge-modal").style.display = "flex";
};

window.closeMergeTool = function () {
  document.getElementById("merge-modal").style.display = "none";
  activeMergeGroupId = null;
  mergeCandidates = [];
};

function renderMergeList() {
  const container = document.getElementById("merge-list");
  container.innerHTML = mergeCandidates
    .map((item, i) => {
      const url = URL.createObjectURL(item.file);
      return `
        <div class="merge-item ${item.selected ? "" : "disabled"}">
            <input type="checkbox" ${item.selected ? "checked" : ""} onchange="toggleMergeItem(${i})" style="transform:scale(1.2); margin-right:10px;">
            
            <div class="merge-thumb-wrapper">
                <img src="${url}" class="merge-thumb" 
                     style="transform: rotate(${item.rotation}deg); max-width:100%; max-height:100%; object-fit:contain;" 
                     onload="URL.revokeObjectURL(this.src)">
            </div>
            
            <div class="merge-info">
                <span class="merge-name">${item.name}</span>
                <div class="merge-controls">
                    <button type="button" class="btn-icon-small" onclick="rotateMergeItem(${i})" title="Rotate 90°">↻</button>
                    <button type="button" class="btn-icon-small" onclick="moveMergeItem(${i}, -1)" ${i === 0 ? "disabled" : ""}>↑</button>
                    <button type="button" class="btn-icon-small" onclick="moveMergeItem(${i}, 1)" ${i === mergeCandidates.length - 1 ? "disabled" : ""}>↓</button>
                </div>
            </div>
        </div>`;
    })
    .join("");
}

window.toggleMergeItem = function (index) {
  mergeCandidates[index].selected = !mergeCandidates[index].selected;
  renderMergeList();
};

window.rotateMergeItem = function (index) {
  mergeCandidates[index].rotation =
    (mergeCandidates[index].rotation + 90) % 360;
  renderMergeList();
};

window.moveMergeItem = function (index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= mergeCandidates.length) return;
  [mergeCandidates[index], mergeCandidates[newIndex]] = [
    mergeCandidates[newIndex],
    mergeCandidates[index],
  ];
  renderMergeList();
};

window.executeMerge = async function () {
  const selectedItems = mergeCandidates.filter((i) => i.selected);
  if (selectedItems.length === 0) {
    alert("Select at least one image.");
    return;
  }

  const btn = document.querySelector("#merge-modal .btn-primary");
  const originalText = btn.textContent;
  btn.textContent = "Processing...";
  btn.disabled = true;

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.deletePage(1);

    for (const item of selectedItems) {
      // 1. Load image
      const imgObj = await loadImage(item.file);

      // 2. Apply rotation via Canvas if needed
      let finalDataUrl;
      if (item.rotation !== 0) {
        finalDataUrl = rotateImageOnCanvas(imgObj, item.rotation);
      } else {
        finalDataUrl = imgObj.src;
      }

      // 3. Calculate fit to A4 (210x297mm)
      const props = doc.getImageProperties(finalDataUrl);
      const pdfWidth = 210;
      const pdfHeight = 297;
      const imgRatio = props.width / props.height;
      const pageRatio = pdfWidth / pdfHeight;

      let w, h;
      if (imgRatio > pageRatio) {
        w = pdfWidth;
        h = w / imgRatio;
      } else {
        h = pdfHeight;
        w = h * imgRatio;
      }
      const x = (pdfWidth - w) / 2;
      const y = (pdfHeight - h) / 2;

      doc.addPage();
      doc.addImage(finalDataUrl, "JPEG", x, y, w, h);
    }

    const filenameInput = document
      .getElementById("merge-filename")
      .value.trim();
    const filename = filenameInput.endsWith(".pdf")
      ? filenameInput
      : filenameInput + ".pdf";
    const pdfBlob = doc.output("blob");
    const pdfFile = new File([pdfBlob], filename, { type: "application/pdf" });

    addFileToGroup(activeMergeGroupId, pdfFile);

    if (document.getElementById("merge-delete-originals").checked) {
      // Remove from highest index to lowest to avoid shifting issues
      const indicesToRemove = selectedItems
        .map((i) => i.index)
        .sort((a, b) => b - a);
      indicesToRemove.forEach((idx) => removeFile(activeMergeGroupId, idx));
    }

    closeMergeTool();
  } catch (error) {
    console.error("Merge failed:", error);
    alert("Error: " + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
};

// Helper: Load Image
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.onerror = reject;
  });
}

// Helper: Rotate via Canvas
function rotateImageOnCanvas(img, angle) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (angle === 90 || angle === 270) {
    canvas.width = img.height;
    canvas.height = img.width;
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  return canvas.toDataURL("image/jpeg", 0.9);
}

// Note: Folder type selection is now handled via dropdown (Midsem/Endsem/Quiz/Custom)
// No need for complex folder name standardization logic

// ==========================================
// UTILITIES & PATH HELPERS
// ==========================================

// Handle folder type dropdown change
window.handleFolderTypeChange = function (groupId) {
  const folderType = document.getElementById(`${groupId}-foldertype`).value;
  const customFolderGroup = document.getElementById(`${groupId}-custom-folder-group`);
  const customFolderInput = document.getElementById(`${groupId}-customfolder`);
  
  if (folderType === 'Custom') {
    // Show custom input field
    customFolderGroup.style.display = 'block';
    customFolderInput.value = '';
    customFolderInput.focus();
  } else {
    // Hide custom input field
    customFolderGroup.style.display = 'none';
    customFolderInput.value = '';
    // Hide any suggestion
    document.getElementById(`${groupId}-folder-suggestion`).style.display = 'none';
  }
  
  updatePathPreview(groupId);
};

// Detect if user is typing something similar to Midsem/Endsem/Quiz in custom field
window.handleCustomFolderInput = function (groupId) {
  const customFolder = document.getElementById(`${groupId}-customfolder`).value.trim();
  const suggestionDiv = document.getElementById(`${groupId}-folder-suggestion`);
  const folderTypeSelect = document.getElementById(`${groupId}-foldertype`);
  
  if (!customFolder) {
    suggestionDiv.style.display = 'none';
    updatePathPreview(groupId);
    return;
  }
  
  // Check if the input matches any standard folder variations
  const detectedType = detectStandardFolderType(customFolder);
  
  if (detectedType) {
    // Show suggestion to use dropdown instead
    suggestionDiv.innerHTML = `
      <span style="color: var(--warning-color);">⚠️ Did you mean "${detectedType}"?</span>
      <button type="button" class="btn-suggestion" onclick="useSuggestedFolder('${groupId}', '${detectedType}')">
        Use ${detectedType}
      </button>
    `;
    suggestionDiv.style.display = 'block';
  } else {
    suggestionDiv.style.display = 'none';
  }
  
  updatePathPreview(groupId);
};

// Auto-switch to suggested folder type
window.useSuggestedFolder = function (groupId, folderType) {
  const folderTypeSelect = document.getElementById(`${groupId}-foldertype`);
  folderTypeSelect.value = folderType;
  handleFolderTypeChange(groupId);
};

// Detect if custom input matches standard folder types
function detectStandardFolderType(input) {
  const normalized = input.toLowerCase().trim();
  
  const variations = {
    'Endsem': ['endsem', 'endsems', 'end-sem', 'end sem', 'endterm', 'endterms', 'end', 'final', 'finals', 'final-exam', 'final exam'],
    'Midsem': ['midsem', 'midsems', 'mid-sem', 'mid sem', 'midterm', 'midterms', 'mid', 'mid-exam', 'mid exam'],
    'Quiz': ['quiz', 'quizzes', 'quizs', 'test', 'tests']
  };
  
  for (const [canonical, varList] of Object.entries(variations)) {
    if (varList.includes(normalized)) {
      return canonical;
    }
  }
  
  return null;
}

window.updatePathPreview = function (groupId) {
  const subject = document.getElementById(`${groupId}-subject`).value;
  const courseCode = document.getElementById(`${groupId}-coursecode`).value;
  const year = document.getElementById(`${groupId}-year`).value;
  const folderType = document.getElementById(`${groupId}-foldertype`).value;
  const pathDisplay = document.getElementById(`${groupId}-path-display`);

  if (subject && courseCode && year) {
    let path = `${subject}/${courseCode}/${year}`;
    
    // Add folder based on selection
    if (folderType && folderType !== 'Custom') {
      // Standard folder (Midsem/Endsem/Quiz)
      path += `/${folderType}`;
    } else if (folderType === 'Custom') {
      // Custom folder
      const customFolder = document.getElementById(`${groupId}-customfolder`).value.trim();
      if (customFolder) {
        // Capitalize first letter for consistency
        const formattedFolder = customFolder.charAt(0).toUpperCase() + customFolder.slice(1);
        path += `/${formattedFolder}`;
      }
    }
    
    pathDisplay.textContent = path;
    pathDisplay.style.color = "var(--success-color)";
  } else {
    pathDisplay.textContent = "Select options above";
    pathDisplay.style.color = "var(--text-muted)";
  }
};

window.validateCourseCode = function (groupId) {
  const input = document.getElementById(`${groupId}-coursecode`);
  input.value = input.value.replace(/\D/g, "").slice(0, 3);
  updatePathPreview(groupId);
};

window.validateYear = function (groupId) {
  const input = document.getElementById(`${groupId}-year`);
  input.value = input.value.replace(/\D/g, "").slice(0, 4);
  updatePathPreview(groupId);
};

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function showOversizedFileWarning(groupId, oversizedFiles) {
  removeOversizedFileWarning(groupId);
  const group = document.getElementById(groupId);
  if (!group) return;

  const fileNames = oversizedFiles
    .map((f) => `${f.name} (${f.size} MB)`)
    .join(", ");
  const warningHTML = `
        <div class="warning-notice" id="${groupId}-warning">
            <div><p><strong>Skipped Large Files:</strong> ${fileNames}<br>Max size is 7.5MB. Use GitHub PR for larger files.</p></div>
        </div>`;
  document
    .getElementById(`${groupId}-file-list`)
    .insertAdjacentHTML("afterend", warningHTML);
}

function removeOversizedFileWarning(groupId) {
  document.getElementById(`${groupId}-warning`)?.remove();
}

function getFolderPath(groupId) {
  const subject = document.getElementById(`${groupId}-subject`).value;
  const courseCode = document.getElementById(`${groupId}-coursecode`).value;
  const year = document.getElementById(`${groupId}-year`).value;
  const folderType = document.getElementById(`${groupId}-foldertype`).value;

  if (!subject || !courseCode || !year) return null;
  let path = `${subject}/${courseCode}/${year}`;
  
  // Add folder based on selection
  if (folderType && folderType !== 'Custom') {
    // Standard folder (Midsem/Endsem/Quiz)
    path += `/${folderType}`;
    console.log(`📁 Using standard folder: ${folderType}`);
  } else if (folderType === 'Custom') {
    // Custom folder
    const customFolder = document.getElementById(`${groupId}-customfolder`).value.trim();
    if (customFolder) {
      // Capitalize first letter for consistency
      const formattedFolder = customFolder.charAt(0).toUpperCase() + customFolder.slice(1);
      path += `/${formattedFolder}`;
      console.log(`📁 Using custom folder: ${formattedFolder}`);
    }
  }
  
  return path;
}

// ==========================================
// SUBMISSION LOGIC
// ==========================================

async function handleSubmit(e) {
  e.preventDefault();
  const validation = validateForm();
  if (!validation.valid) {
    alert(validation.message);
    return;
  }
  const prTitle = document.getElementById("pr-title").value.trim();
  const prDescription = document.getElementById("pr-description").value.trim();
  if (state.authType === "google") {
    await handleDirectContribution(prTitle, prDescription);
  } else {
    await handleGitHubContribution(prTitle, prDescription);
  }
}

function validateForm() {
  if (!state.authType)
    return { valid: false, message: "Please sign in first." };
  if (state.authType === "google" && !state.userEmail)
    return { valid: false, message: "Auth incomplete." };
  if (state.authType === "github" && !state.token)
    return { valid: false, message: "Auth incomplete." };

  const hasFiles = state.uploadGroups.some((g) => g.files.length > 0);
  if (!hasFiles)
    return { valid: false, message: "Please select at least one file." };

  for (const group of state.uploadGroups) {
    if (group.files.length > 0) {
      if (!document.getElementById(`${group.id}-subject`).value)
        return { valid: false, message: "Missing subject." };
      if (document.getElementById(`${group.id}-coursecode`).value.length !== 3)
        return { valid: false, message: "Invalid course code." };
      if (document.getElementById(`${group.id}-year`).value.length !== 4)
        return { valid: false, message: "Invalid year." };
    }
  }
  if (!document.getElementById("pr-title").value.trim())
    return { valid: false, message: "Missing PR title." };
  if (!document.getElementById("no-duplicates-check").checked)
    return { valid: false, message: "Please verify that no duplicate files exist." };
  return { valid: true };
}

// Direct Contribution (Google Auth)
async function handleDirectContribution(prTitle, prDescription) {
  showProgress("Starting direct contribution...", 0);
  try {
    const uploadGroupsData = state.uploadGroups.map((group) => ({
      folderPath: getFolderPath(group.id),
      files: group.files.map((file, index) => ({
        name: group.fileNames[index] || file.name,
        content: null,
      })),
    }));

    const fileObjects = state.uploadGroups.map((group) => group.files);
    const batches = createBatches(uploadGroupsData, fileObjects);

    let branchName = null;
    let totalFilesProcessed = 0;
    const totalFiles = batches.reduce((sum, batch) => sum + batch.length, 0);
    const allUploadedFiles = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const isLastBatch = batchIdx === batches.length - 1;
      updateProgress(
        `Uploading batch ${batchIdx + 1}/${batches.length}...`,
        10 + Math.floor((batchIdx / batches.length) * 70)
      );

      const batchGroups = {};
      for (const item of batch) {
        const base64Content = await fileToBase64(item.fileObj);
        if (!batchGroups[item.folderPath]) batchGroups[item.folderPath] = [];
        batchGroups[item.folderPath].push({
          name: item.fileData.name,
          content: base64Content,
        });
      }

      const batchUploadGroups = Object.entries(batchGroups).map(
        ([folderPath, files]) => ({ folderPath, files })
      );
      batchUploadGroups.forEach((g) =>
        g.files.forEach((f) =>
          allUploadedFiles.push({ folderPath: g.folderPath, fileName: f.name })
        )
      );

      const response = await fetch(
        `${CONFIG.WORKER_URL}/api/contribute-direct`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail: state.userEmail,
            userName: state.userName,
            uploadGroups: batchUploadGroups,
            uploadGroupsForPR: isLastBatch
              ? buildCompleteUploadGroupsList(allUploadedFiles)
              : undefined,
            prTitle: prTitle,
            prDescription: prDescription,
            branchName: branchName,
            shouldCreatePR: isLastBatch,
            batchInfo: { current: batchIdx + 1, total: batches.length },
          }),
        }
      );

      if (!response.ok)
        throw new Error((await response.json()).error || "Upload failed");
      const result = await response.json();
      if (batchIdx === 0) branchName = result.branch;

      totalFilesProcessed += batch.length;
      if (isLastBatch && result.pr) {
        updateProgress("Complete!", 100);
        setTimeout(() => showSuccess(result.pr.html_url), 500);
      }
    }
  } catch (error) {
    console.error(error);
    showError(error.message || "Error occurred");
  }
}

// GitHub Contribution
async function handleGitHubContribution(prTitle, prDescription) {
  showProgress("Checking for existing fork...", 10);
  try {
    const forkExists = await makeAPICall("/api/check-fork").then(
      (r) => r.exists
    );
    const userForkName = forkExists
      ? state.username
      : (await makeAPICall("/api/fork", { method: "POST" })).owner.login;
    state.userForkName = userForkName;

    updateProgress("Creating branch...", 30);
    const branchName = `contribution-${Date.now()}`;
    await makeAPICall("/api/create-branch", {
      method: "POST",
      body: JSON.stringify({
        owner: userForkName,
        repo: CONFIG.GITHUB_REPO_NAME,
        branchName,
      }),
    });

    const totalFiles = state.uploadGroups.reduce(
      (sum, g) => sum + g.files.length,
      0
    );
    let uploadedCount = 0;

    for (const group of state.uploadGroups) {
      const folderPath = getFolderPath(group.id);
      for (let i = 0; i < group.files.length; i++) {
        const file = group.files[i];
        const fileName = group.fileNames[i] || file.name;
        updateProgress(
          `Uploading ${fileName}...`,
          30 + Math.floor((uploadedCount / totalFiles) * 50)
        );

        const base64Content = await fileToBase64(file);
        await makeAPICall("/api/upload-file", {
          method: "POST",
          body: JSON.stringify({
            owner: userForkName,
            repo: CONFIG.GITHUB_REPO_NAME,
            path: `${folderPath}/${fileName}`,
            content: base64Content,
            message: `Add ${file.name}`,
            branch: branchName,
          }),
        });
        uploadedCount++;
      }
    }

    updateProgress("Creating Pull Request...", 90);
    const filesList = state.uploadGroups
      .map(
        (g) =>
          `- **${getFolderPath(g.id)}/**:\n${g.files.map((f, i) => `  - ${g.fileNames[i] || f.name}`).join("\n")}`
      )
      .join("\n\n");
    const prBody = `${prDescription ? prDescription + "\n\n" : ""}### Files Added:\n${filesList}\n\n---\n*Via QPR Portal*`;

    const pr = await makeAPICall("/api/create-pr", {
      method: "POST",
      body: JSON.stringify({
        owner: userForkName,
        branch: branchName,
        title: prTitle,
        body: prBody,
      }),
    });
    updateProgress("Complete!", 100);
    setTimeout(() => showSuccess(pr.html_url), 500);
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

// API & Helpers
async function makeAPICall(endpoint, options = {}) {
  const response = await fetch(`${CONFIG.WORKER_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...options.headers,
    },
  });
  if (!response.ok)
    throw new Error((await response.json()).error || "API failed");
  return response.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
  });
}

function createBatches(uploadGroupsData, fileObjects) {
  const batches = [];
  let currentBatch = [],
    currentBatchSize = 0;
  const allFiles = [];

  uploadGroupsData.forEach((group, groupIdx) => {
    group.files.forEach((fileData, fileIdx) => {
      allFiles.push({
        groupIdx,
        folderPath: group.folderPath,
        fileData,
        fileObj: fileObjects[groupIdx][fileIdx],
        fileSize: Math.ceil(fileObjects[groupIdx][fileIdx].size * 1.33),
      });
    });
  });

  for (const item of allFiles) {
    if (item.fileSize > CONFIG.MAX_BATCH_SIZE) {
      if (currentBatch.length) batches.push(currentBatch);
      batches.push([item]);
      currentBatch = [];
      currentBatchSize = 0;
      continue;
    }
    if (
      currentBatchSize + item.fileSize > CONFIG.MAX_BATCH_SIZE &&
      currentBatch.length
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchSize = 0;
    }
    currentBatch.push(item);
    currentBatchSize += item.fileSize;
  }
  if (currentBatch.length) batches.push(currentBatch);
  return batches;
}

function buildCompleteUploadGroupsList(allUploadedFiles) {
  const groupedByPath = {};
  allUploadedFiles.forEach(({ folderPath, fileName }) => {
    if (!groupedByPath[folderPath]) groupedByPath[folderPath] = [];
    groupedByPath[folderPath].push({ name: fileName });
  });
  return Object.entries(groupedByPath).map(([folderPath, files]) => ({
    folderPath,
    files,
  }));
}

// ==========================================
// UI STATE MANAGEMENT
// ==========================================

function showProgress(message, percent) {
  document.getElementById("upload-section").style.display = "none";
  document.getElementById("progress-section").style.display = "block";
  updateProgress(message, percent);
}

function updateProgress(message, percent) {
  document.getElementById("progress-message").textContent = message;
  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.getElementById("progress-percent").textContent = `${percent}%`;
}

function showSuccess(prUrl) {
  document.getElementById("progress-section").style.display = "none";
  document.getElementById("success-section").style.display = "block";
  const prLink = document.getElementById("pr-link");
  prLink.href = prUrl;
  prLink.setAttribute("data-url", prUrl);
}

function showError(message) {
  document.getElementById("upload-section").style.display = "none";
  document.getElementById("progress-section").style.display = "none";
  document.getElementById("success-section").style.display = "none";
  document.getElementById("error-section").style.display = "block";
  document.getElementById("error-message").textContent = message;
}

function resetForm() {
  document.getElementById("error-section").style.display = "none";
  document.getElementById("success-section").style.display = "none";
  document.getElementById("progress-section").style.display = "none";
  document.getElementById("upload-section").style.display = "block";
  document.getElementById("contribution-form").reset();
  document.getElementById("upload-groups").innerHTML = "";
  state.uploadGroups = [];
  addInitialUploadGroup();
}

function copyPRLink() {
  const url = document.getElementById("pr-link").getAttribute("data-url");
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById("copy-pr-link");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = orig), 2000);
  });
}
