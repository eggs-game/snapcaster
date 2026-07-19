import React, { useEffect, useRef, useState, useCallback } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { GameConnection, captureLocalFrame, clickToNormalized } from "./webrtc.js";
import { identify as identifyCard, preload as preloadRecognition } from "./recognition/matcher.js";
import CardSidebar from "./CardSidebar.jsx";

export default function Game({ session, onLeave }) {
  const connRef = useRef(null);
  const [myId, setMyId] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lives, setLives] = useState({}); // id -> life
  const [commanders, setCommanders] = useState({}); // id -> card name
  const [streams, setStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    // Spin up the recognition worker now so OpenCV compiles in the background
    // (off the main thread) while the player sets up their camera and cards.
    preloadRecognition();
    const conn = new GameConnection({
      onRoster: setRoster,
      onRemoteStream: (id, stream) => setStreams((s) => ({ ...s, [id]: stream })),
      onPeerLeft: (id) => setStreams((s) => { const c = { ...s }; delete c[id]; return c; }),
      onLife: (id, life) => setLives((l) => ({ ...l, [id]: life })),
      onCommander: (id, commander) => setCommanders((values) => ({ ...values, [id]: commander })),
      onCardIdentified: (msg) => setLookups((l) => [...l.slice(-11), { by: msg.byName, card: msg.card, at: Date.now() }]),
      onError: setError,
    });
    connRef.current = conn;
    (async () => {
      try {
        const stream = await conn.initMedia();
        setLocalStream(stream);
        const id = await conn.join(session.code, session.name);
        setMyId(id);
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
    return () => conn.close();
  }, []);

  const identify = useCallback(async (tileId, videoEl, clientX, clientY) => {
    const conn = connRef.current;
    const pt = clickToNormalized(videoEl, clientX, clientY);
    if (!pt) return;
    const rect = videoEl.getBoundingClientRect();
    setFlash({ tileId, x: clientX - rect.left, y: clientY - rect.top });
    setTimeout(() => setFlash(null), 600);
    setCurrent({ loading: true });
    try {
      // Captures are native-resolution crops centered on the clicked point
      // (both local and remote), so the click is always at the crop center.
      const image = tileId === myId
        ? await captureLocalFrame(conn.localStream, pt.nx, pt.ny)
        : await conn.requestRemoteCapture(tileId, pt.nx, pt.ny);
      const data = await identifyCard(image, { nx: 0.5, ny: 0.5 });
      setCurrent({
        matches: data.matches || [],
        cardFound: data.card_found,
        cvStatus: data.cv_status,
        candidatesTried: data.candidates_tried,
        ocrText: data.ocr_text,
        ocrConfidence: data.ocr_confidence,
        ocrRotation: data.ocr_rotation,
        ocrImage: data.ocr_image,
        artBest: data.art_best,
        artChecked: data.art_checked,
        titleScore: data.title_score,
        ocrError: data.ocr_error,
      });
      const top = data.matches?.[0];
      if (top && (top.identified_by === "ocr-title" || top.distance <= 170)) {
        conn.announceCard(top, session.name);
        setLookups((l) => [...l.slice(-11), { by: session.name, card: top, at: Date.now() }]);
      }
    } catch (e) {
      setCurrent({ error: String(e.message || e) });
    }
  }, [myId, session.name]);

  const changeLife = (delta) => {
    const life = (lives[myId] ?? 40) + delta;
    setLives((l) => ({ ...l, [myId]: life }));
    connRef.current.setLife(life);
  };

  const chooseCommander = (commander) => {
    setCommanders((values) => ({ ...values, [myId]: commander }));
    connRef.current?.setCommander(commander);
  };

  const toggleMic = () => { connRef.current.toggleTrack("audio", !micOn); setMicOn(!micOn); };
  const toggleCam = () => { connRef.current.toggleTrack("video", !camOn); setCamOn(!camOn); };

  if (error) {
    return (
      <div className="lobby">
        <h2>Something went wrong</h2>
        <p className="error">{error}</p>
        <button onClick={onLeave}>Back to lobby</button>
      </div>
    );
  }

  const tiles = roster.map((p) => ({
    ...p,
    life: lives[p.id] ?? 40,
    commander: commanders[p.id] || "",
    stream: p.id === myId ? localStream : streams[p.id],
    isMe: p.id === myId,
  }));
  while (tiles.length < 4) tiles.push({ id: `empty-${tiles.length}`, empty: true });

  return (
    <div className="game">
      <header className="topbar">
        <span className="logo">Snapcaster</span>
        <button
          className="drawer-toggle"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? "Close card lookup" : "Open card lookup"}
          title={sidebarOpen ? "Close card lookup" : "Open card lookup"}
        >
          {sidebarOpen ? <PanelRightClose size={22} /> : <PanelRightOpen size={22} />}
        </button>
      </header>
      <div className="main">
        <div className="grid">
          {tiles.map((t, i) => (
            <VideoTile
              key={t.id}
              tile={t}
              color={TILE_COLORS[i % TILE_COLORS.length]}
              innerSide={i % 2 === 0 ? "right" : "left"}
              flash={flash?.tileId === t.id ? flash : null}
              onIdentify={identify}
              onChooseCommander={chooseCommander}
            />
          ))}
        </div>
        {sidebarOpen && (
          <CardSidebar current={current} lookups={lookups} onPick={(m) => setCurrent({ matches: [m] })} />
        )}
      </div>
      <footer className="hint">Click any card on any video to identify it. Share code <b>{session.code}</b> with friends.</footer>
    </div>
  );
}

