# QPR File-Server Worker

Cloudflare Worker that handles two responsibilities:

1. **Git LFS Proxy** — implements the LFS Batch API backed by Cloudflare R2
2. **File Serving** — serves files by logical path for the browsing website

## Deployment

### Prerequisites

1. Create an R2 bucket named `qpr-lfs` in your Cloudflare account
2. Install dependencies: `npm install`

### Deploy

```bash
npm run deploy
```

### Configure Secrets (optional, for write access)

```bash
wrangler secret put LFS_UPLOAD_KEY
wrangler secret put LFS_UPLOAD_SECRET
```

## Routes

### LFS Proxy (for git clients)

- `POST /lfs/objects/batch` — LFS Batch API (upload/download negotiation)
- `PUT /lfs/objects/{oid}` — LFS object upload (basic transfer)
- `GET /lfs/objects/{oid}` — LFS object download (basic transfer)

### File Serving (for website)

- `GET /file/{path}?oid={sha256:...}` — serve file from R2
- `GET /file/{path}` — redirect to GitHub raw URL (non-LFS fallback)

## Configuration

The Worker is configured via `wrangler.toml`:

- `account_id` — your Cloudflare account ID
- `R2_BUCKET` binding — points to the `qpr-lfs` R2 bucket

## Usage

### Git LFS Configuration

Add to `.lfsconfig` in the repo root:

```ini
[lfs]
	url = https://files.qpr.turingclub.workers.dev/lfs
```

### Website Integration

The website constructs file URLs as:

```
https://files.qpr.turingclub.workers.dev/file/{encoded_path}?oid={lfsOid}
```

Where `lfsOid` is extracted from LFS pointer files during `data.json` generation.

## Architecture

```
┌─────────────┐
│  Git Client │
│  (lfs push) │
└──────┬──────┘
       │ POST /lfs/objects/batch
       │ PUT /lfs/objects/{oid}
       ▼
┌──────────────────┐
│  File-Server     │
│  Worker          │
│  (Cloudflare)    │
└──────┬───────────┘
       │ R2 binding
       ▼
┌──────────────────┐
│  R2 Bucket       │
│  (qpr-lfs)       │
│  Objects by OID  │
└──────────────────┘
       ▲
       │ GET /file/{path}?oid=...
       │
┌──────┴──────┐
│   Website   │
│  (browser)  │
└─────────────┘
```

## License

MIT
