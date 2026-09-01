#!/usr/bin/env python3
r"""AvniHub - self-hosted page host: deploy a folder, serve it, capture submissions.

The job Vercel does for sehgal-care.vercel.app, done on our own metal and our own
database: a site is a folder, `deploy` puts it in SQLite, `serve` answers HTTP for
every site at /<slug>/, and any form POSTed to /<slug>/submit is stored - fields
plus uploaded files - in the same database.

MVP v0.1, 01-09-2026. LAN serving only. Public (WhatsApp) reach is a separate,
Architect-gated decision - see docs\AVNIHUB_TRACKER.xlsx.

Usage:
  python avnihub.py init                       create DB, deploy every folder in ..\seed\
  python avnihub.py deploy <slug> <folder>     (re)deploy a folder as site <slug>
  python avnihub.py serve [port]               serve on 0.0.0.0:<port>  (default 8190)
  python avnihub.py submissions <slug>         list captured submissions for a site
  python avnihub.py export <file_id> <outdir>  write one uploaded file back to disk
"""
import hashlib
import io
import json
import mimetypes
import sqlite3
import sys
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as EMAIL_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "avnihub.sqlite"
SEED_DIR = ROOT / "seed"
DEFAULT_PORT = 8190
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB per request body

SCHEMA = """
CREATE TABLE IF NOT EXISTS sites(
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(site_id, path));
CREATE TABLE IF NOT EXISTS submissions(
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  created_at TEXT NOT NULL,
  remote_ip TEXT,
  fields_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  field TEXT,
  filename TEXT,
  content_type TEXT,
  size INTEGER,
  sha256 TEXT,
  data BLOB);
"""


def now() -> str:
    return datetime.now().strftime("%d-%m-%Y %H:%M:%S")


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    con.row_factory = sqlite3.Row
    return con


def guess_type(path: str) -> str:
    ctype, _ = mimetypes.guess_type(path)
    return ctype or "application/octet-stream"


