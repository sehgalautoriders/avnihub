// One-shot DDL: creates AvniHub's master table in Supabase. Deployed, invoked once
// with the service key, then deleted. RLS is enabled with NO policies on purpose:
// only the service role (the avnihub-submit function) can touch the table.
import postgres from "npm:postgres";

Deno.serve(async () => {
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  try {
    await sql`create table if not exists public.avnihub_submissions (
      id bigint generated always as identity primary key,
      site text not null,
      created_at timestamptz not null default now(),
      fields jsonb not null default '{}'::jsonb,
      receipt_path text,
      receipt_name text,
      sha256 text,
      size_bytes bigint
    )`;
    await sql`alter table public.avnihub_submissions enable row level security`;
    const [{ count }] = await sql`select count(*)::int as count from public.avnihub_submissions`;
    return new Response(JSON.stringify({ ok: true, rows: count }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});
