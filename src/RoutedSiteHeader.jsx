import React, { useEffect, useState } from "react";
import { getAccountSession, signInWithDiscord, signOutAccount } from "./account.js";
import SiteHeader from "./SiteHeader.jsx";

export default function RoutedSiteHeader({ redirectPath = window.location.pathname + window.location.search }) {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then((nextAccount) => { if (active) setAccount(nextAccount); })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load your account."));
      })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  return (
    <SiteHeader
      account={account}
      accountReady={ready}
      accountError={error}
      onCreate={() => { window.location.href = "/?action=create"; }}
      onJoin={() => { window.location.href = "/?action=join"; }}
      onSignIn={() => signInWithDiscord({ redirectPath })}
      onSignOut={async () => {
        await signOutAccount();
        window.location.href = "/";
      }}
    />
  );
}
