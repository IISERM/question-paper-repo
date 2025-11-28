/**
 * QPR Contribution Worker
 * Handles OAuth and GitHub API operations for the contribution system
 */

import { getInstallationToken } from "./github-app.js";

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Will be restricted in handleRequest
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Top-level error:", error);
      console.error("Error stack:", error.stack);
      return new Response(
        JSON.stringify({
          error: error.message,
          stack: error.stack,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  // Set proper CORS origin
  const allowedOrigins = [
    "https://iiserm.github.io",
    "http://localhost:8000", // For local testing
    "http://127.0.0.1:8000", // Alternative localhost
  ];

  const origin = request.headers.get("Origin");
  const responseHeaders = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
  };

  // Handle OPTIONS request
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: responseHeaders });
  }

  try {
    // Route handling
    if (url.pathname === "/auth/callback") {
      return handleAuthCallback(url, env, responseHeaders);
    }

    if (url.pathname === "/api/fork") {
      return handleFork(request, env, responseHeaders);
    }

    if (url.pathname === "/api/create-branch") {
      return handleCreateBranch(request, env, responseHeaders);
    }

    if (url.pathname === "/api/upload-file") {
      return handleUploadFile(request, env, responseHeaders);
    }

    if (url.pathname === "/api/create-pr") {
      return handleCreatePR(request, env, responseHeaders);
    }

    if (url.pathname === "/api/check-fork") {
      return handleCheckFork(request, env, responseHeaders);
    }

    if (url.pathname === "/api/contribute-direct") {
      return handleDirectContribution(request, env, responseHeaders);
    }

    if (url.pathname === "/api/pageview") {
      return handlePageView(request, env, responseHeaders);
    }

    if (url.pathname === "/api/webhook/github") {
      return handleGitHubWebhook(request, env, responseHeaders);
    }

    return new Response("Not Found", { status: 404, headers: responseHeaders });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...responseHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle GitHub OAuth callback
 */
async function handleAuthCallback(url, env, headers) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return new Response("Missing authorization code", { status: 400, headers });
  }

  try {
    console.log("Exchanging code for token...");
    console.log("Client ID:", env.GITHUB_CLIENT_ID);

    // Exchange code for access token
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: code,
        }),
      }
    );

    console.log("Token response status:", tokenResponse.status);
    const responseText = await tokenResponse.text();
    console.log("Token response body:", responseText);

    const tokenData = JSON.parse(responseText);

    if (tokenData.error) {
      console.error(
        "GitHub error:",
        tokenData.error,
        tokenData.error_description
      );
      throw new Error(tokenData.error_description || tokenData.error);
    }

    // Get user info
    console.log("Getting user info...");
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "QPR-Contribution-Portal",
      },
    });

    console.log("User response status:", userResponse.status);
    const userResponseText = await userResponse.text();
    console.log("User response body:", userResponseText);

    const userData = JSON.parse(userResponseText);

    // Redirect back to frontend with token
    console.log("Redirecting to frontend with username:", userData.login);
    const redirectUrl = new URL(`${env.FRONTEND_URL}/docs/contribute.html`);
    redirectUrl.searchParams.set("token", tokenData.access_token);
    redirectUrl.searchParams.set("username", userData.login);
    if (state) redirectUrl.searchParams.set("state", state);

    console.log("Redirect URL:", redirectUrl.toString());
    return Response.redirect(redirectUrl.toString(), 302);
  } catch (error) {
    console.error("Caught error in handleAuthCallback:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    const errorUrl = new URL(`${env.FRONTEND_URL}/docs/contribute.html`);
    errorUrl.searchParams.set("error", error.message);
    console.log("Redirecting to error URL:", errorUrl.toString());
    return Response.redirect(errorUrl.toString(), 302);
  }
}

/**
 * Check if user has already forked the repository
 */
