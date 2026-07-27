import { createClient } from "@supabase/supabase-js";

const APP_ORIGINS = new Set([
  "https://snapcast.app",
  "https://snapcaster.vercel.app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const origin = String(req.headers.origin || "");
  if (origin && !APP_ORIGINS.has(origin)) return res.status(403).json({ error: "Origin not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return res.status(503).json({ error: "Account deletion is not configured" });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return res.status(401).json({ error: "Invalid session" });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error: prepareError } = await admin.rpc("prepare_account_deletion", {
    target_profile_id: userData.user.id,
  });
  if (prepareError) return res.status(409).json({ error: "Deletion request is not ready" });

  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
  if (deleteError) return res.status(500).json({ error: "Account identity could not be deleted" });
  return res.status(200).json({ deleted: true });
}