def deploy(slug: str, folder: Path) -> int:
    if not folder.is_dir():
        sys.exit(f"deploy: not a folder: {folder}")
    con = db()
    ts = now()
    con.execute(
        "INSERT INTO sites(slug, name, created_at, updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(slug) DO UPDATE SET updated_at=excluded.updated_at",
        (slug, slug.replace("-", " ").title(), ts, ts),
    )
    site_id = con.execute("SELECT id FROM sites WHERE slug=?", (slug,)).fetchone()[0]
    count = 0
    for f in sorted(folder.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(folder).as_posix()
        con.execute(
            "INSERT INTO pages(site_id, path, content_type, body, updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(site_id, path) DO UPDATE SET "
            "content_type=excluded.content_type, body=excluded.body, updated_at=excluded.updated_at",
            (site_id, rel, guess_type(rel), f.read_bytes(), ts),
        )
        count += 1
    con.commit()
    con.close()
    print(f"deployed {slug}: {count} file(s) from {folder}")
    return count


def cmd_init() -> None:
    total = 0
    if SEED_DIR.is_dir():
        for site_dir in sorted(SEED_DIR.iterdir()):
            if site_dir.is_dir():
                total += deploy(site_dir.name, site_dir)
    print(f"init complete: db={DB_PATH} pages={total}")


class Handler(BaseHTTPRequestHandler):
    server_version = "AvniHub/0.1"

    # -- helpers ---------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8",
              extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _page(self, con: sqlite3.Connection, slug: str, path: str):
        return con.execute(
            "SELECT p.content_type, p.body FROM pages p JOIN sites s ON s.id=p.site_id "
            "WHERE s.slug=? AND p.path=?",
            (slug, path),
        ).fetchone()

    def _is_local_admin(self) -> bool:
        return self.client_address[0] in ("127.0.0.1", "::1")

    # -- GET -------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        raw = self.path.split("?", 1)[0]
        parts = [p for p in raw.split("/") if p and p != ".."]
        con = db()
        try:
            if raw == "/health":
                stats = {
                    "app": "AvniHub 0.1",
                    "time": now(),
                    "sites": con.execute("SELECT COUNT(*) FROM sites").fetchone()[0],
                    "pages": con.execute("SELECT COUNT(*) FROM pages").fetchone()[0],
                    "submissions": con.execute("SELECT COUNT(*) FROM submissions").fetchone()[0],
                }
                self._send(200, json.dumps(stats).encode(), "application/json")
                return
            if parts and parts[0] == "admin":
                self._admin(con, parts)
                return
            if not parts:
                slugs = [r[0] for r in con.execute("SELECT slug FROM sites ORDER BY slug")]
                links = "".join(f'<li><a href="/{s}/">/{s}/</a></li>' for s in slugs)
                self._send(200, f"<h1>AvniHub</h1><ul>{links}</ul>".encode())
                return
            slug, rest = parts[0], "/".join(parts[1:]) or "index.html"
            row = self._page(con, slug, rest)
            if row is None and not raw.endswith("/") and len(parts) == 1:
                # bare /slug -> redirect to /slug/ so relative paths resolve
                self._send(301, b"", extra={"Location": f"/{slug}/"})
                return
            if row is None:
                self._send(404, b"<h1>404 - page not found</h1>")
                return
            self._send(200, row["body"], row["content_type"])
        finally:
            con.close()

    def _admin(self, con: sqlite3.Connection, parts: list[str]) -> None:
        if not self._is_local_admin():
            self._send(403, b"admin is localhost-only")
            return
        if len(parts) >= 3 and parts[1] == "submissions":
            rows = con.execute(
                "SELECT sub.id, sub.created_at, sub.remote_ip, sub.fields_json, "
                "  (SELECT json_group_array(json_object('file_id', f.id, 'filename', f.filename, "
                "   'size', f.size, 'sha256', f.sha256)) FROM files f WHERE f.submission_id=sub.id) AS files "
                "FROM submissions sub JOIN sites s ON s.id=sub.site_id "
                "WHERE s.slug=? ORDER BY sub.id DESC",
                (parts[2],),
            ).fetchall()
            out = [
                {**dict(r), "fields_json": json.loads(r["fields_json"]),
                 "files": json.loads(r["files"])}
                for r in rows
            ]
            self._send(200, json.dumps(out, indent=1).encode(), "application/json")
        elif len(parts) >= 3 and parts[1] == "file":
            row = con.execute(
                "SELECT filename, content_type, data FROM files WHERE id=?", (parts[2],)
            ).fetchone()
            if row is None:
                self._send(404, b"no such file")
            else:
                self._send(200, row["data"], row["content_type"] or "application/octet-stream",
                           extra={"Content-Disposition": f'attachment; filename="{row["filename"]}"'})
        else:
            self._send(404, b"admin: /admin/submissions/<slug> or /admin/file/<id>")

    # -- POST ------------------------------------------------------------
    def do_POST(self) -> None:  # noqa: N802
        parts = [p for p in self.path.split("?", 1)[0].split("/") if p]
        if len(parts) != 2 or parts[1] != "submit":
            self._send(404, b"POST only accepted at /<site>/submit")
            return
        slug = parts[0]
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, b"empty body")
            return
        if length > MAX_UPLOAD:
            self._send(413, b"upload too large (10 MB limit)")
            return
        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            self._send(415, b"expected multipart/form-data")
            return
        msg = BytesParser(policy=EMAIL_POLICY).parsebytes(
            b"Content-Type: " + ctype.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
        )
        fields: dict[str, str] = {}
        uploads: list[tuple[str, str, str, bytes]] = []
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition") or ""
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename:
                uploads.append((name, filename, part.get_content_type(), payload))
            else:
                fields[name] = payload.decode("utf-8", "replace").strip()
        if not fields and not uploads:
            self._send(400, b"no form data found")
            return
        con = db()
        try:
            site = con.execute("SELECT id FROM sites WHERE slug=?", (slug,)).fetchone()
            if site is None:
                self._send(404, b"no such site")
                return
            cur = con.execute(
                "INSERT INTO submissions(site_id, created_at, remote_ip, fields_json) VALUES(?,?,?,?)",
                (site["id"], now(), self.client_address[0], json.dumps(fields, ensure_ascii=False)),
            )
            sub_id = cur.lastrowid
            for field, filename, ftype, data in uploads:
                con.execute(
                    "INSERT INTO files(submission_id, field, filename, content_type, size, sha256, data) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (sub_id, field, Path(filename).name, ftype, len(data),
                     hashlib.sha256(data).hexdigest(), data),
                )
            con.commit()
            if self._page(con, slug, "thanks.html"):
                self._send(303, b"", extra={"Location": f"/{slug}/thanks.html"})
            else:
                self._send(200, b"<h1>&#10003; Received</h1><p>Your submission was recorded.</p>")
        finally:
            con.close()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"{now()} {self.client_address[0]} {fmt % args}\n")


def cmd_serve(port: int) -> None:
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"AvniHub serving on 0.0.0.0:{port}  db={DB_PATH}")
    srv.serve_forever()


def cmd_submissions(slug: str) -> None:
    con = db()
    rows = con.execute(
        "SELECT sub.id, sub.created_at, sub.remote_ip, sub.fields_json FROM submissions sub "
        "JOIN sites s ON s.id=sub.site_id WHERE s.slug=? ORDER BY sub.id DESC", (slug,)
    ).fetchall()
    for r in rows:
        files = con.execute(
            "SELECT id, filename, size FROM files WHERE submission_id=?", (r["id"],)
        ).fetchall()
        ftxt = ", ".join(f"#{f['id']} {f['filename']} ({f['size']} B)" for f in files) or "-"
        print(f"[{r['id']}] {r['created_at']} from {r['remote_ip']}  {r['fields_json']}  files: {ftxt}")
    print(f"total: {len(rows)}")


def cmd_export(file_id: str, outdir: str) -> None:
    con = db()
    row = con.execute("SELECT filename, data FROM files WHERE id=?", (file_id,)).fetchone()
    if row is None:
        sys.exit(f"no file #{file_id}")
    out = Path(outdir) / row["filename"]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(row["data"])
    print(f"wrote {out} ({len(row['data'])} B)")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cmd = args[0]
    if cmd == "init":
        cmd_init()
    elif cmd == "deploy" and len(args) == 3:
        deploy(args[1], Path(args[2]))
    elif cmd == "serve":
        cmd_serve(int(args[1]) if len(args) > 1 else DEFAULT_PORT)
    elif cmd == "submissions" and len(args) == 2:
        cmd_submissions(args[1])
    elif cmd == "export" and len(args) == 3:
        cmd_export(args[1], args[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
