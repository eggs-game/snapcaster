const FREE_TIER_GB = 1000;
const GB = 1_000_000_000;

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sameOrigin(req) {
  const origin = header(req, "origin");
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === String(host).split(",")[0].trim();
  } catch {
    return false;
  }
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "Invalid origin" });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;
  if (!accountId || !apiToken) {
    return res.status(503).json({ error: "TURN analytics is not configured" });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const dateFrom = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const dateTo = now.toISOString().slice(0, 10);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const query = `query turnUsage($accountId: String!, $dateFrom: Date!, $dateTo: Date!) {
    viewer {
      accounts(filter: { accountTag: $accountId }) {
        callsTurnUsageAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $dateFrom, date_leq: $dateTo }
        ) {
          sum { egressBytes ingressBytes }
        }
      }
    }
  }`;

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { accountId, dateFrom, dateTo } }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) {
      console.error("Cloudflare TURN analytics request failed", response.status, payload.errors || payload);
      return res.status(502).json({ error: "TURN analytics provider failed" });
    }
    const groups = payload.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(groups)) {
      return res.status(502).json({ error: "TURN analytics response was incomplete" });
    }
    const totals = groups.reduce((sum, group) => ({
      egressBytes: sum.egressBytes + (Number(group?.sum?.egressBytes) || 0),
      ingressBytes: sum.ingressBytes + (Number(group?.sum?.ingressBytes) || 0),
    }), { egressBytes: 0, ingressBytes: 0 });
    const egressGb = totals.egressBytes / GB;
    const projectedGb = dayOfMonth ? (egressGb / dayOfMonth) * daysInMonth : egressGb;
    return res.status(200).json({
      period: { from: dateFrom, through: dateTo, dayOfMonth, daysInMonth },
      egressGb: round(egressGb, 3),
      ingressGb: round(totals.ingressBytes / GB, 3),
      allowanceGb: FREE_TIER_GB,
      usedPercent: round((egressGb / FREE_TIER_GB) * 100, 3),
      projectedGb: round(projectedGb, 2),
      projectedPercent: round((projectedGb / FREE_TIER_GB) * 100, 2),
    });
  } catch (error) {
    console.error("Cloudflare TURN analytics request failed", error);
    return res.status(502).json({ error: "TURN analytics provider failed" });
  }
}
