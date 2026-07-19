import React, { useEffect, useState } from "react";
import { isConfigured, makeCode } from "./signaling.js";
import { loadIndex } from "./recognition/matcher.js";

export default function Lobby({ onStart }) {
  const visitorMode = new URLSearchParams(window.location.search).get("visitor") === "1";
  const [name, setName] = useState(localStorage.getItem("sc-name") || "");
  const [code, setCode] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code") || "";
    return fromUrl.toUpperCase().slice(0, 4);
  });
  const [lobbyName, setLobbyName] = useState("");
  const [indexStatus, setIndexStatus] = useState("loading");
  const [indexCount, setIndexCount] = useState(0);

  useEffect(() => {
    // Load only the lightweight card index here. OpenCV (~10 MB WASM) is loaded
    // lazily on the first in-game card identification so it never freezes the
    // lobby's main thread while the player is typing their name.
    loadIndex()
      .then((n) => { setIndexCount(n); setIndexStatus("ok"); })
      .catch(() => setIndexStatus("missing"));
  }, []);

  const go = (roomCode, role = visitorMode ? "visitor" : "player", createdLobbyName = "") => {
    if (!name.trim()) return alert("Enter your name first");
    localStorage.setItem("sc-name", name.trim());
    onStart({
      name: name.trim(),
      code: roomCode,
      role,
      lobbyName: createdLobbyName.trim().slice(0, 48),
    });
  };

  return (
    <div className="lobby">
      <h1>Snapcaster</h1>
      <p className="tagline">Remote paper Magic with card recognition that actually works.</p>
      {visitorMode && (
        <div className="banner visitor-welcome">
          Join as a visitor — voice only, with access to card lookups. You won't occupy a player seat.
        </div>
      )}

      {!isConfigured() && (
        <div className="banner error">
          Multiplayer isn't configured yet: add <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> in your Vercel project settings, then redeploy.
        </div>
      )}
      {indexStatus === "missing" && (
        <div className="banner warn">
          Card index not found. Run the <b>Build card index</b> action in your GitHub repo
          (Actions tab), wait for it to finish, then redeploy on Vercel.
        </div>
      )}
      {indexStatus === "ok" && (
        <div className="banner ok">{indexCount.toLocaleString()} card printings loaded — recognition ready.</div>
      )}

      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
      {!visitorMode && (
        <input
          placeholder="Lobby name (optional)"
          value={lobbyName}
          onChange={(e) => setLobbyName(e.target.value)}
          maxLength={48}
        />
      )}
      <div className="lobby-actions">
        {!visitorMode && (
          <button
            className="primary"
            disabled={!isConfigured()}
            onClick={() => go(makeCode(), "player", lobbyName || "Untitled game")}
          >
            Create game
          </button>
        )}
        <div className="join-row">
          <input placeholder="CODE" value={code} maxLength={4}
                 onChange={(e) => setCode(e.target.value.toUpperCase())}
                 onKeyDown={(e) => e.key === "Enter" && code.length === 4 && go(code)} />
          <button disabled={code.length !== 4 || !isConfigured()} onClick={() => go(code)}>
            {visitorMode ? "Join as visitor" : "Join"}
          </button>
        </div>
      </div>
      <p className="hint">
        {visitorMode
          ? "You'll be asked for microphone access only."
          : "Up to 4 players. You'll need a webcam pointed at your playmat."}
      </p>
    </div>
  );
}
