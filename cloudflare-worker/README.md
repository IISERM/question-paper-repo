# QPR Contribution System - Cloudflare Worker Setup Guide

This guide will help you set up the Cloudflare Worker backend for the QPR contribution system.

## Prerequisites

- A Cloudflare account (free tier is sufficient)
- Node.js and npm installed
- A GitHub account
- Access to the IISERM/question-paper-repo repository settings

## Step 1: Create GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **"New OAuth App"**
3. Fill in the details:
   - **Application name:** `QPR Contribution Portal`
   - **Homepage URL:** `https://iiserm.github.io/question-paper-repo`
   - **Authorization callback URL:** `https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/auth/callback`
     - ⚠️ **Note:** You'll need to update this after deploying the worker
4. Click **"Register application"**
5. **Save** the following values (you'll need them later):
   - Client ID
   - Click "Generate a new client secret" and save the Client Secret

## Step 2: Install Wrangler CLI

Wrangler is Cloudflare's command-line tool for managing Workers.

```bash
npm install -g wrangler
```

Verify installation:

```bash
wrangler --version
```

## Step 3: Login to Cloudflare

```bash
wrangler login
```

This will open your browser and ask you to authorize Wrangler to access your Cloudflare account.

## Step 4: Configure the Worker

1. Navigate to the cloudflare-worker directory:

   ```bash
   cd cloudflare-worker
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Open `wrangler.toml` and update if needed:
   ```toml
   name = "qpr-contribution-worker"  # You can change this
   ```

## Step 5: Add Secrets

Add your GitHub OAuth credentials as secrets (they won't be stored in code):

```bash
wrangler secret put GITHUB_CLIENT_ID
# Paste your GitHub Client ID when prompted

wrangler secret put GITHUB_CLIENT_SECRET
# Paste your GitHub Client Secret when prompted
```

## Step 6: Deploy the Worker

```bash
wrangler deploy
```

After deployment, you'll see output like:

```
Published qpr-contribution-worker (X.XX sec)
  https://qpr-contribution-worker.YOUR-SUBDOMAIN.workers.dev
```

**Save this URL!** This is your `WORKER_URL`.

## Step 7: Update GitHub OAuth App

1. Go back to https://github.com/settings/developers
2. Click on your "QPR Contribution Portal" app
3. Update the **Authorization callback URL** to:
   ```
   https://qpr-contribution-worker.YOUR-SUBDOMAIN.workers.dev/auth/callback
   ```
   (Replace with your actual worker URL)
4. Click **"Update application"**

## Step 8: Update Frontend Configuration

Update `docs/contribute.js` with your worker URL and Client ID:

```javascript
// Line 6-7
const CONFIG = {
  WORKER_URL: "https://qpr-contribution-worker.YOUR-SUBDOMAIN.workers.dev",
  GITHUB_CLIENT_ID: "YOUR_GITHUB_CLIENT_ID",
  // ... rest of config
};
```

**Replace:**

- `YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev` with your actual worker URL
- `YOUR_GITHUB_CLIENT_ID` with your GitHub Client ID

## Step 9: Test the System

1. Commit and push your changes:

   ```bash
   git add docs/contribute.js docs/contribute.html docs/index.html docs/styles.css
   git commit -m "Add contribution portal"
   git push
   ```

2. Wait a minute for GitHub Pages to deploy

3. Visit: https://iiserm.github.io/question-paper-repo/docs/contribute.html

4. Click "Sign in with GitHub" and test the flow!

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:

1. Check that `FRONTEND_URL` in `wrangler.toml` matches your GitHub Pages URL
2. Redeploy the worker: `wrangler deploy`

### OAuth Fails

If OAuth redirect fails:

1. Verify the callback URL in your GitHub OAuth app matches your worker URL exactly
2. Check that secrets are set correctly:
   ```bash
   wrangler secret list
   ```

### Worker Errors

View worker logs:

```bash
wrangler tail
```

Then try your contribution again to see real-time logs.

### Rate Limits

GitHub API has rate limits:

- Authenticated: 5,000 requests/hour
- For most users, this is more than enough

If you hit rate limits, wait an hour or implement caching.

## Managing the Worker

### View logs in real-time:

```bash
wrangler tail
```

### Update the worker:

```bash
wrangler deploy
```

### Delete the worker:

```bash
wrangler delete
```

### View secrets:

```bash
wrangler secret list
```

### Update a secret:

```bash
wrangler secret put SECRET_NAME
```

## Free Tier Limits

Cloudflare Workers Free Tier:

- ✅ 100,000 requests per day
- ✅ 10 MB request body size (hence the 10MB file limit)
- ✅ 128 MB memory per worker
- ✅ 10ms CPU time per request

This is more than sufficient for a contribution system!

## Security Notes

1. **Never commit secrets** - Always use `wrangler secret put`
2. **Client Secret** is never exposed to the frontend
3. **CORS** is configured to only allow requests from your GitHub Pages domain
4. **OAuth tokens** are only used for the specific API calls needed

## Support

If you encounter issues:

1. Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
2. Open an issue in the GitHub repository
3. Check browser console for detailed error messages

## Development

To test locally:

```bash
wrangler dev
```

This starts a local server at `http://localhost:8787`

Update `contribute.js` temporarily to use this local URL for testing:

```javascript
WORKER_URL: 'http://localhost:8787',
```

Remember to change it back before committing!

## Architecture Overview

```
User Browser
     ↓
     ↓ (1) Click "Sign in with GitHub"
     ↓
GitHub OAuth
     ↓ (2) User authorizes
     ↓
Cloudflare Worker (/auth/callback)
     ↓ (3) Exchange code for token
     ↓
User Browser (token stored)
     ↓ (4) Upload files
     ↓
Cloudflare Worker (API endpoints)
     ↓ (5) Fork, create branch, upload
     ↓
GitHub API
     ↓ (6) Create PR
     ↓
User sees success!
```

## Endpoints

The worker provides these endpoints:

- `GET /auth/callback` - OAuth callback handler
- `POST /api/check-fork` - Check if user has forked the repo
- `POST /api/fork` - Fork the repository
- `POST /api/create-branch` - Create a new branch
- `POST /api/upload-file` - Upload a file to the branch
- `POST /api/create-pr` - Create a pull request
- `POST /api/pageview` - Increment & return anonymous visit counts (no auth)

All API endpoints (except `/auth/callback` and `/api/pageview`) require the `Authorization: Bearer <token>` header.

### Page View Counter

The docs footer displays a live visitor count using this worker. To enable it:

1. Create a Cloudflare KV namespace (e.g., `qpr-pageviews`) and note the production + preview IDs.
2. Bind it in `wrangler.toml` as `PAGE_VIEW_STORE` (see the commented `kv_namespaces` block).
3. Deploy the worker. The frontend (via `docs/footer.js`) will POST `{ counter, path }` to `/api/pageview` and show the returned totals.

If the KV binding is missing, the endpoint responds with `{ "disabled": true }` so the UI can fall back gracefully.

## Next Steps

After successful setup:

1. ✅ Test the contribution flow end-to-end
2. ✅ Monitor worker logs for any errors
3. ✅ Share the contribution page with your community
4. ✅ Review PRs as they come in!

Happy contributing! 🎉
