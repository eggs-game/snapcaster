import React, { lazy, Suspense, useEffect, useState } from "react";
import Lobby from "./Lobby.jsx";

const Game = lazy(() => import("./Game.jsx"));

const THEME_KEY = "theme-preference";
const ACTIVE_SESSION_KEY = "snapcast-active-room";
const THEME_OPTIONS = new Set(["light", "dark", "system"]);

function initialThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  return THEME_OPTIONS.has(saved) ? saved : "dark";
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
    localStorage.setItem(THEME_KEY, themePreference);
    applyTheme(themePreference);

    if (themePreference !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme("system");
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [themePreference]);

  return session
    ? (
      <Suspense fallback={<div className="lobby"><p>Preparing game…</p></div>}>
        <Game
          session={session}
          onLeave={leaveSession}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
        />
      </Suspense>
    )
    : <Lobby onStart={startSession} />;
}
