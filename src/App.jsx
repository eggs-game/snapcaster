import React, { useEffect, useState } from "react";
import Lobby from "./Lobby.jsx";
import Game from "./Game.jsx";

const THEME_KEY = "theme-preference";
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

export default function App() {
  const [session, setSession] = useState(null); // {code, name, role}
  const [themePreference, setThemePreference] = useState(initialThemePreference);

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
    ? <Game
        session={session}
        onLeave={() => setSession(null)}
        themePreference={themePreference}
        onThemePreferenceChange={setThemePreference}
      />
    : <Lobby onStart={setSession} />;
}
