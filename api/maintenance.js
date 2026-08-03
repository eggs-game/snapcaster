import { createClient } from "@supabase/supabase-js";

const ANONYMOUS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ANONYMOUS_DELETE_LIMIT = 100;
const AUTH_PAGE_SIZE = 1000;
const AUTH_PAGE_LIMIT = 20;

export async function deleteExpiredAnonymousUsers(admin) {
  const cutoff = Date.now() - ANONYMOUS_RETENTION_MS;
  const expired = [];
  let page = 1;

  while (expired.length < ANONYMOUS_DELETE_LIMIT && page <= AUTH_PAGE_LIMIT) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error) return { deleted: 0, failed: 1, error: "list" };
    const users = data?.users || [];
    for (const user of users) {
      if (
        user.is_anonymous
        && Date.parse(user.created_at || "") < cutoff
        && expired.length < ANONYMOUS_DELETE_LIMIT
      ) expired.push(user.id);
    }
    if (users.length < AUTH_PAGE_SIZE) break;
    page += 1;
  }

  let deleted = 0;
  let failed = 0;
  for (const userId of expired) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) failed += 1;
    else deleted += 1;
  }
  return { deleted, failed };
}

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

  const anonymous = await deleteExpiredAnonymousUsers(admin);

  return res.status(failed.length || anonymous.failed ? 207 : 200).json({
    retention,
    deletion: { deleted: deleted.length, failed: failed.length, failures: failed },
    anonymous,
  });
}