async function handleCheckFork(request, env, headers) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    // Get authenticated user
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "QPR-Contribution-Portal",
      },
    });

    const userData = await userResponse.json();

    // Check if fork exists
    const forkResponse = await fetch(
      `https://api.github.com/repos/${userData.login}/${env.GITHUB_REPO_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Portal",
        },
      }
    );

    if (forkResponse.status === 200) {
      const forkData = await forkResponse.json();
      return new Response(
        JSON.stringify({
          exists: true,
          fork: forkData,
        }),
        {
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ exists: false }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Increment and return anonymous page view counts
 */
async function handlePageView(request, env, headers) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers,
    });
  }

  if (!env.PAGE_VIEW_STORE) {
    return new Response(
      JSON.stringify({
        disabled: true,
        reason: "PAGE_VIEW_STORE binding not configured",
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    console.warn("Failed to parse page view payload:", error);
  }

  const counter = sanitizeCounter(payload?.counter);
  const path = sanitizePath(payload?.path);

  const totalKey = `counter:${counter}:total`;
  const pageKey = `counter:${counter}:path:${path}`;

  const [totalRaw, pageRaw] = await Promise.all([
    env.PAGE_VIEW_STORE.get(totalKey),
    env.PAGE_VIEW_STORE.get(pageKey),
  ]);

  const newTotal = (parseInt(totalRaw, 10) || 0) + 1;
  const newPage = (parseInt(pageRaw, 10) || 0) + 1;

  await Promise.all([
    env.PAGE_VIEW_STORE.put(totalKey, String(newTotal)),
    env.PAGE_VIEW_STORE.put(pageKey, String(newPage)),
  ]);

  return new Response(
    JSON.stringify({
      total: newTotal,
      page: newPage,
      path,
    }),
    {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    }
  );
}

function sanitizeCounter(value) {
  if (typeof value !== "string" || value.trim() === "") return "site:index";
  return value.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 64) || "site:index";
}

function sanitizePath(value) {
  if (typeof value !== "string" || value.trim() === "") return "/";
  try {
    const url = new URL(value, "https://example.org");
    return url.pathname.slice(0, 128) || "/";
  } catch (error) {
    return "/";
  }
}

/**
 * Fork the repository
 */
async function handleFork(request, env, headers) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    // Fork the repository
    const forkResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/forks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Portal",
        },
      }
    );

    const forkData = await forkResponse.json();

    if (forkResponse.status !== 202 && forkResponse.status !== 200) {
      throw new Error(forkData.message || "Failed to fork repository");
    }

    // Wait a bit for fork to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return new Response(JSON.stringify(forkData), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Create a new branch in the forked repository
 */
async function handleCreateBranch(request, env, headers) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { owner, repo, branchName } = await request.json();

  try {
    // Get the default branch reference
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Portal",
        },
      }
    );

    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch;

    // Get the SHA of the default branch
    const refResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Portal",
        },
      }
    );

    const refData = await refResponse.json();
    const sha = refData.object.sha;

    // Create new branch
    const createBranchResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "QPR-Contribution-Portal",
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: sha,
        }),
      }
    );

    const branchData = await createBranchResponse.json();

    if (createBranchResponse.status !== 201) {
      throw new Error(branchData.message || "Failed to create branch");
    }

    return new Response(JSON.stringify(branchData), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Upload a file to the repository
 */
async function handleUploadFile(request, env, headers) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { owner, repo, path, content, message, branch } = await request.json();
  
  // Frontend dropdown ensures correct folder names, path is already standardized

  try {
    // Create or update file
    const uploadResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "QPR-Contribution-Portal",
        },
        body: JSON.stringify({
          message: message,
          content: content, // Base64 encoded
          branch: branch,
        }),
      }
    );

    const uploadData = await uploadResponse.json();

    if (uploadResponse.status !== 201 && uploadResponse.status !== 200) {
      throw new Error(uploadData.message || "Failed to upload file");
    }

    return new Response(JSON.stringify(uploadData), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Create a pull request
 */
async function handleCreatePR(request, env, headers) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { owner, branch, title, body } = await request.json();

  try {
    // Create pull request
    const prResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/pulls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "QPR-Contribution-Portal",
        },
        body: JSON.stringify({
          title: title,
          body: body,
          head: `${owner}:${branch}`,
          base: "main",
        }),
      }
    );

    const prData = await prResponse.json();

    if (prResponse.status !== 201) {
      throw new Error(prData.message || "Failed to create pull request");
    }

    return new Response(JSON.stringify(prData), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

/**
 * Smart folder matching helper for user-contributed files (GitHub OAuth flow)
 * Uses user's token and checks their fork
 */
async function findMatchingFolderPathForUser(token, owner, repo, filePath) {
  if (!filePath) return filePath;
  
  try {
    const parts = filePath.split('/');
    if (parts.length < 4) return filePath; // Need at least Subject/Code/Year/filename
    
    const fileName = parts[parts.length - 1];
    const lastFolder = parts[parts.length - 2];
    const parentPath = parts.slice(0, -2).join('/');
    
    // Check if parent path exists and get its contents
    const contentsResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${parentPath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Portal",
        },
      }
    );
    
    if (!contentsResponse.ok) {
      // Parent path doesn't exist, return original
      return filePath;
    }
    
    const contents = await contentsResponse.json();
    const existingFolders = contents
      .filter(item => item.type === 'dir')
      .map(item => item.name);
    
    if (existingFolders.length === 0) return filePath;
    
    // Normalize input for comparison
    const normalizedInput = lastFolder.toLowerCase().trim();
    
    // Check for exact match first (case-insensitive)
    const exactMatch = existingFolders.find(f => f.toLowerCase() === normalizedInput);
    if (exactMatch) {
      console.log(`📂 Exact folder match found: "${lastFolder}" -> "${exactMatch}"`);
      return `${parentPath}/${exactMatch}/${fileName}`;
    }
    
    // Check for common variations (Midsem, Endsem, Quiz)
    const commonFolderVariations = {
      'midsem': ['midsems', 'mid-sem', 'mid sem', 'midterm', 'midterms', 'mid'],
      'endsem': ['endsems', 'end-sem', 'end sem', 'endterm', 'endterms', 'end', 'final', 'finals'],
      'quiz': ['quizzes', 'quizs', 'test', 'tests']
    };
    
    // Find if the input matches any variations
    for (const [canonical, variations] of Object.entries(commonFolderVariations)) {
      const existingCanonical = existingFolders.find(f => f.toLowerCase() === canonical);
      
      if (existingCanonical) {
        // Check if input matches any variation
        if (variations.some(v => normalizedInput === v || normalizedInput.startsWith(v))) {
          console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingCanonical}"`);
          return `${parentPath}/${existingCanonical}/${fileName}`;
        }
        
        // Also check if canonical matches the input
        if (normalizedInput.includes(canonical)) {
          console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingCanonical}"`);
          return `${parentPath}/${existingCanonical}/${fileName}`;
        }
      }
    }
    
    // Try fuzzy match - find closest matching folder name
    for (const existingFolder of existingFolders) {
      const normalizedExisting = existingFolder.toLowerCase();
      
      // Check if they're very similar (e.g., just case or plural difference)
      if (normalizedExisting === normalizedInput + 's' || 
          normalizedExisting + 's' === normalizedInput ||
          normalizedExisting === normalizedInput.replace(/s$/, '')) {
        console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingFolder}"`);
        return `${parentPath}/${existingFolder}/${fileName}`;
      }
    }
    
  } catch (error) {
    console.error('Error in smart folder matching:', error);
    // On error, return original path
  }
  
  return filePath; // No match found, use original
}

