import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Check, FlipVertical2, Link2, Mic, MicOff, MoreVertical, UserRound,
  PanelLeftClose, PanelLeftOpen, PanelRightOpen, Video, VideoOff, X,
} from "lucide-react";
import { GameConnection, captureLocalFrame, clickToNormalized } from "./webrtc.js";
import { identify as identifyCard, preload as preloadRecognition } from "./recognition/matcher.js";
import CardSidebar from "./CardSidebar.jsx";

export default function Game({ session, onLeave }) {
  const isVisitor = session.role === "visitor";
  const connRef = useRef(null);
  const [myId, setMyId] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lives, setLives] = useState({}); // id -> life
  const [commanders, setCommanders] = useState({}); // id -> card name
  const [colors, setColors] = useState({}); // id -> hex color
  const [mutedPlayers, setMutedPlayers] = useState({}); // id -> bool
  const [streams, setStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [controlsClosing, setControlsClosing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [visitorLinkCopied, setVisitorLinkCopied] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [deviceError, setDeviceError] = useState("");

  // Play the slide-out animation before unmounting the drawer.
  const closeControls = useCallback(() => {
    setControlsClosing(true);
    setTimeout(() => {
      setControlsOpen(false);
      setControlsClosing(false);
    }, 200);
  }, []);

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
      onColor: (id, color) => setColors((values) => ({ ...values, [id]: color })),
      onMuted: (id, muted) => setMutedPlayers((values) => ({ ...values, [id]: muted })),
      onCardIdentified: (msg) => setLookups((l) => [...l.slice(-11), { by: msg.byName, card: msg.card, at: Date.now() }]),
      onError: setError,
    });
    connRef.current = conn;
    (async () => {
      try {
        const stream = await conn.initMedia({ audioOnly: isVisitor });
        setLocalStream(stream);
        setVideoDeviceId(conn.videoDeviceId);
        setAudioDeviceId(conn.audioDeviceId);
        const devices = await conn.listDevices();
        if (!isVisitor) setCameras(devices.cameras);
        setMics(devices.mics);
        const id = await conn.join(session.code, session.name, isVisitor ? "visitor" : "player");
        setMyId(id);
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
    const onDeviceChange = async () => {
      try {
        const devices = await conn.listDevices();
        if (!isVisitor) setCameras(devices.cameras);
        setMics(devices.mics);
      } catch { /* ignore */ }
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      conn.close();
    };
  }, [isVisitor, session.code, session.name]);

  // captureClientY lets flipped tiles pass the reflected point for capture
  // while the click flash stays where the player actually clicked.
  const identify = useCallback(async (tileId, videoEl, clientX, clientY, captureClientY = clientY) => {
    const conn = connRef.current;
    const pt = clickToNormalized(videoEl, clientX, captureClientY);
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
        if (!isVisitor) conn.announceCard(top, session.name);
        setLookups((l) => [...l.slice(-11), { by: session.name, card: top, at: Date.now() }]);
      }
    } catch (e) {
      setCurrent({ error: String(e.message || e) });
    }
  }, [isVisitor, myId, session.name]);

  const changeLife = (delta) => {
    if (isVisitor) return;
    const life = (lives[myId] ?? 40) + delta;
    setLives((l) => ({ ...l, [myId]: life }));
    connRef.current.setLife(life);
  };

  const chooseCommander = (commander) => {
    if (isVisitor) return;
    setCommanders((values) => ({ ...values, [myId]: commander }));
    connRef.current?.setCommander(commander);
  };

  const chooseColor = (color) => {
    if (isVisitor) return;
    setColors((values) => ({ ...values, [myId]: color }));
    connRef.current?.setColor(color);
  };

  const toggleMic = () => {
    const next = !micOn;
    connRef.current.toggleTrack("audio", next);
    setMicOn(next);
    setMutedPlayers((values) => ({ ...values, [myId]: !next }));
    connRef.current?.setMuted(!next);
  };
  const toggleCam = () => {
    if (isVisitor) return;
    connRef.current.toggleTrack("video", !camOn);
    setCamOn(!camOn);
  };

  const chooseCamera = async (deviceId) => {
    if (!deviceId || deviceId === videoDeviceId) return;
    setDeviceError("");
    try {
      await connRef.current.switchDevice("video", deviceId);
      setVideoDeviceId(deviceId);
      // Nudge React so the local <video> rebinds if the stream identity changed.
      setLocalStream(connRef.current.localStream);
    } catch (e) {
      setDeviceError(String(e.message || e));
    }
  };

  const chooseMic = async (deviceId) => {
    if (!deviceId || deviceId === audioDeviceId) return;
    setDeviceError("");
    try {
      await connRef.current.switchDevice("audio", deviceId);
      setAudioDeviceId(deviceId);
    } catch (e) {
      setDeviceError(String(e.message || e));
    }
  };

  const copyJoinLink = async (visitor = false) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("code", session.code);
    if (visitor) url.searchParams.set("visitor", "1");
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      const input = document.createElement("input");
      input.value = url.toString();
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    const setter = visitor ? setVisitorLinkCopied : setLinkCopied;
    setter(true);
    setTimeout(() => setter(false), 1600);
  };

  if (error) {
    return (
      <div className="lobby">
        <h2>Something went wrong</h2>
        <p className="error">{error}</p>
        <button onClick={onLeave}>Back to lobby</button>
      </div>
    );
  }

  const players = roster.filter((p) => p.role !== "visitor").slice(0, 4);
  const visitors = roster.filter((p) => p.role === "visitor");
  const tiles = players.map((p, i) => ({
    ...p,
    life: lives[p.id] ?? 40,
    commander: commanders[p.id] || "",
    color: colors[p.id] || TILE_COLORS[i % TILE_COLORS.length],
    muted: !!mutedPlayers[p.id],
    stream: p.id === myId ? localStream : streams[p.id],
    isMe: p.id === myId,
  }));
  while (tiles.length < 4) tiles.push({ id: `empty-${tiles.length}`, empty: true });
  const myColor = colors[myId] || TILE_COLORS[Math.max(0, players.findIndex((p) => p.id === myId))] || TILE_COLORS[0];

  return (
    <div className="game">
      {controlsOpen && (
        <div
          className={controlsClosing ? "controls-overlay closing" : "controls-overlay"}
          onClick={closeControls}
        >
          <aside className="controls-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="logo">Snapcaster</span>
              <button className="drawer-toggle" onClick={closeControls} aria-label="Close controls" title="Close controls">
                <X size={20} />
              </button>
            </div>
            {isVisitor && <p className="visitor-note">You joined as a visitor. You can listen, speak, and look up cards.</p>}
            {!isVisitor && <>
              <h3 className="drawer-section">Video</h3>
              <button
                className={camOn ? "control-row" : "control-row off"}
                onClick={toggleCam}
              >
                {camOn ? <Video size={20} /> : <VideoOff size={20} />}
                <span>{camOn ? "Camera on" : "Camera off"}</span>
              </button>
              <label className="device-field">
                <span className="color-label">Camera</span>
                <select
                  value={videoDeviceId}
                  onChange={(e) => chooseCamera(e.target.value)}
                  disabled={!cameras.length}
                >
                  {!cameras.length && <option value="">No cameras found</option>}
                  {cameras.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </>}

            <h3 className="drawer-section">Microphone</h3>
            <button
              className={micOn ? "control-row" : "control-row off"}
              onClick={toggleMic}
            >
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
              <span>{micOn ? "Mic on" : "Mic muted"}</span>
            </button>
            <label className="device-field">
              <span className="color-label">Microphone</span>
              <select
                value={audioDeviceId}
                onChange={(e) => chooseMic(e.target.value)}
                disabled={!mics.length}
              >
                {!mics.length && <option value="">No microphones found</option>}
                {mics.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {deviceError && <p className="device-error">{deviceError}</p>}

            {!isVisitor && <div className="color-picker">
              <span className="color-label">Your color</span>
              <div className="color-swatches">
                {TILE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={myColor === color ? "color-swatch selected" : "color-swatch"}
                    style={{ background: color }}
                    aria-label={`Choose color ${color}`}
                    title="Choose seat color"
                    onClick={() => chooseColor(color)}
                  />
                ))}
              </div>
            </div>}
          </aside>
        </div>
      )}

      {visitors
        .filter((visitor) => visitor.id !== myId && streams[visitor.id])
        .map((visitor) => (
          <RemoteAudio key={visitor.id} stream={streams[visitor.id]} />
        ))}

      <div className="main">
        <div className="video-panel">
          <div className="panel-topbar">
            <button
              className="drawer-toggle"
              onClick={() => (controlsOpen ? closeControls() : setControlsOpen(true))}
              aria-label={controlsOpen ? "Close controls" : "Open controls"}
              title={controlsOpen ? "Close controls" : "Open controls"}
            >
              {controlsOpen ? <PanelLeftClose size={22} /> : <PanelLeftOpen size={22} />}
            </button>
            <span className="logo game-code" title="Lobby code">{session.code}</span>
            {!isVisitor && <button
              className={linkCopied ? "copy-link copied" : "copy-link"}
              onClick={() => copyJoinLink(false)}
              aria-label="Copy game link"
              title={linkCopied ? "Link copied" : "Copy game link"}
            >
              {linkCopied ? <Check size={16} /> : <Link2 size={16} />}
              <span>{linkCopied ? "Copied" : "Copy link"}</span>
            </button>}
            {!isVisitor && <button
              className={visitorLinkCopied ? "copy-link copied" : "copy-link"}
              onClick={() => copyJoinLink(true)}
              aria-label="Copy visitor link"
              title={visitorLinkCopied ? "Visitor link copied" : "Copy visitor link"}
            >
              {visitorLinkCopied ? <Check size={16} /> : <UserRound size={16} />}
              <span>{visitorLinkCopied ? "Copied" : "Visitor link"}</span>
            </button>}
            <div className="panel-topbar-right">
              <div className="visitor-strip" aria-label={`${visitors.length} visitors`}>
                {visitors.map((visitor) => (
                  <div
                    key={visitor.id}
                    className="visitor-avatar"
                    title={`${visitor.name}${mutedPlayers[visitor.id] ? " (muted)" : ""}`}
                  >
                    {visitor.name.trim().charAt(0).toUpperCase() || "V"}
                    {mutedPlayers[visitor.id] && <MicOff size={9} className="visitor-muted" />}
                  </div>
                ))}
              </div>
              {!sidebarOpen && (
                <button
                  className="drawer-toggle"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open card lookup"
                  title="Open card lookup"
                >
                  <PanelRightOpen size={22} />
                </button>
              )}
            </div>
          </div>
          <div className="grid">
            {tiles.map((t, i) => (
              <VideoTile
                key={t.id}
                tile={t}
                color={t.color || TILE_COLORS[i % TILE_COLORS.length]}
                innerSide={i % 2 === 0 ? "right" : "left"}
                flash={flash?.tileId === t.id ? flash : null}
                onIdentify={identify}
                onChooseCommander={chooseCommander}
                onChangeLife={changeLife}
              />
            ))}
          </div>
        </div>
        {sidebarOpen && (
          <CardSidebar
            current={current}
            lookups={lookups}
            onPick={(m) => setCurrent({ matches: [m] })}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {
        // Browsers normally allow this after the explicit Join click. If one
        // blocks autoplay, the element will retry when the stream updates.
      });
    }
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

// Seat accent palette: yellow, blue, green, red.
const TILE_COLORS = ["#d4a94e", "#5b9bd5", "#7bc47f", "#c0504d"];

function VideoTile({ tile, color, innerSide, onIdentify, onChooseCommander, onChangeLife, flash }) {
  const videoRef = useRef(null);
  const [flipped, setFlipped] = useState(false);
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
      <CommanderBanner
        tile={tile}
        onChoose={onChooseCommander}
        flipped={flipped}
        onToggleFlip={() => setFlipped((f) => !f)}
      />
      <div
        className="video-wrap"
        onClick={(e) => {
          if (!videoRef.current) return;
          // A flipped video shows the source upside down; reflect the click so
          // recognition still targets the card the player actually clicked.
          let captureY = e.clientY;
          if (flipped) {
            const rect = videoRef.current.getBoundingClientRect();
            captureY = rect.top + rect.bottom - e.clientY;
          }
          onIdentify(tile.id, videoRef.current, e.clientX, e.clientY, captureY);
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.isMe}
          style={flipped ? { transform: "scaleY(-1)" } : undefined}
        />
        {flash && <div className="click-flash" style={{ left: flash.x, top: flash.y }} />}
        <div
          className={tile.isMe ? "life-badge mine" : "life-badge"}
          style={{
            background: color,
            [innerSide]: 0,
            // Flush against the corner: only round the corner facing the video.
            borderRadius: innerSide === "right" ? "12px 0 0 0" : "0 12px 0 0",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {tile.isMe && (
            <button className="life-btn" onClick={() => onChangeLife(-1)} aria-label="Lose 1 life">−</button>
          )}
          <span className="life-value">{tile.life}</span>
          {tile.isMe && (
            <button className="life-btn" onClick={() => onChangeLife(+1)} aria-label="Gain 1 life">+</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Simplified, flat mana symbols: classic pip colors with minimal glyphs.
const MANA_INK = "#171114";
const MANA_BG = {
  W: "#f6f2dc", U: "#bcd7ea", B: "#c6bcb6", R: "#e8997c", G: "#a9c9a4", C: "#cdc4be",
};

function ManaGlyph({ sym }) {
  switch (sym) {
    case "W": // sun
      return (
        <g stroke={MANA_INK} strokeWidth="1.3" strokeLinecap="round">
          <circle cx="8" cy="8" r="2.4" fill={MANA_INK} stroke="none" />
          <path d="M8 2.6v2M8 11.4v2M2.6 8h2M11.4 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M11.8 4.2l-1.4 1.4M5.6 10.4l-1.4 1.4" />
        </g>
      );
    case "U": // water drop
      return (
        <path
          fill={MANA_INK}
          d="M8 2.8c-2 2.9-3.1 4.6-3.1 6.3a3.1 3.1 0 0 0 6.2 0c0-1.7-1.1-3.4-3.1-6.3Z"
        />
      );
    case "B": // skull
      return (
        <g>
          <path
            fill={MANA_INK}
            d="M8 3a3.9 3.9 0 0 1 3.9 3.9c0 1.5-.8 2.5-1.7 3.1v2.6H5.8V10c-.9-.6-1.7-1.6-1.7-3.1A3.9 3.9 0 0 1 8 3Z"
          />
          <circle cx="6.6" cy="6.9" r="1" fill={MANA_BG.B} />
          <circle cx="9.4" cy="6.9" r="1" fill={MANA_BG.B} />
        </g>
      );
    case "R": // flame
      return (
        <path
          fill={MANA_INK}
          d="M8.2 2.8c.3 1.6 1.2 2.7 2.1 3.8.7.9 1.1 1.7 1.1 2.7a3.4 3.4 0 0 1-6.8 0c0-1.3.7-2.2 1.3-3.1.3.6.7 1 1.2 1.2-.4-1.6-.1-3.1 1.1-4.6Z"
        />
      );
    case "G": // tree
      return (
        <g fill={MANA_INK}>
          <path d="M8 2.8 11.6 9H4.4L8 2.8Z" />
          <rect x="7.2" y="8.6" width="1.6" height="4" rx="0.4" />
        </g>
      );
    default: // generic cost or unusual pip: show the label
      return (
        <text x="8" y="11.3" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={MANA_INK}>
          {sym.replace("/", "")}
        </text>
      );
  }
}

function ManaCost({ cost }) {
  if (!cost) return null;
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return (
    <span className="mana-cost">
      {symbols.map((sym, i) => (
        <svg
          key={`${sym}-${i}`}
          className="mana-symbol"
          viewBox="0 0 16 16"
          role="img"
          aria-label={`{${sym}}`}
        >
          <circle cx="8" cy="8" r="8" fill={MANA_BG[sym] || MANA_BG.C} />
          <ManaGlyph sym={sym} />
        </svg>
      ))}
    </span>
  );
}

// Right edge of the banner: three-dot video-options menu stacked above the
// commander's mana symbols.
function BannerRight({ cost, flipped, onToggleFlip }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="banner-right" onClick={(e) => e.stopPropagation()}>
      <button
        className="menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Video options"
        title="Video options"
      >
        <MoreVertical size={15} />
      </button>
      <ManaCost cost={cost} />
      {open && (
        <div className="tile-menu">
          <button
            type="button"
            onClick={() => {
              onToggleFlip();
              setOpen(false);
            }}
          >
            <FlipVertical2 size={15} />
            <span>{flipped ? "Unflip video" : "Flip video"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function CommanderBanner({ tile, onChoose, flipped, onToggleFlip }) {
  const [draft, setDraft] = useState(tile.commander);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [editing, setEditing] = useState(false);
  const [manaCost, setManaCost] = useState("");

  useEffect(() => setDraft(tile.commander), [tile.commander]);

  // Look up the commander's mana cost for the banner display.
  useEffect(() => {
    setManaCost("");
    const name = tile.commander?.trim();
    if (!name) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const card = await response.json();
        setManaCost(card.mana_cost || card.card_faces?.[0]?.mana_cost || "");
      } catch {
        /* banner just shows the name without symbols */
      }
    })();
    return () => controller.abort();
  }, [tile.commander]);

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
        if (response.ok) {
          setSuggestions((await response.json()).data || []);
          setHighlight(-1);
        }
      } catch (error) {
        if (error.name !== "AbortError") setSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, tile.commander]);

  const playerLabel = `${tile.name}${tile.isMe ? " (you)" : ""}`;
  const playerRow = (
    <span className="banner-player-row">
      {tile.muted && <MicOff size={12} className="banner-muted" aria-label="Muted" />}
      <span className="banner-player">{playerLabel}</span>
    </span>
  );

  if (!tile.isMe) {
    return (
      <div className="commander-banner">
        <div className="banner-stack">
          {playerRow}
          <span className={tile.commander ? "commander-name" : "commander-name unset"}>
            {tile.commander || "Not selected"}
          </span>
        </div>
        <BannerRight cost={manaCost} flipped={flipped} onToggleFlip={onToggleFlip} />
      </div>
    );
  }

  // Overlay text state (click to add or change). The input only appears
  // while actively editing.
  if (!editing) {
    return (
      <div
        className="commander-banner commander-set"
        onClick={() => setEditing(true)}
        title={tile.commander ? "Click to change commander" : "Click to add commander"}
      >
        <div className="banner-stack">
          {playerRow}
          <span className={tile.commander ? "commander-name" : "commander-name unset"}>
            {tile.commander || "Add commander"}
          </span>
        </div>
        <BannerRight cost={manaCost} flipped={flipped} onToggleFlip={onToggleFlip} />
      </div>
    );
  }

  const choose = (commander) => {
    setSuggestions([]);
    onChoose(commander);
    setEditing(false);
  };
  const submit = (event) => {
    event.preventDefault();
    const commander = (highlight >= 0 ? suggestions[highlight] : draft).trim();
    if (commander) choose(commander);
  };
  return (
    <form className="commander-banner commander-picker" onSubmit={submit}>
      <div className="commander-search">
        <input
          id={`commander-${tile.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (suggestions.length) setSuggestions([]);
              else setEditing(false);
              return;
            }
            if (!suggestions.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((i) => (i + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            }
          }}
          onBlur={() => setEditing(false)}
          placeholder="Add commander"
          aria-label="Add commander"
          autoComplete="off"
          autoFocus
        />
        {suggestions.length > 0 && (
          <ul className="commander-suggest">
            {suggestions.map((name, i) => (
              <li
                key={name}
                className={i === highlight ? "active" : ""}
                onMouseEnter={() => setHighlight(i)}
                // mousedown so the pick lands before the input loses focus
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(name);
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <BannerRight cost="" flipped={flipped} onToggleFlip={onToggleFlip} />
    </form>
  );
}
