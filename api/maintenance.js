import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return res.status(401).json({ error: "Unauthorized" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Maintenance is not configured" });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: retention, error: retentionError } = await admin.rpc("run_snapcast_retention");
  if (retentionError) return res.status(500).json({ error: "Retention failed" });

  const { data: due, error: dueError } = await admin.rpc("get_due_account_deletions", { max_rows: 50 });
  if (dueError) return res.status(500).json({ error: "Deletion queue failed", retention });

  const deleted = [];
  const failed = [];
  for (const item of due || []) {
    const profileId = item.target_profile_id;
    const { error: prepareError } = await admin.rpc("prepare_account_deletion", {
      target_profile_id: profileId,
    });
    if (prepareError) {
      failed.push({ profileId, stage: "prepare" });
      continue;
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(profileId);
    if (deleteError) failed.push({ profileId, stage: "identity" });
    else deleted.push(profileId);
  }

  return res.status(failed.length ? 207 : 200).json({
    retention,
    deletion: { deleted: deleted.length, failed: failed.length, failures: failed },
  });
}
