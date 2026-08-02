import React, { useEffect, useState } from "react";
import { Settings, UserRound } from "lucide-react";
import AccountProfile from "./AccountProfile.jsx";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import {
  getAccountSession,
  signInWithDiscord,
  signOutAccount,
  updateAccountSettings,
} from "./account.js";

export default function SettingsPage() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then((nextAccount) => { if (active) setAccount(nextAccount); })
      .catch((loadError) => { if (active) setError(String(loadError?.message || "Could not load your settings.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const saveSettings = async (values) => {
    const nextAccount = await updateAccountSettings(account, values);
    setAccount(nextAccount);
    localStorage.setItem("sc-name", nextAccount.profile.display_name);
    localStorage.setItem("theme-preference", nextAccount.preferences.theme);
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const preference = nextAccount.preferences.theme;
    document.documentElement.dataset.theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
    document.documentElement.dataset.themePreference = preference;
  };

  return (
    <main className="profile-page account-profile-page settings-page">
      <SiteHeader
        account={account}
        accountReady={!loading}
        accountError={error}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: "/settings" })}
        onSignOut={async () => {
          await signOutAccount();
          window.location.href = "/";
        }}
      />
      <section className="account-profile-page-shell focused-account-page-shell">
        {loading ? (
          <p className="public-games-state">Loading settings…</p>
        ) : error ? (
          <div className="games-empty"><h1>Settings unavailable</h1><p>{error}</p></div>
        ) : account ? (
          <AccountProfile account={account} page view="settings" onSave={saveSettings} />
        ) : (
          <div className="games-empty account-profile-sign-in">
            <Settings size={30} />
            <h1>Sign in to manage settings</h1>
            <p>Save your profile, devices, appearance, and privacy preferences.</p>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: "/settings" })}>
              <UserRound size={16} /> Sign in with Discord
            </button>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