/**
 * Get canonical (standardized) folder name
 * Automatically corrects common variations like "endsems" -> "Endsem"
 */
function getCanonicalFolderName(folderName) {
  if (!folderName) return folderName;
  
  const normalized = folderName.toLowerCase().trim();
  
  // Define canonical folder names and their variations
  const canonicalNames = {
    'Endsem': ['endsem', 'endsems', 'end-sem', 'end sem', 'endterm', 'endterms', 'end', 'final', 'finals', 'final-exam', 'final exam'],
    'Midsem': ['midsem', 'midsems', 'mid-sem', 'mid sem', 'midterm', 'midterms', 'mid', 'mid-exam', 'mid exam'],
    'Quiz': ['quiz', 'quizzes', 'quizs', 'test', 'tests']
  };
  
  // Check if input matches any canonical name or its variations
  for (const [canonical, variations] of Object.entries(canonicalNames)) {
    if (normalized === canonical.toLowerCase()) {
      return canonical; // Already canonical
    }
    
    // Check if it matches any variation
    for (const variation of variations) {
      if (normalized === variation) {
        console.log(`    📁 Standardized: "${folderName}" → "${canonical}"`);
        return canonical;
      }
      
      // Also match if starts with variation (e.g., "Endsem2024" -> "Endsem")
      if (normalized.startsWith(variation + ' ') || normalized.startsWith(variation + '-')) {
        const suffix = folderName.substring(variation.length);
        console.log(`    📁 Standardized: "${folderName}" → "${canonical}${suffix}"`);
        return canonical + suffix;
      }
    }
  }
  
  // No match found, return with proper capitalization
  return folderName.charAt(0).toUpperCase() + folderName.slice(1);
}

