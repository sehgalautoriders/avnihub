# AvniHub Roadmap — every Vercel use, mapped
*Written 01-09-2026. Target set by Ravi: 1 year, 5000 apps, then we enter the market.*

## What Vercel is actually used for, and where AvniHub stands

| # | Vercel use | What it means | AvniHub status |
|---|---|---|---|
| 1 | Static hosting | HTML/CSS/JS pages served fast | **HAVE** (v0.1, from DB at /site/) |
| 2 | CLI deploys | `vercel` command → live in seconds | **HAVE** (`deploy <slug> <folder>`) |
| 3 | Form/data capture | Vercel itself does NOT do this natively | **HAVE — our differentiator** (SQLite + Supabase master) |
| 4 | Git-connected deploys | push to GitHub → auto build + deploy | v0.4 |
| 5 | Preview deployments | every branch gets its own URL | v0.2 (versioned deploys) |
| 6 | Instant rollback | one click back to any older deploy | v0.2 |
| 7 | Custom domains + auto-SSL | yourname.com with padlock | Public rail — own domain "in some days" (Ravi), via Pages/CDN first |
| 8 | Global CDN / edge cache | fast everywhere on earth | Later — Cloudflare in front when traffic justifies |
| 9 | Serverless functions | API endpoints without a server | **HAVE first one** (Supabase Edge `avnihub-submit`); general per-site functions v0.5 (security review needed) |
| 10 | Build pipeline | Next.js/Vite build on deploy | v0.4 (Golden Stack: `npm build` on deploy) |
| 11 | Redirects / rewrites / headers | `vercel.json` per site | v0.3 (`avnihub.json`) |
| 12 | Env vars & secrets | per-site configuration | v0.3 |
| 13 | Request logs / observability | who hit what, when, errors | v0.2 (per-site log + counters in DB) |
| 14 | Analytics / Web Vitals | visits, speed scores | v0.3 (simple hit counter first) |
| 15 | Storage (KV, Blob, Postgres) | data products bolted on | **HAVE** (SQLite blobs + Supabase Postgres/Storage) |
| 16 | Cron jobs | scheduled functions | v0.3 (Windows scheduler first) |
| 17 | Team / RBAC | many developers, roles | Later — single operator until market entry |
| 18 | Templates marketplace | one-click starter sites | v0.6 — **Avni Store integration**: receipt form, feedback form, catalogue page, booking page as one-click templates |
| 19 | Password-protected previews | private staging links | v0.5 |
| 20 | Image optimization | auto-resize/webp | Later / skip until needed |
| 21 | AI SDK / v0 | AI page generation | Later — AE Brain already owns this muscle |

## Phases
- **v0.2 — Deploy like Vercel:** immutable versioned deploys, `rollback`, request log, hit counters.
- **v0.3 — Config:** `avnihub.json` (redirects/headers), per-site env vars, cron, analytics counters.
- **v0.4 — Build pipeline:** auto-build Golden Stack apps on deploy; watch a git repo → auto-deploy.
- **v0.5 — Functions:** sandboxed per-site endpoints. SECURITY REVIEW GATE before any third-party code runs.
- **v0.6 — Front door:** native tabbed AvniHub window (UI law) + Avni Store template marketplace.
- **Scale rail (continuous):** SQLite ⇄ Supabase sync; multi-tenant quotas. 5000 apps × ~50 MB
  average = ~250 GB — object storage math to be priced at v0.4.
- **Market rail:** trademark "Avni" (lawyer — Ravi), pricing, tenant isolation, abuse controls.

## Standing notes
- The current WhatsApp leg rides a third-party host; verify the tier is commercial-use
  compliant (free tiers commonly forbid commercial use in their ToS).
- Cloud rails carry uptime until the local host is certified for 24/7 duty.
