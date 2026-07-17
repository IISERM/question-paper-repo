/**
 * QPR File-Server Worker
 *
 * Handles two responsibilities:
 * 1. Git LFS Proxy — implements the LFS Batch API backed by Cloudflare R2
 * 2. File Serving — serves files by logical path for the browsing website
 *
 * LFS routes:
 *   POST /lfs/objects/batch  → LFS Batch API (upload/download negotiation)
 *   PUT  /lfs/objects/{oid}   → LFS object upload (basic transfer)
 *   GET  /lfs/objects/{oid}   → LFS object download (basic transfer)
 *
 * File serving:
 *   GET /file/{path}?oid={sha256:...}  → serve file from R2
 *   GET /file/{path}                   → redirect to GitHub raw URL (non-LFS fallback)
 */

// MIME type map for common file types served via /file/
const MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  zip: "application/zip",
};

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── LFS Batch API ──────────────────────────────────────────
      if (url.pathname === "/lfs/objects/batch" && request.method === "POST") {
        return handleLFSBatch(request, env, url);
      }

      // ── LFS Basic Transfer (upload) ────────────────────────────
      if (url.pathname.startsWith("/lfs/objects/") && request.method === "PUT") {
        return handleLFSObjectUpload(request, env, url);
      }

      // ── LFS Basic Transfer (download) ──────────────────────────
      if (url.pathname.startsWith("/lfs/objects/") && request.method === "GET") {
        return handleLFSObjectDownload(request, env, url);
      }

      // ── File Serving ───────────────────────────────────────────
      if (url.pathname.startsWith("/file/") && request.method === "GET") {
        return handleFileServe(request, env, url);
      }

      // ── LFS Batch (GET — clients sometimes probe this) ────────
      if (url.pathname === "/lfs/objects/batch" && request.method === "GET") {
        return new Response("LFS Batch API endpoint", {
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }

      // ── 404 ────────────────────────────────────────────────────
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error("Worker error:", error.message, error.stack);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// LFS Batch API
// ═══════════════════════════════════════════════════════════════

/**
 * Handle LFS Batch API (POST /lfs/objects/batch)
 *
 * The client sends:
 *   { operation: "upload"|"download",
 *     objects: [{ oid: "sha256:...", size: 12345 }],
 *     transfers: ["basic"] }
 *
 * We respond with:
 *   { transfer: "basic",
 *     objects: [{ oid, size, actions: { upload|download: { href, header?, expires_in? } } }] }
 */
async function handleLFSBatch(request, env, url) {
  try {
    const body = await request.json();
    const { operation, objects, transfers } = body;

    if (!operation || !objects || !Array.isArray(objects)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: operation and objects[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if "basic" transfer is supported (it always is here)
    if (transfers && !transfers.includes("basic")) {
      return new Response(
        JSON.stringify({ error: "Only 'basic' transfer mode is supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate OID format
    const oidPattern = /^sha256:[a-f0-9]{64}$/;
    for (const obj of objects) {
      if (!oidPattern.test(obj.oid)) {
        return new Response(
          JSON.stringify({ error: `Invalid OID format: ${obj.oid}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (operation === "upload") {
      return handleLFSBatchUpload(objects, env, url);
    } else if (operation === "download") {
      return handleLFSBatchDownload(objects, env, url);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported operation: ${operation}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    throw error;
  }
}

/**
 * Build batch response for uploads.
 * Returns action URLs so the client can PUT objects to R2.
 */
async function handleLFSBatchUpload(objects, env, url) {
  const objectsResponse = [];

  for (const obj of objects) {
    const r2Key = obj.oid; // Store in R2 by OID key
    const objectUrl = new URL(`/lfs/objects/${encodeURIComponent(obj.oid)}`, url.origin);

    objectsResponse.push({
      oid: obj.oid,
      size: obj.size,
      actions: {
        upload: {
          href: objectUrl.href,
          header: {
            "Content-Type": "application/octet-stream",
          },
          expires_in: 86400, // 24 hours
        },
      },
    });
  }

  return new Response(
    JSON.stringify({ transfer: "basic", objects: objectsResponse }),
    { headers: { ...corsHeaders, "Content-Type": "application/vnd.git-lfs+json" } }
  );
}

/**
 * Build batch response for downloads.
 * Verifies object exists in R2, returns download action URLs.
 */
async function handleLFSBatchDownload(objects, env, url) {
  const objectsResponse = [];

  for (const obj of objects) {
    const r2Key = obj.oid;

    // Check if object exists in R2
    const headResult = await env.R2_BUCKET.head(r2Key);

    if (headResult === null) {
      objectsResponse.push({
        oid: obj.oid,
        size: obj.size,
        error: {
          code: 404,
          message: "Object not found",
        },
      });
      continue;
    }

    const objectUrl = new URL(`/lfs/objects/${encodeURIComponent(obj.oid)}`, url.origin);

    objectsResponse.push({
      oid: obj.oid,
      size: headResult.size,
      actions: {
        download: {
          href: objectUrl.href,
          expires_in: 86400,
        },
      },
    });
  }

  return new Response(
    JSON.stringify({ transfer: "basic", objects: objectsResponse }),
    { headers: { ...corsHeaders, "Content-Type": "application/vnd.git-lfs+json" } }
  );
}

// ═══════════════════════════════════════════════════════════════
// LFS Basic Transfer Handlers
// ═══════════════════════════════════════════════════════════════

/**
 * Handle LFS object upload (PUT /lfs/objects/{oid})
 *
 * The client uploads the binary content directly.
 * We store it in R2 with the OID as the key.
 */
async function handleLFSObjectUpload(request, env, url) {
  const oid = extractOidFromPath(url.pathname, "/lfs/objects/");
  if (!oid) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing OID in path" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    await env.R2_BUCKET.put(oid, request.body, {
      httpMetadata: {
        contentType: "application/octet-stream",
      },
    });

    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error(`Failed to upload object ${oid}:`, error.message);
    return new Response(
      JSON.stringify({ error: "Failed to store object" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle LFS object download (GET /lfs/objects/{oid})
 *
 * Fetches the object from R2 and streams it to the client.
 */
async function handleLFSObjectDownload(request, env, url) {
  const oid = extractOidFromPath(url.pathname, "/lfs/objects/");
  if (!oid) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing OID in path" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const object = await env.R2_BUCKET.get(oid);

    if (object === null) {
      return new Response(
        JSON.stringify({ error: "Object not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(object.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": object.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: object.httpEtag || oid,
      },
    });
  } catch (error) {
    console.error(`Failed to download object ${oid}:`, error.message);
    return new Response(
      JSON.stringify({ error: "Failed to retrieve object" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// File Serving
// ═══════════════════════════════════════════════════════════════

/**
 * Handle file serving (GET /file/{path}?oid={sha256:...})
 *
 * Two modes:
 * 1. With ?oid= param: fetch the binary from R2, serve with correct Content-Type
 * 2. Without ?oid= param: redirect to GitHub raw URL (non-LFS legacy files)
 */
async function handleFileServe(request, env, url) {
  // Extract logical path from /file/{path}
  const filePath = url.pathname.replace(/^\/file\//, "");
  if (!filePath) {
    return new Response(
      JSON.stringify({ error: "Missing file path" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const oid = url.searchParams.get("oid");

  if (oid) {
    // ── LFS file: serve from R2 ───────────────────────────────
    try {
      const object = await env.R2_BUCKET.get(oid);

      if (object === null) {
        return new Response(
          JSON.stringify({ error: "File not found in storage" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Determine Content-Type from file extension
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      // Derive a filename for Content-Disposition
      const filename = filePath.split("/").pop() || "file";

      return new Response(object.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Content-Length": object.size.toString(),
          "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      console.error(`Failed to serve file ${filePath}:`, error.message);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } else {
    // ── Non-LFS file: redirect to GitHub raw ──────────────────
    const githubRaw = `https://github.com/IISERM/question-paper-repo/raw/main/${filePath}`;
    return Response.redirect(githubRaw, 302);
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Extract OID from URL path like /lfs/objects/sha256:abc123...
 * The OID in the path may be URL-encoded.
 */
function extractOidFromPath(pathname, prefix) {
  const raw = pathname.replace(prefix, "");
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  // Validate OID format: sha256:<64 hex chars>
  const match = decoded.match(/^(sha256:[a-f0-9]{64})$/);
  return match ? match[1] : null;
}