/**
 * Apply canonical folder name standardization to a path
 * E.g., "PHY/403/2025/endsems/file.pdf" -> "PHY/403/2025/Endsem/file.pdf"
 * or "PHY/403/2025/endsems" -> "PHY/403/2025/Endsem"
 */
function standardizeFolderPath(folderPath) {
  if (!folderPath) return folderPath;
  
  const parts = folderPath.split('/');
  
  // For file paths: Subject/Code/Year/Folder/file.pdf
  // For folder paths: Subject/Code/Year/Folder
  
  // Find the custom folder (4th element in the path)
  if (parts.length >= 4) {
    const customFolderIndex = 3; // 0=Subject, 1=Code, 2=Year, 3=CustomFolder
    const originalFolder = parts[customFolderIndex];
    const correctedFolder = getCanonicalFolderName(originalFolder);
    
    if (correctedFolder !== originalFolder) {
      parts[customFolderIndex] = correctedFolder;
      return parts.join('/');
    }
  }
  
  return folderPath;
}

/**
 * OLD: Smart folder matching helper - finds existing folder that matches variations
 * This is kept for reference but replaced by simpler standardization above
 */
async function findMatchingFolderPath_OLD(env, folderPath) {
  if (!folderPath) return folderPath;
  
  try {
    const parts = folderPath.split('/');
    if (parts.length < 3) return folderPath; // Need at least Subject/Code/Year
    
    const lastFolder = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');
    
    // Get GitHub App token
    const appToken = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      env.GITHUB_APP_INSTALLATION_ID
    );
    
    // Check if parent path exists and get its contents
    const contentsResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/${parentPath}`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "QPR-Contribution-Bot",
        },
      }
    );
    
    if (!contentsResponse.ok) {
      // Parent path doesn't exist, return original
      console.log(`    ⓘ Parent path "${parentPath}" not found in main repo, using original path`);
      return folderPath;
    }
    
    const contents = await contentsResponse.json();
    const existingFolders = contents
      .filter(item => item.type === 'dir')
      .map(item => item.name);
    
    if (existingFolders.length === 0) {
      console.log(`    ⓘ No existing folders in "${parentPath}", using original path`);
      return folderPath;
    }
    
    console.log(`    ⓘ Found ${existingFolders.length} folder(s) in "${parentPath}": [${existingFolders.join(', ')}]`);
    
    // Normalize input for comparison
    const normalizedInput = lastFolder.toLowerCase().trim();
    
    // Check for exact match first (case-insensitive)
    const exactMatch = existingFolders.find(f => f.toLowerCase() === normalizedInput);
    if (exactMatch) {
      console.log(`📂 Exact folder match found: "${lastFolder}" -> "${exactMatch}"`);
      return `${parentPath}/${exactMatch}`;
    }
    
    // Check for common variations (Midsem, Endsem, Quiz)
    const commonFolderVariations = {
      'midsem': ['midsems', 'mid-sem', 'mid sem', 'midterm', 'midterms', 'mid'],
      'endsem': ['endsems', 'end-sem', 'end sem', 'endterm', 'endterms', 'end', 'final', 'finals'],
      'quiz': ['quizzes', 'quizs', 'test', 'tests']
    };
    
    // Find if the input matches any variations
    for (const [canonical, variations] of Object.entries(commonFolderVariations)) {
      const existingCanonical = existingFolders.find(f => f.toLowerCase() === canonical);
      
      if (existingCanonical) {
        // Check if input matches any variation
        if (variations.some(v => normalizedInput === v || normalizedInput.startsWith(v))) {
          console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingCanonical}"`);
          return `${parentPath}/${existingCanonical}`;
        }
        
        // Also check if canonical matches the input
        if (normalizedInput.includes(canonical)) {
          console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingCanonical}"`);
          return `${parentPath}/${existingCanonical}`;
        }
      }
    }
    
    // Try fuzzy match - find closest matching folder name
    for (const existingFolder of existingFolders) {
      const normalizedExisting = existingFolder.toLowerCase();
      
      // Check if they're very similar (e.g., just case or plural difference)
      if (normalizedExisting === normalizedInput + 's' || 
          normalizedExisting + 's' === normalizedInput ||
          normalizedExisting === normalizedInput.replace(/s$/, '')) {
        console.log(`🔄 Smart folder match: "${lastFolder}" -> "${existingFolder}"`);
        return `${parentPath}/${existingFolder}`;
      }
    }
    
  } catch (error) {
    console.error('Error in smart folder matching:', error);
    // On error, return original path
  }
  
  return folderPath; // No match found, use original
}

