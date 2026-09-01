# AvniHub — our own Vercel

**What it is:** the job vercel.com / netlify.com / GitHub Pages do, built for ourselves.
A site is a folder. Deploy it, get a link, and everything a customer submits — fields
plus files — lands in OUR master database (Supabase, Mumbai) with a local SQLite pilot rail.

Born 01-09-2026 as "Avni Vercel" from Ravi's order: *"Make Avni Vercel type app we can
use in every WhatsApp. First small in our Database, then lets see how it goes."*
Renamed AvniHub the same evening. Target: **1 year, 5000 apps, then we enter the market.**

## The three rails (all measured working 01-09-2026)
1. **Local rail** — `engine\avnihub.py` (Python stdlib + SQLite): `deploy` a folder →
   served at `/<site>/` on `:8190`; `POST /<site>/submit` captures forms + files.
2. **Cloud database rail (master)** — Supabase project "Sehgal Hero" (ap-south-1):
   Edge Function `avnihub-submit` (public, CORS) stores receipts in the private
   `avnihub-receipts` bucket and rows in `avnihub_submissions` (RLS: service-role only).
3. **Public page rail** — `site\` deployed on GitHub Pages; the page posts to the
   Edge Function. No key ever ships in the page. Own domain comes later.

## Layout
- `engine\avnihub.py` — local host engine (init / deploy / serve / submissions / export)
- `data\avnihub.sqlite` — local pilot DB (git-ignored)
- `seed\sehgal-care\` — LAN variant of the pilot site (posts to the local engine)
- `site\` — public variant (posts to Supabase; this is what GitHub Pages serves)
- `supabase\functions\avnihub-submit\` — the public capture endpoint
- `docs\AVNIHUB_TRACKER.xlsx` — item-by-item status, measured
- `ROADMAP.md` — every Vercel use, mapped to what AvniHub builds, phased
