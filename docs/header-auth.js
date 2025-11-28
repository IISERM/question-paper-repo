/**
 * Header Auth - Shared authentication for header sign-in button
 * Used on all pages to show sign-in / user info in header
 */

// Initialize header auth when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initHeaderAuth();
});

/**
 * Initialize header authentication UI
 */
function initHeaderAuth() {
  const headerLoginBtn = document.getElementById("header-login-btn");
  const headerUserInfo = document.getElementById("header-user-info");
  const headerUsername = document.getElementById("header-username");
  const headerLogoutBtn = document.getElementById("header-logout-btn");

  // If elements don't exist, this page doesn't have header auth
  if (!headerLoginBtn || !headerUserInfo) return;

  // Check for existing auth
  const authType = localStorage.getItem("auth_type");
  const userEmail = localStorage.getItem("user_email");
  const userName = localStorage.getItem("user_name");

  if (authType === "google" && userEmail) {
    // User is logged in
    headerLoginBtn.style.display = "none";
    headerUserInfo.style.display = "flex";
    headerUsername.textContent = userEmail.split("@")[0];
  } else {
    // User is logged out
    headerLoginBtn.style.display = "flex";
    headerUserInfo.style.display = "none";
  }

  // Set up event listeners
  headerLoginBtn.addEventListener("click", handleHeaderLogin);
  headerLogoutBtn?.addEventListener("click", handleHeaderLogout);
}

/**
 * Handle login from header button
 */
async function handleHeaderLogin() {
  // Check if Firebase is available
  if (typeof firebase === "undefined") {
    // Redirect to submissions page for login
    window.location.href = "submissions.html";
    return;
  }

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({
      hd: "iisermohali.ac.in",
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

    // Update UI
    const headerLoginBtn = document.getElementById("header-login-btn");
    const headerUserInfo = document.getElementById("header-user-info");
    const headerUsername = document.getElementById("header-username");

    headerLoginBtn.style.display = "none";
    headerUserInfo.style.display = "flex";
    headerUsername.textContent = user.email.split("@")[0];

    // Reload page if on submissions to load data
    if (window.location.pathname.includes("submissions.html")) {
      window.location.reload();
    }
  } catch (error) {
    console.error("Header login error:", error);
    if (error.code !== "auth/popup-closed-by-user") {
      alert("Login failed: " + error.message);
    }
  }
}

/**
 * Handle logout from header button
 */
async function handleHeaderLogout() {
  // Sign out from Firebase if available
  if (typeof firebase !== "undefined") {
    try {
      await firebase.auth().signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
  }

  // Clear local storage
  localStorage.removeItem("auth_type");
  localStorage.removeItem("user_email");
  localStorage.removeItem("user_name");

  // Update UI
  const headerLoginBtn = document.getElementById("header-login-btn");
  const headerUserInfo = document.getElementById("header-user-info");

  headerLoginBtn.style.display = "flex";
  headerUserInfo.style.display = "none";

  // Reload page if on submissions
  if (window.location.pathname.includes("submissions.html")) {
    window.location.reload();
  }
}

