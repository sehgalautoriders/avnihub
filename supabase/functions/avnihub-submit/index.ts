// AvniHub public submission endpoint. The GitHub Pages form posts here; the receipt
// file goes to the private avnihub-receipts bucket and the row to avnihub_submissions.
// verify_jwt = false (public form), CORS open; the service key never leaves this function.
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_UPLOAD = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: CORS });
  }
  try {
    const form = await req.formData();
    const site = String(form.get("site") || "sehgal-care");
    const fields: Record<string, string> = {};
    let receiptPath: string | null = null;
    let receiptName: string | null = null;
    let sha256: string | null = null;
    let size = 0;

    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        const buf = new Uint8Array(await value.arrayBuffer());
        size = buf.length;
        if (size > MAX_UPLOAD) {
          return new Response(JSON.stringify({ ok: false, error: "file too large (10 MB limit)" }), {
            status: 413,
            headers: { ...CORS, "content-type": "application/json" },
          });
        }
        const digest = await crypto.subtle.digest("SHA-256", buf);
        sha256 = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        receiptName = value.name.replace(/[^A-Za-z0-9._-]/g, "_");
        receiptPath = `${site}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${receiptName}`;
        const up = await supa.storage.from("avnihub-receipts")
          .upload(receiptPath, buf, { contentType: value.type || "application/octet-stream" });
        if (up.error) throw up.error;
      } else if (key !== "site") {
        fields[key] = String(value).trim();
      }
    }

    if (Object.keys(fields).length === 0 && !receiptPath) {
      return new Response(JSON.stringify({ ok: false, error: "no form data" }), {
        status: 400,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    const ins = await supa.from("avnihub_submissions")
      .insert({
        site,
        fields,
        receipt_path: receiptPath,
        receipt_name: receiptName,
        sha256,
        size_bytes: size,
      })
      .select("id")
      .single();
    if (ins.error) throw ins.error;

    return new Response(JSON.stringify({ ok: true, id: ins.data.id }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
