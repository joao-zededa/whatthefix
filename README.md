# WhatTheFix

WhatTheFix is a focused search companion for the EVE-OS code base. Drop in a commit SHA, a few keywords, or even natural language (“memory oct 2025”) and instantly see matching commits, their metadata, and the EVE-OS releases that already contain the fix.

---

## Why It’s Handy

- **Unified search bar** – understands commit hashes, message keywords, PR URLs, and date phrases like `oct 13` or `november 2024`.
- **Version awareness** – one click shows which tags (and LTS builds) contain a commit, using a local clone for sub-second lookups.
- **Rich commit viewer** – modal view with message, author, timestamps, tags, backport analysis, and quick GitHub links.
- **Friendly UX** – example chips, keyboard shortcuts, responsive layout, and smart hints keep power features discoverable.
- **Performance minded** – transparent caching, rate-limit friendly GitHub requests, and optional personal tokens when you need more headroom.

---

## Quick Start

> Requirements: Node.js 18+, Git, and a GitHub account (token optional but recommended).

```bash
# 1. Grab the code
git clone https://github.com/<your-org>/whatthefix.git
cd whatthefix

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env   # or create manually, see below

# 4. Launch the app
npm run dev            # auto-reloads on change
# or
npm start

# 5. Open your browser
# http://localhost:3000
```

### Minimal `.env`

```ini
PORT=3000
SESSION_SECRET=super-secret
REDIS_URL=redis://127.0.0.1:6379
TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key==

# Optional but useful
GITHUB_TOKEN=ghp_xxx               # raises API rate limits
CORS_ORIGIN=http://localhost:3000
```

- Provision Redis locally or point `REDIS_URL` at an existing instance.
- To persist encrypted user tokens, supply Cloudflare D1 credentials (`CLOUDFLARE_ACCOUNT_ID`, `..._DATABASE_ID`, `..._API_TOKEN`).
- SSO and OIDC settings (Okta/Google) stay in `.env` as provided; leave them blank if you don’t need authentication yet.

When the server boots for the first time it clones the EVE-OS repository into a cache directory so tag lookups are instant. Background jobs keep that clone fresh.

---
## Screenshots

---

## Daily Use Highlights

- **Keyword + date filters**  
  Combine text and time: `fix crash oct 2025` narrows to October 2025; `memory oct 13` finds commits on that exact day. Omit the year (`oct 13`) to default to the current year.

- **Commit / PR URLs**  
  Paste a GitHub commit or pull request URL to jump directly to its commits—useful for code reviews or patch hunts.

- **Tag discovery**  
  Open any commit → *Find Tags Containing This Commit* to list all releases (with LTS flair) that include the change.

- **Keyboard shortcuts**  
  `/` focuses search, `Ctrl/Cmd + K` clears, `Esc` closes modals, `Enter` runs searches.

- **Session security**  
  All tokens are AES-GCM encrypted before hitting Redis; optional Cloudflare D1 storage keeps encrypted copies for resilience.

---

## REST Endpoints (for automation)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search/commits?query=...&type=message|sha` | Search commits with pagination and optional natural-language date filters. |
| `GET /api/commits/:sha` | Fetch commit details. |
| `GET /api/commits/:sha/tags` | List tags that contain the commit. |
| `GET /api/tags` | Browse tags (supports LTS-only and limit query params). |

Search responses include:
- `search_terms`, `original_query`
- `applied_filters` → `{ year, month, day, assumedCurrentYear }`
- `total_count` (GitHub’s count) and `filtered_total` (after local date filtering)

---

## Troubleshooting

- **Empty results?** Try loosening the query or remove the date phrase; the header shows any active date filter.
- **GitHub rate limit hit?** Add `GITHUB_TOKEN` to `.env` for 5,000 requests/hour.
- **Redis connection errors?** Confirm the instance is running and reachable at `REDIS_URL`.
- **Cloudflare D1 timeouts?** Token storage still works in-session; the log will flag persistence failures without blocking requests.

---

## Contributing

Issues and PRs are welcome! Please include screenshots or reproduction steps when reporting UI/UX bugs. For feature work, file an issue first so we can agree on scope before implementation.

Enjoy faster fix hunting with WhatTheFix!
