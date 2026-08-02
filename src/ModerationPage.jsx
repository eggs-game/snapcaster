import React, { useCallback, useEffect, useState } from "react";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import {
  getAccountSession,
  getModerationQueue,
  isModerator,
  resolveModerationAppeal,
  resolveModerationReport,
  resolveGameCorrection,
  signInWithDiscord,
  signOutAccount,
} from "./account.js";

export default function ModerationPage() {
  const [account, setAccount] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [queue, setQueue] = useState({ reports: [], corrections: [], appeals: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const nextAccount = await getAccountSession();
      setAccount(nextAccount);
      if (!nextAccount) {
        setAuthorized(false);
        return;
      }
      const hasAccess = await isModerator();
      setAuthorized(hasAccess);
      if (hasAccess) setQueue(await getModerationQueue());
    } catch (loadError) {
      setAuthorized(false);
      setError(String(loadError?.message || "Could not load the moderation queue."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const decideReport = async (report, status, removeReview = false) => {
    const promptLabel = status === "reviewing"
      ? "Optional private case note"
      : "Resolution note (kept in the moderator audit log)";
    const resolution = window.prompt(promptLabel, "") ?? null;
    if (resolution === null) return;
    try {
      await resolveModerationReport({
        reportId: report.id,
        status,
        resolution,
        removeReview,
      });
      await refresh();
    } catch (decisionError) {
      setError(String(decisionError?.message || "Could not update this report."));
    }
  };

  const decideAppeal = async (appeal, status) => {
    const resolution = window.prompt("Appeal decision and rationale");
    if (!resolution?.trim()) return;
    try {
      await resolveModerationAppeal({ appealId: appeal.id, status, resolution: resolution.trim() });
      await refresh();
    } catch (decisionError) {
      setError(String(decisionError?.message || "Could not resolve this appeal."));
    }
  };

  const decideCorrection = async (correction, accept) => {
    const resolution = window.prompt("Correction decision and rationale");
    if (!resolution?.trim()) return;
    try {
      await resolveGameCorrection({
        correctionId: correction.id,
        accept,
        resolution: resolution.trim(),
      });
      await refresh();
    } catch (decisionError) {
      setError(String(decisionError?.message || "Could not resolve this correction."));
    }
  };

  return (
    <main className="moderation-page">
      <SiteHeader
        account={account}
        accountReady={!loading}
        accountError={error}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: "/moderation" })}
        onSignOut={async () => {
          await signOutAccount();
          window.location.href = "/";
        }}
      />
      <section className="moderation-shell">
        <header className="moderation-heading">
          <p>Restricted operations</p>
          <h1>Moderation queue</h1>
          <span>Reports and appeals are visible only to explicitly granted moderator accounts.</span>
        </header>

        {loading ? (
          <p className="public-games-state">Checking access…</p>
        ) : !account ? (
          <div className="games-empty">
            <h2>Sign in required</h2>
            <p>Use the Discord account that has been granted moderator access.</p>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: "/moderation" })}>Sign in with Discord</button>
          </div>
        ) : !authorized ? (
          <div className="games-empty">
            <h2>Access denied</h2>
            <p>This account is not an active Snapcast moderator.</p>
          </div>
        ) : (
          <div className="moderation-columns">
            <section className="moderation-panel">
              <header><h2>Open reports</h2><span>{queue.reports.length}</span></header>
              {queue.reports.length ? queue.reports.map((report) => (
                <article className="moderation-case" key={report.id}>
                  <header>
                    <strong>{report.reason}</strong>
                    <span>{report.status}</span>
                  </header>
                  <p>
                    {report.reporter?.display_name || "Deleted player"} reported{" "}
                    {report.reported?.display_name || "Deleted player"} on{" "}
                    {new Date(report.created_at).toLocaleString()}.
                  </p>
                  {report.details && <blockquote>{report.details}</blockquote>}
                  {report.review && (
                    <div className="moderation-evidence">
                      <strong>Private review evidence · {report.review.rating}/5</strong>
                      <p>{report.review.comment || "No written comment."}</p>
                    </div>
                  )}
                  <footer>
                    <button type="button" onClick={() => decideReport(report, "reviewing")}>Claim</button>
                    <button type="button" onClick={() => decideReport(report, "dismissed")}>Dismiss</button>
                    <button type="button" onClick={() => decideReport(report, "resolved", Boolean(report.review))}>
                      {report.review ? "Remove review & resolve" : "Resolve"}
                    </button>
                  </footer>
                </article>
              )) : <p className="profile-empty">No open reports.</p>}
            </section>

            <div className="moderation-side-stack">
              <section className="moderation-panel">
                <header><h2>Game corrections</h2><span>{queue.corrections.length}</span></header>
                {queue.corrections.length ? queue.corrections.map((correction) => (
                  <article className="moderation-case" key={correction.id}>
                    <header>
                      <strong>{correction.player.display_name}</strong>
                      <span>correction</span>
                    </header>
                    <p>{correction.reason}</p>
                    <div className="moderation-evidence">
                      <strong>Requested values</strong>
                      <p>{Object.entries(correction.after_snapshot || {}).map(([key, value]) => `${key}: ${value || "clear"}`).join(" · ")}</p>
                    </div>
                    <footer>
                      <button type="button" onClick={() => decideCorrection(correction, false)}>Decline</button>
                      <button type="button" onClick={() => decideCorrection(correction, true)}>Accept</button>
                    </footer>
                  </article>
                )) : <p className="profile-empty">No pending corrections.</p>}
              </section>

              <section className="moderation-panel">
                <header><h2>Open appeals</h2><span>{queue.appeals.length}</span></header>
                {queue.appeals.length ? queue.appeals.map((appeal) => (
                  <article className="moderation-case" key={appeal.id}>
                    <header>
                      <strong>{appeal.appellant.display_name}</strong>
                      <span>appeal</span>
                    </header>
                    <p>{new Date(appeal.created_at).toLocaleString()}</p>
                    <blockquote>{appeal.reason}</blockquote>
                    <footer>
                      <button type="button" onClick={() => decideAppeal(appeal, "upheld")}>Uphold</button>
                      <button type="button" onClick={() => decideAppeal(appeal, "overturned")}>Overturn</button>
                    </footer>
                  </article>
                )) : <p className="profile-empty">No open appeals.</p>}
              </section>
            </div>
          </div>
        )}
        {error && <p className="modal-error" role="alert">{error}</p>}
      </section>
      <SiteFooter />
    </main>
  );
}
