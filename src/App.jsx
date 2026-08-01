import React, { lazy, Suspense, useEffect, useState } from "react";
import Lobby from "./Lobby.jsx";
import AccountPrompt from "./AccountPrompt.jsx";

const Game = lazy(() => import("./Game.jsx"));
const loadAccount = () => import("./account.js");
const loadGameRooms = () => import("./gameRooms.js");

const THEME_KEY = "theme-preference";
const ACTIVE_SESSION_KEY = "snapcast-active-room";
const THEME_OPTIONS = new Set(["light", "dark", "system"]);

function initialThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_OPTIONS.has(saved) ? saved : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(preference) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
}

function initialSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ACTIVE_SESSION_KEY) || "null");
    if (
      saved
      && typeof saved.code === "string"
      && typeof saved.name === "string"
      && typeof saved.participantId === "string"
      && Number.isFinite(saved.joinedAt)
    ) return saved;
  } catch { /* start at the lobby when session recovery is unavailable */ }
  return null;
}

export default function App() {
  const [session, setSession] = useState(initialSession); // {code, name, role, participantId, joinedAt}
  const [account, setAccount] = useState(null);
  const [accountReady, setAccountReady] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountPromptDismissed, setAccountPromptDismissed] = useState(false);
  const [savedCommanderDecks, setSavedCommanderDecks] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [themePreference, setThemePreference] = useState(initialThemePreference);

  const startSession = (nextSession) => {
    const next = {
      ...nextSession,
      participantId: nextSession.participantId || crypto.randomUUID(),
      joinedAt: Number(nextSession.joinedAt) || Date.now(),
    };
    try { sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(next)); } catch { /* recovery remains unavailable */ }
    setSession(next);
  };

  const leaveSession = () => {
    try { sessionStorage.removeItem(ACTIVE_SESSION_KEY); } catch { /* state still clears in memory */ }
    setSession(null);
  };

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    loadAccount().then(async (accountApi) => {
      if (!active) return;
      unsubscribe = accountApi.subscribeToAccount((nextAccount, error) => {
        if (!active) return;
        if (error) {
          setAccountError(String(error?.message || "Could not load your account."));
          setAccountReady(true);
          return;
        }
        setAccount(nextAccount);
        setAccountReady(true);
        if (nextAccount) setAccountPromptDismissed(true);
      });
      try {
        const nextAccount = await accountApi.getAccountSession();
        if (!active) return;
        setAccount(nextAccount);
        if (nextAccount) {
          const pending = accountApi.takePendingGame();
          if (pending) {
            if (pending.membershipId && pending.participantToken) {
              const { claimGuestGameMembership } = await loadGameRooms();
              await claimGuestGameMembership({
                membershipId: pending.membershipId,
                participantToken: pending.participantToken,
              });
            }
            if (active) setSession({
              ...pending,
              profileId: nextAccount.user.id,
            });
          }
        }
      } catch (error) {
        if (active) setAccountError(String(error?.message || "Could not load your account."));
      } finally {
        if (active) setAccountReady(true);
      }
    }).catch((error) => {
      if (active) {
        setAccountError(String(error?.message || "Could not load your account."));
        setAccountReady(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const accountTheme = account?.preferences?.theme;
    if (THEME_OPTIONS.has(accountTheme)) setThemePreference(accountTheme);
  }, [account?.preferences?.theme]);

  useEffect(() => {
    if (!account) {
      setSavedCommanderDecks([]);
      return undefined;
    }
    let active = true;
    loadAccount()
      .then(({ listSavedCommanderDecks }) => listSavedCommanderDecks(account))
      .then((decks) => { if (active) setSavedCommanderDecks(decks); })
      .catch(() => { if (active) setSavedCommanderDecks([]); });
    return () => { active = false; };
  }, [account?.user?.id]);

  useEffect(() => {
    if (!account) {
      setUnreadNotifications(0);
      return undefined;
    }
    let active = true;
    let unsubscribe = () => {};
    let timer = null;
    const refresh = () => loadAccount()
      .then(({ getSocialDashboard }) => getSocialDashboard())
      .then((dashboard) => {
        if (active) setUnreadNotifications(
          (dashboard.notifications || []).filter((notification) => !notification.read_at).length,
        );
      })
      .catch(() => {});
    refresh();
    loadAccount().then(({ subscribeToNotifications }) => {
      if (!active) return;
      unsubscribe = subscribeToNotifications(account, refresh);
      timer = window.setInterval(refresh, 60000);
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
      if (timer) window.clearInterval(timer);
    };
  }, [account?.user?.id]);

  useEffect(() => {
    if (!session || !account) return;
    setSession((current) => current ? {
      ...current,
      profileId: account.user.id,
      savedCommanderDecks,
    } : current);
  }, [account?.user?.id, savedCommanderDecks]);

  useEffect(() => {
    if (!account || !session?.membershipId || !session?.participantToken) return;
    loadGameRooms()
      .then(({ claimGuestGameMembership }) => claimGuestGameMembership({
        membershipId: session.membershipId,
        participantToken: session.participantToken,
      }))
      .catch(() => {});
  }, [account?.user?.id, session?.membershipId, session?.participantToken]);

  useEffect(() => {
    if (!account) return undefined;
    const status = session ? "in_game" : "online";
    const publish = () => loadAccount()
      .then(({ updatePresence }) => updatePresence(status, session?.gameId || null))
      .catch(() => {});
    publish();
    const timer = window.setInterval(publish, 60000);
    return () => window.clearInterval(timer);
  }, [account?.user?.id, session?.gameId]);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, themePreference); } catch { /* apply without persistence */ }
    applyTheme(themePreference);

    if (themePreference !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme("system");
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [themePreference]);

  const beginDiscordSignIn = async (pendingGame = null) => {
    setAccountError("");
    try {
      const { signInWithDiscord } = await loadAccount();
      await signInWithDiscord({ pendingGame });
    } catch (error) {
      setAccountError(String(error?.message || "Discord sign-in could not start."));
    }
  };

  const signOut = async () => {
    setAccountError("");
    try {
      const { signOutAccount } = await loadAccount();
      await signOutAccount();
    } catch (error) {
      setAccountError(String(error?.message || "Could not sign out."));
    }
  };

  const saveDevices = async (values) => {
    try {
      const { saveEntryDevices } = await loadAccount();
      const nextAccount = await saveEntryDevices(account, values);
      setAccount(nextAccount);
    } catch (error) {
      setAccountError(String(error?.message || "Could not save your device preferences."));
    }
  };

  const leaveGame = () => {
    window.history.replaceState({}, "", "/");
    leaveSession();
    setAccountPromptDismissed(false);
  };

  if (!session) {
    return (
      <>
        <Lobby
          onStart={(nextSession) => {
            setAccountPromptDismissed(false);
            startSession({
              ...nextSession,
              profileId: account?.user?.id || null,
              savedCommanderDecks,
            });
          }}
          account={account}
          accountReady={accountReady}
          accountError={accountError}
          onSignIn={() => beginDiscordSignIn()}
          onSignOut={signOut}
          onSaveEntryPreferences={saveDevices}
          notificationCount={unreadNotifications}
        />
      </>
    );
  }

  return (
    <>
      <Suspense fallback={<div className="lobby"><p>Preparing game…</p></div>}>
        <Game
          session={session}
          account={account}
          onLeave={leaveGame}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
        />
      </Suspense>
      {accountReady && !account && !accountPromptDismissed && (
        <AccountPrompt
          error={accountError}
          onContinue={() => beginDiscordSignIn(session)}
          onDismiss={() => setAccountPromptDismissed(true)}
        />
      )}
    </>
  );
}