// One accent color per seat: yellow, blue, green, red.
const TILE_COLORS = ["#d4a94e", "#5b9bd5", "#7bc47f", "#c0504d"];

function VideoTile({ tile, color, innerSide, onIdentify, onChooseCommander, flash }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && tile.stream) videoRef.current.srcObject = tile.stream;
  }, [tile.stream]);

  if (tile.empty) {
    return (
      <div className="tile empty" style={{ borderColor: color }}>
        <span>Waiting for player…</span>
      </div>
    );
  }

  return (
    <div className="tile" style={{ borderColor: color }}>
      <CommanderBanner tile={tile} onChoose={onChooseCommander} />
      <div
        className="video-wrap"
        onClick={(e) => videoRef.current && onIdentify(tile.id, videoRef.current, e.clientX, e.clientY)}
      >
        <video ref={videoRef} autoPlay playsInline muted={tile.isMe} />
        {flash && <div className="click-flash" style={{ left: flash.x, top: flash.y }} />}
        <div
          className="life-badge"
          style={{
            background: color,
            [innerSide]: 0,
            // Flush against the corner: only round the corner facing the video.
            borderRadius: innerSide === "right" ? "12px 0 0 0" : "0 12px 0 0",
          }}
        >
          {tile.life}
        </div>
        {/* Keep the name on the outer edge, away from the life badge. */}
        <div className="tile-bar" style={{ justifyContent: innerSide === "right" ? "flex-start" : "flex-end" }}>
          <span className="pname">{tile.name}{tile.isMe ? " (you)" : ""}</span>
        </div>
      </div>
    </div>
  );
}

function CommanderBanner({ tile, onChoose }) {
  const [draft, setDraft] = useState(tile.commander);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => setDraft(tile.commander), [tile.commander]);
  useEffect(() => {
    const query = draft.trim();
    if (query.length < 2 || query === tile.commander) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (response.ok) setSuggestions((await response.json()).data || []);
      } catch (error) {
        if (error.name !== "AbortError") setSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, tile.commander]);

  if (!tile.isMe) {
    return (
      <div className="commander-banner">
        <span className={tile.commander ? "commander-name" : "commander-name unset"}>
          {tile.commander || "Not selected"}
        </span>
      </div>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    const commander = draft.trim();
    if (commander) onChoose(commander);
  };
  return (
    <form className="commander-banner commander-picker" onSubmit={submit}>
      <input
        id={`commander-${tile.id}`}
        list={`commander-options-${tile.id}`}
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          if (suggestions.includes(value)) onChoose(value);
        }}
        placeholder="Add commander"
        aria-label="Add commander"
        autoComplete="off"
      />
      <datalist id={`commander-options-${tile.id}`}>
        {suggestions.map((name) => <option value={name} key={name} />)}
      </datalist>
    </form>
  );
}
