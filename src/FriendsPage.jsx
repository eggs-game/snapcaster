import React, { useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import AccountProfile from "./AccountProfile.jsx";
import SiteFooter from "./SiteFooter.jsx";
import { getAccountSession, signInWithDiscord } from "./account.js";

export default function FriendsPage() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then((nextAccount) => { if (active) setAccount(nextAccount); })
      .catch((loadError) => { if (active) setError(String(loadError?.message || "Could not load your friends.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <main className="profile-page account-profile-page">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
        <nav className="site-header-actions" aria-label="Account navigation">
          <a className="site-header-link" href="/profile">Profile</a>
          <a className="site-header-link" href="/notifications">Notifications</a>
          <a className="site-header-link" href="/settings">Settings</a>
        </nav>
      </header>
      <section className="account-profile-page-shell">
        {loading ? (
          <p className="public-games-state">Loading friends…</p>
        ) : error && !account ? (
          <div className="games-empty"><h1>Friends unavailable</h1><p>{error}</p></div>
        ) : account ? (
          <AccountProfile account={account} page view="friends" />
        ) : (
          <div className="games-empty account-profile-sign-in">
            <UsersRound size={30} />
            <h1>Sign in to see your friends</h1>
            <p>Find players, check their presence, and visit their profiles.</p>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: "/friends" })}>Sign in with Discord</button>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
