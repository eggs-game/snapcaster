import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Check, Droplet, Flame, FlipVertical2, Link2, MicOff, MoreVertical,
  PanelLeft, Plus, Skull, Sun, TreeDeciduous, UserRound,
} from "lucide-react";
import { GameConnection, captureLocalFrame, clickToNormalized } from "./webrtc.js";
import { suggestCardNames } from "./cardSearch.js";
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
  const [lobbyName, setLobbyName] = useState(() => session.lobbyName || "");
  const [editingLobbyName, setEditingLobbyName] = useState(false);
  const [lobbyNameDraft, setLobbyNameDraft] = useState(() => session.lobbyName || "");
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [sidebarView, setSidebarView] = useState("lookup"); // "lookup" | "settings"
  const [linkCopied, setLinkCopied] = useState(false);
  const [visitorLinkCopied, setVisitorLinkCopied] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [deviceError, setDeviceError] = useState("");

  useEffect(() => {
    // Spin up the recognition worker now so OpenCV compiles in the background
    // (off the main thread) while the player sets up their camera and cards.
    preloadRecognition();
    const conn = new GameConnection({
      onRoster: setRoster,
      onRemoteStream: (id, stream) => setStreams((s) => ({ ...s, [id]: stream })),
      onPeerLeft: (id) => setStreams((s) => { const c = { ...s }; delete c[id]; return c; }),
      onLife: (id, life) => setLives((l) => ({ ...l, [id]: life })),
      onLobbyName: (name) => {
        setLobbyName(name);
        setLobbyNameDraft(name);
      },
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
        if (!isVisitor && session.lobbyName) {
          conn.setLobbyName(session.lobbyName);
          setLobbyName(session.lobbyName);
          setLobbyNameDraft(session.lobbyName);
        }
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
        captureImage: image,
        cameraRes: (() => {
          const s = conn.localStream?.getVideoTracks?.()[0]?.getSettings?.();
          return s?.width ? `${s.width}×${s.height}` : "";
        })(),
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

  const chooseLobbyName = (next) => {
    if (isVisitor) return;
    const name = next.trim().slice(0, 48);
    if (!name) return;
    setLobbyName(name);
    setLobbyNameDraft(name);
    setEditingLobbyName(false);
    connRef.current?.setLobbyName(name);
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
      {visitors
        .filter((visitor) => visitor.id !== myId && streams[visitor.id])
        .map((visitor) => (
          <RemoteAudio key={visitor.id} stream={streams[visitor.id]} />
        ))}

      <div className="main">
        {sidebarOpen && (
          <CardSidebar
            current={current}
            lookups={lookups}
            onPick={(m) => setCurrent({ matches: [m] })}
            onSearch={(cardOrError) => {
              if (cardOrError.error) {
                setCurrent({ error: cardOrError.error });
                return;
              }
              setCurrent({ matches: [cardOrError] });
              setLookups((l) => [...l.slice(-11), { by: session.name, card: cardOrError, at: Date.now() }]);
            }}
            onClose={() => setSidebarClosing(true)}
            closing={sidebarClosing}
            onClosed={() => {
              setSidebarClosing(false);
              setSidebarOpen(false);
              setSidebarView("lookup");
            }}
            view={sidebarView}
            onViewChange={setSidebarView}
            isVisitor={isVisitor}
            camOn={camOn}
            micOn={micOn}
            cameras={cameras}
            mics={mics}
            videoDeviceId={videoDeviceId}
            audioDeviceId={audioDeviceId}
            deviceError={deviceError}
            myColor={myColor}
            tileColors={TILE_COLORS}
            onToggleCam={toggleCam}
            onToggleMic={toggleMic}
            onChooseCamera={chooseCamera}
            onChooseMic={chooseMic}
            onChooseColor={chooseColor}
          />
        )}
        <div className="video-panel">
          <div className="panel-topbar">
            {/* Always in the layout so the lobby name doesn't jump when the
                sidebar closes and this control reappears. */}
            <button
              className={[
                "drawer-toggle",
                "panel-toggle",
                sidebarOpen && !sidebarClosing ? "panel-toggle-away" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                if (sidebarOpen) return;
                setSidebarView("lookup");
                setSidebarOpen(true);
              }}
              aria-label="Open card lookup"
              title="Open card lookup"
              aria-hidden={sidebarOpen && !sidebarClosing}
              tabIndex={sidebarOpen && !sidebarClosing ? -1 : 0}
            >
              <PanelLeft size={20} />
            </button>
            {editingLobbyName && !isVisitor ? (
              <form
                className="lobby-name-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  chooseLobbyName(lobbyNameDraft);
                }}
              >
                <input
                  value={lobbyNameDraft}
                  onChange={(e) => setLobbyNameDraft(e.target.value)}
                  onBlur={() => chooseLobbyName(lobbyNameDraft || lobbyName || "Untitled game")}
                  maxLength={48}
                  autoFocus
                  aria-label="Lobby name"
                />
              </form>
            ) : (
              <button
                type="button"
                className="logo lobby-name"
                title={isVisitor ? `Lobby code ${session.code}` : `Click to rename · code ${session.code}`}
                onClick={() => {
                  if (isVisitor) return;
                  setLobbyNameDraft(lobbyName || "Untitled game");
                  setEditingLobbyName(true);
                }}
              >
                {lobbyName || "Untitled game"}
              </button>
            )}
            {!isVisitor && <button
              className={linkCopied ? "copy-link copied" : "copy-link"}
              onClick={() => copyJoinLink(false)}
              aria-label="Copy game link"
              title={linkCopied ? "Link copied" : "Copy game link"}
            >
              {linkCopied ? <Check size={20} /> : <Link2 size={20} />}
              <span>{linkCopied ? "Copied" : "Copy link"}</span>
            </button>}
            {!isVisitor && <button
              className={visitorLinkCopied ? "copy-link copied" : "copy-link"}
              onClick={() => copyJoinLink(true)}
              aria-label="Copy visitor link"
              title={visitorLinkCopied ? "Visitor link copied" : "Copy visitor link"}
            >
              {visitorLinkCopied ? <Check size={20} /> : <UserRound size={20} />}
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
            borderRadius: innerSide === "right" ? "10px 0 0 0" : "0 10px 0 0",
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

// Flat mana pips: classic colors with filled Lucide icons.
const MANA_INK = "#171114";
const MANA_BG = {
  W: "#f6f2dc", U: "#bcd7ea", B: "#c6bcb6", R: "#e8997c", G: "#a9c9a4", C: "#cdc4be",
};
const MANA_ICON = { W: Sun, U: Droplet, B: Skull, R: Flame, G: TreeDeciduous };

function ManaCost({ cost }) {
  if (!cost) return null;
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return (
    <span className="mana-cost">
      {symbols.map((sym, i) => {
        const Icon = MANA_ICON[sym];
        return (
          <span
            key={`${sym}-${i}`}
            className="mana-symbol"
            style={{ background: MANA_BG[sym] || MANA_BG.C }}
            role="img"
            aria-label={`{${sym}}`}
          >
            {Icon ? (
              <Icon
                size={10}
                fill={MANA_INK}
                // The skull's eye/nose cutouts only read if stroked in the pip color.
                color={sym === "B" ? MANA_BG.B : MANA_INK}
                strokeWidth={sym === "B" ? 2 : 1.5}
              />
            ) : (
              <span className="mana-num">{sym.replace("/", "")}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

// Three-dot video-options menu on the banner's first row.
function TileMenu({ flipped, onToggleFlip }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="banner-menu" onClick={(e) => e.stopPropagation()}>
      <button
        className="menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Video options"
        title="Video options"
      >
        <MoreVertical size={15} />
      </button>
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
        setSuggestions(await suggestCardNames(query, controller.signal));
        setHighlight(-1);
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

  const nameRow = (
    <div className="banner-row">
      {playerRow}
      <TileMenu flipped={flipped} onToggleFlip={onToggleFlip} />
    </div>
  );

  if (!tile.isMe) {
    return (
      <div className="commander-banner">
        {nameRow}
        <div className="banner-row">
          <span className={tile.commander ? "commander-name" : "commander-name unset"}>
            {tile.commander || "Not selected"}
          </span>
          <ManaCost cost={manaCost} />
        </div>
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
        {nameRow}
        <div className="banner-row">
          <span className={tile.commander ? "commander-name" : "commander-name unset"}>
            {!tile.commander && <Plus size={15} />}
            {tile.commander || "Add commander"}
          </span>
          <ManaCost cost={manaCost} />
        </div>
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
      {nameRow}
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
    </form>
  );
}