/**
 * Handle direct contribution (Firebase Google Auth flow)
 * Creates PR directly on main repo using GitHub App token
 * Supports batching for large uploads
 */
async function handleDirectContribution(request, env, headers) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const data = await request.json();
    const {
      userEmail,
      userName,
      uploadGroups: originalUploadGroups,
      uploadGroupsForPR, // Complete list of all files for PR description (only on last batch)
      prTitle,
      prDescription,
      branchName: existingBranch, // Optional: if continuing from previous batch
      shouldCreatePR = true, // Whether to create PR at the end
      batchInfo, // Optional: { current: 1, total: 3 }
    } = data;
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📥 Direct contribution request received");
    console.log("  User:", userName, `(${userEmail})`);
    
    // Frontend dropdown ensures correct folder names, just use as-is
    const uploadGroups = originalUploadGroups;
    const correctedUploadGroupsForPR = uploadGroupsForPR;
    
    console.log("\n  Existing branch:", existingBranch || "NONE (will create new)");
    console.log("  Should create PR:", shouldCreatePR);
    console.log("  Upload groups (this batch):", uploadGroups.length);
    console.log(
      "  Files in this batch:",
      uploadGroups.reduce((sum, g) => sum + g.files.length, 0)
    );
    if (correctedUploadGroupsForPR) {
      console.log(
        "  Complete file list for PR:",
        correctedUploadGroupsForPR.reduce((sum, g) => sum + g.files.length, 0),
        "files"
      );
    }
    if (batchInfo) {
      console.log("  Batch info:", `${batchInfo.current}/${batchInfo.total}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Validate required fields
    if (!userEmail || !userName || !uploadGroups) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    // prTitle only required if creating PR
    if (shouldCreatePR && !prTitle) {
      return new Response(
        JSON.stringify({ error: "PR title required when creating PR" }),
        {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    // Validate email domain
    const allowedDomain = env.ALLOWED_EMAIL_DOMAIN || "iisermohali.ac.in";
    if (!userEmail.endsWith(`@${allowedDomain}`)) {
      return new Response(
        JSON.stringify({
          error: `Only ${allowedDomain} email addresses are allowed`,
        }),
        {
          status: 403,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    const batchLog = batchInfo
      ? ` (batch ${batchInfo.current}/${batchInfo.total})`
      : "";
    console.log(
      `📤 Processing contribution from ${userName} (${userEmail})${batchLog}`
    );

    // Get GitHub App installation token
    const appToken = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      env.GITHUB_APP_INSTALLATION_ID
    );

    let branchName = existingBranch;

    // Create branch only if not provided (first batch)
    if (!branchName) {
      const timestamp = Date.now();
      const emailPrefix = userEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "-");
      branchName = `contrib-${emailPrefix}-${timestamp}`;

      // Get the default branch SHA
      const repoResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "QPR-Contribution-Bot",
          },
        }
      );

      if (!repoResponse.ok) {
        throw new Error("Failed to fetch repository information");
      }

      const repoData = await repoResponse.json();
      const defaultBranch = repoData.default_branch;

      // Get the SHA of the default branch
      const refResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/git/ref/heads/${defaultBranch}`,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "QPR-Contribution-Bot",
          },
        }
      );

      if (!refResponse.ok) {
        throw new Error("Failed to fetch default branch reference");
      }

      const refData = await refResponse.json();
      const baseSha = refData.object.sha;

      // Create new branch
      const createBranchResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/git/refs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "QPR-Contribution-Bot",
          },
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
          }),
        }
      );

      if (!createBranchResponse.ok) {
        const errorData = await createBranchResponse.json();
        throw new Error(errorData.message || "Failed to create branch");
      }

      console.log(`Created branch: ${branchName}`);
    }

    // Upload files with custom author
    const uploadedFiles = [];
    console.log("\n📤 Starting file uploads...");
    for (const group of uploadGroups) {
      const { folderPath, files } = group;

      for (const file of files) {
        const { name, content } = file; // content should be base64
        const filePath = `${folderPath}/${name}`;

        console.log(`  Uploading: ${filePath}`);

        const uploadResponse = await fetch(
          `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/${filePath}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${appToken}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
              "User-Agent": "QPR-Contribution-Bot",
            },
            body: JSON.stringify({
              message: `Add ${name}`,
              content: content,
              branch: branchName,
              author: {
                name: userName,
                email: userEmail,
              },
              committer: {
                name: "QPR Bot",
                email: "bot@iiserm.github.io",
              },
            }),
          }
        );

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json();
          console.error(`Failed to upload ${filePath}:`, errorData);
          throw new Error(`Failed to upload ${name}: ${errorData.message}`);
        }

        uploadedFiles.push(filePath);
        console.log(`Uploaded: ${filePath}`);
      }
    }

    // Create pull request if requested
    let prData = null;
    console.log(`\n🔍 PR Creation check: shouldCreatePR = ${shouldCreatePR}`);

    if (shouldCreatePR) {
      console.log("✅ Creating pull request...");

      // Get the default branch for PR
      const repoResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "QPR-Contribution-Bot",
          },
        }
      );
      const repoData = await repoResponse.json();
      const defaultBranch = repoData.default_branch;

      // Build PR body using complete file list if provided, otherwise use current batch
      const groupsForDescription = correctedUploadGroupsForPR || uploadGroups;
      console.log(
        `  Building PR description with ${groupsForDescription.length} group(s)`
      );

      const filesList = groupsForDescription
        .map((group) => {
          const { folderPath, files } = group;
          return `- **${folderPath}/**:\n${files.map((f) => `  - ${f.name}`).join("\n")}`;
        })
        .join("\n\n");

      const prBody = `${prDescription ? prDescription + "\n\n" : ""}**Contributed by:** ${userEmail}
**Google Account:** ${userName}

### Files Added:
${filesList}

---
*This PR was created via the QPR Contribution Portal (Direct submission)*`;

      console.log("  PR body preview:");
      console.log("  " + filesList.split("\n").join("\n  "));

      // Create pull request
      const prResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "QPR-Contribution-Bot",
          },
          body: JSON.stringify({
            title: prTitle,
            body: prBody,
            head: branchName,
            base: defaultBranch,
          }),
        }
      );

      if (!prResponse.ok) {
        const errorData = await prResponse.json();
        throw new Error(errorData.message || "Failed to create pull request");
      }

      prData = await prResponse.json();
      console.log(`✅ PR created successfully!`);
      console.log(`   PR #${prData.number}: ${prData.html_url}`);
      console.log(`   Branch: ${branchName}`);
    } else {
      console.log(`⏭️  PR creation skipped (shouldCreatePR = false)`);
      console.log(`   Files uploaded to branch: ${branchName}`);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Request completed successfully");
    console.log("   Branch:", branchName);
    console.log("   Files uploaded:", uploadedFiles.length);
    console.log("   PR created:", prData ? "YES" : "NO");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return new Response(
      JSON.stringify({
        success: true,
        pr: prData,
        branch: branchName,
        filesUploaded: uploadedFiles,
      }),
      {
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Direct contribution error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to process direct contribution",
      }),
      {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Verify GitHub webhook signature
 */
async function verifyWebhookSignature(payload, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  // GitHub sends signature as "sha256=<hash>"
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    algorithm,
    false,
    ["sign"]
  );

  const signatureHash = signature.replace("sha256=", "");
  const expectedHash = await crypto.subtle.sign(
    algorithm.name,
    key,
    new TextEncoder().encode(payload)
  );

  // Convert ArrayBuffer to hex string
  const expectedHashHex = Array.from(new Uint8Array(expectedHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Compare case-insensitively (GitHub sends lowercase, but be safe)
  return expectedHashHex.toLowerCase() === signatureHash.toLowerCase();
}

/**
 * Extract contributor email from PR body
 */
function extractEmailFromPRBody(prBody) {
  if (!prBody) return null;

  // Look for "Contributed by:" pattern
  const contributedByMatch = prBody.match(/\*\*Contributed by:\*\*\s*(.+)/i);
  if (contributedByMatch) {
    const email = contributedByMatch[1].trim();
    // Validate it's an email
    if (email.includes("@") && email.includes(".")) {
      return email;
    }
  }

  // Fallback: look for email pattern
  const emailMatch = prBody.match(/([a-zA-Z0-9._%+-]+@iisermohali\.ac\.in)/i);
  if (emailMatch) {
    return emailMatch[1];
  }

  return null;
}

/**
 * Send email notification via Resend
 */
async function sendEmailNotification(env, recipientEmail, prNumber, prTitle, commentAuthor, commentBody, prUrl) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return false;
  }

  try {
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.6; color: #24292f; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0969da; color: white; padding: 20px; border-radius: 6px 6px 0 0; }
    .content { background-color: #ffffff; border: 1px solid #d0d7de; border-top: none; padding: 20px; border-radius: 0 0 6px 6px; }
    .pr-info { background-color: #f6f8fa; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .comment-box { background-color: #f6f8fa; border-left: 3px solid #0969da; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .button { display: inline-block; background-color: #0969da; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #d0d7de; font-size: 12px; color: #656d76; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">New Comment on Your Pull Request</h2>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Your pull request has received a new comment from <strong>${escapeHtml(commentAuthor)}</strong>.</p>
      
      <div class="pr-info">
        <strong>PR #${prNumber}:</strong> ${escapeHtml(prTitle)}
      </div>

      <div class="comment-box">
        <strong>Comment:</strong><br>
        ${formatCommentForEmail(commentBody)}
      </div>

      <a href="${prUrl}" class="button">View Pull Request</a>

      <div class="footer">
        <p>This is an automated notification from the QPR Contribution Portal.</p>
        <p>If you have any questions, please contact the repository maintainers.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `.trim();

    const emailText = `
New Comment on Your Pull Request

Hello,

Your pull request has received a new comment from ${commentAuthor}.

PR #${prNumber}: ${prTitle}

Comment:
${commentBody}

View Pull Request: ${prUrl}

---
This is an automated notification from the QPR Contribution Portal.
    `.trim();

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || "QPR Bot <notifications@iiserm.github.io>",
        to: [recipientEmail],
        subject: `New comment on PR #${prNumber}: ${prTitle}`,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Resend API error:", response.status, errorData);
      return false;
    }

    const result = await response.json();
    console.log("Email sent successfully:", result.id);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}

/**
 * Escape HTML for email
 */
function escapeHtml(text) {
  if (!text) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Format comment body for email (simple markdown to HTML)
 */
function formatCommentForEmail(body) {
  if (!body) return "";
  
  let formatted = escapeHtml(body);
  
  // Convert line breaks
  formatted = formatted.replace(/\n/g, "<br>");
  
  // Bold text **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  
  // Italic text *text*
  formatted = formatted.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  
  // Inline code `code`
  formatted = formatted.replace(/`([^`]+)`/g, "<code style='background-color: #f6f8fa; padding: 2px 4px; border-radius: 3px; font-family: monospace;'>$1</code>");
  
  // Links [text](url)
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #0969da;">$1</a>');
  
  return formatted;
}

/**
 * Handle GitHub webhook events
 */
async function handleGitHubWebhook(request, env, headers) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  }

  try {
    // Get webhook payload
    const payload = await request.text();
    const signature = request.headers.get("X-Hub-Signature-256") || request.headers.get("x-hub-signature-256");

    // Verify webhook signature
    const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret) {
      const isValid = await verifyWebhookSignature(payload, signature, webhookSecret);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response("Invalid signature", {
          status: 401,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }
    } else {
      console.warn("GITHUB_WEBHOOK_SECRET not configured, skipping signature verification");
    }

    // Parse payload
    const event = JSON.parse(payload);
    const eventType = request.headers.get("X-GitHub-Event");

    console.log(`Received GitHub webhook: ${eventType}`);

    // Handle issue_comment event (PR comments are issue comments)
    if (eventType === "issue_comment" && event.action === "created") {
      const comment = event.comment;
      const issue = event.issue;

      // Only process comments on pull requests (not issues)
      if (!issue.pull_request) {
        console.log("Comment is on an issue, not a PR. Skipping.");
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      // Skip bot comments
      if (comment.user.type === "Bot") {
        console.log("Comment is from a bot. Skipping.");
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      // Skip empty comments
      if (!comment.body || !comment.body.trim()) {
        console.log("Comment is empty. Skipping.");
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      // Get PR details to extract email
      const appToken = await getInstallationToken(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        env.GITHUB_APP_INSTALLATION_ID
      );

      const prResponse = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/pulls/${issue.number}`,
        {
          headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "QPR-Contribution-Bot",
          },
        }
      );

      if (!prResponse.ok) {
        console.error(`Failed to fetch PR #${issue.number}:`, prResponse.status);
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      const pr = await prResponse.json();

      // Extract contributor email from PR body
      const contributorEmail = extractEmailFromPRBody(pr.body);

      if (!contributorEmail) {
        console.log(`No contributor email found in PR #${issue.number} body. Skipping.`);
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      // Don't send email if commenter is the PR author
      if (pr.user && pr.user.login === comment.user.login) {
        console.log("Commenter is the PR author. Skipping notification.");
        return new Response("OK", {
          status: 200,
          headers: { ...headers, "Content-Type": "text/plain" },
        });
      }

      // Send email notification
      console.log(`Sending email notification to ${contributorEmail} for PR #${issue.number}`);
      const emailSent = await sendEmailNotification(
        env,
        contributorEmail,
        issue.number,
        issue.title,
        comment.user.login,
        comment.body,
        pr.html_url
      );

      if (emailSent) {
        console.log(`✅ Email notification sent successfully to ${contributorEmail}`);
      } else {
        console.error(`❌ Failed to send email notification to ${contributorEmail}`);
      }

      return new Response("OK", {
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain" },
      });
    }

    // For other event types, just acknowledge
    return new Response("OK", {
      status: 200,
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  }
}
