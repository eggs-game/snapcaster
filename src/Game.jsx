import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  FlipVertical2, MicOff, MoreVertical, PanelLeft, SkipForward,
} from "lucide-react";
import { GameConnection, captureLocalFrame, clickToNormalized } from "./webrtc.js";
import { suggestCardNames } from "./cardSearch.js";
import { identify as identifyCard, preload as preloadRecognition } from "./recognition/matcher.js";
import CardSidebar from "./CardSidebar.jsx";

export default function Game({ session, onLeave, themePreference, onThemePreferenceChange }) {
  const isVisitor = session.role === "visitor";
  const connRef = useRef(null);
  const rosterRef = useRef([]);
  const livesRef = useRef({});
  const lifeLogIdRef = useRef(0);
  const chatIdRef = useRef(0);
  const diceLogIdRef = useRef(0);
  const [myId, setMyId] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lives, setLives] = useState({}); // id -> life
  const [commanders, setCommanders] = useState({}); // id -> card name
  const [colors, setColors] = useState({}); // id -> hex color
  const [mutedPlayers, setMutedPlayers] = useState({}); // id -> bool
  const [streams, setStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [lobbyName, setLobbyName] = useState(() => session.lobbyName || "");
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [lifeEvents, setLifeEvents] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [diceRolls, setDiceRolls] = useState([]);
  const [activePlayerId, setActivePlayerId] = useState("");
  const [poisonCounters, setPoisonCounters] = useState({});
  const [commanderDamage, setCommanderDamage] = useState({});
  const [videoLayout, setVideoLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("snapcaster-video-layout");
      return ["tiles", "follow", "hero"].includes(saved) ? saved : "tiles";
    } catch {
      return "tiles";
    }
  });
  const [heroPlayerId, setHeroPlayerId] = useState("");
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [edgeTabY, setEdgeTabY] = useState(null);
  const [sidebarView, setSidebarView] = useState("lookup"); // "lookup" | "settings"
  const [linkCopied, setLinkCopied] = useState(false);
  const [visitorLinkCopied, setVisitorLinkCopied] = useState(false);
  const [gameCodeCopied, setGameCodeCopied] = useState(false);
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
      onRoster: (nextRoster) => {
        rosterRef.current = nextRoster;
        setRoster(nextRoster);
      },
      onRemoteStream: (id, stream) => setStreams((s) => ({ ...s, [id]: stream })),
      onPeerLeft: (id) => setStreams((s) => { const c = { ...s }; delete c[id]; return c; }),
      onLife: (id, life) => {
        const previous = livesRef.current[id];
        livesRef.current = { ...livesRef.current, [id]: life };
        setLives((values) => ({ ...values, [id]: life }));
        // The first value received is state synchronization, not a change.
        if (previous == null || previous === life) return;
        const player = rosterRef.current.find((member) => member.id === id)?.name || "Player";
        setLifeEvents((events) => [...events.slice(-49), {
          id: ++lifeLogIdRef.current,
          player,
          previous,
          life,
          delta: life - previous,
          at: Date.now(),
        }]);
      },
      onLobbyName: setLobbyName,
      onCommander: (id, commander) => setCommanders((values) => ({ ...values, [id]: commander })),
      onColor: (id, color) => setColors((values) => ({ ...values, [id]: color })),
      onMuted: (id, muted) => setMutedPlayers((values) => ({ ...values, [id]: muted })),
      onCardIdentified: (msg) => setLookups((l) => [...l.slice(-11), { by: msg.byName, card: msg.card, at: Date.now() }]),
      onChat: (message) => setChatMessages((messages) => [...messages.slice(-99), {
        ...message,
        id: `remote-${message.from}-${message.at}-${++chatIdRef.current}`,
      }]),
      onActivePlayer: setActivePlayerId,
      onPoison: (id, value) => setPoisonCounters((values) => ({ ...values, [id]: value })),
      onCommanderDamage: (victimId, attackerId, value) => setCommanderDamage((values) => ({
        ...values,
        [victimId]: { ...(values[victimId] || {}), [attackerId]: value },
      })),
      onDiceRoll: (roll) => setDiceRolls((rolls) => [...rolls.slice(-49), {
        ...roll,
        id: `remote-${roll.from}-${roll.at}-${++diceLogIdRef.current}`,
      }]),
      onError: setError,
    });
    connRef.current = conn;
    (async () => {
      try {
        const stream = await conn.initMedia({
          audioOnly: isVisitor,
          videoDeviceId: session.videoDeviceId,
          audioDeviceId: session.audioDeviceId,
        });
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
  }, [isVisitor, session.code, session.name, session.videoDeviceId, session.audioDeviceId]);

  // The first seated player establishes the opening turn. If the active
  // player leaves, the first remaining seat establishes the replacement.
  useEffect(() => {
    if (isVisitor || !myId) return;
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    if (!playerIds.length) return;
    if ((!activePlayerId || !playerIds.includes(activePlayerId)) && playerIds[0] === myId) {
      setActivePlayerId(playerIds[0]);
      connRef.current?.setActivePlayer(playerIds[0]);
    }
  }, [activePlayerId, isVisitor, myId, roster]);

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
        cropsDropped: data.crops_dropped,
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
    const previous = livesRef.current[myId] ?? lives[myId] ?? 40;
    const life = previous + delta;
    livesRef.current = { ...livesRef.current, [myId]: life };
    setLives((l) => ({ ...l, [myId]: life }));
    setLifeEvents((events) => [...events.slice(-49), {
      id: ++lifeLogIdRef.current,
      player: session.name,
      previous,
      life,
      delta,
      at: Date.now(),
    }]);
    connRef.current.setLife(life);
  };

  const sendChat = (value) => {
    const text = String(value || "").trim().slice(0, 500);
    if (!text || !myId) return;
    const at = Date.now();
    setChatMessages((messages) => [...messages.slice(-99), {
      id: `local-${myId}-${at}-${++chatIdRef.current}`,
      from: myId,
      name: session.name,
      text,
      at,
    }]);
    connRef.current?.sendChat(text, at);
  };

  const rollDie = (requestedSides) => {
    if (!myId) return;
    const sides = Math.max(2, Math.min(20, Number(requestedSides) || 20));
    const value = Math.floor(Math.random() * sides) + 1;
    const at = Date.now();
    setDiceRolls((rolls) => [...rolls.slice(-49), {
      id: `local-${myId}-${at}-${++diceLogIdRef.current}`,
      from: myId,
      name: session.name,
      value,
      sides,
      at,
    }]);
    connRef.current?.sendDiceRoll(value, sides, at);
  };

  const passTurn = useCallback(() => {
    if (isVisitor) return;
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    if (!playerIds.length) return;
    const currentId = activePlayerId || playerIds[0];
    if (currentId !== myId) return;
    const nextId = playerIds[(playerIds.indexOf(currentId) + 1) % playerIds.length];
    setActivePlayerId(nextId);
    connRef.current?.setActivePlayer(nextId);
  }, [activePlayerId, isVisitor, myId, roster]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.code !== "Space" && event.key !== " ") || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) return;
      const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
      const currentId = activePlayerId || playerIds[0];
      if (isVisitor || !myId || currentId !== myId) return;
      event.preventDefault();
      passTurn();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activePlayerId, isVisitor, myId, passTurn, roster]);

  const chooseLobbyName = (next) => {
    if (isVisitor) return;
    const name = next.trim().slice(0, 48);
    if (!name) return;
    setLobbyName(name);
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

  const chooseVideoLayout = (layout) => {
    const next = ["tiles", "follow", "hero"].includes(layout) ? layout : "tiles";
    setVideoLayout(next);
    try { localStorage.setItem("snapcaster-video-layout", next); } catch { /* preference remains in memory */ }
  };

  const changePoison = (delta) => {
    if (isVisitor || !myId) return;
    const value = Math.max(0, Math.min(99, (poisonCounters[myId] || 0) + delta));
    setPoisonCounters((values) => ({ ...values, [myId]: value }));
    connRef.current?.setPoison(value);
  };

  const changeCommanderDamage = (attackerId, delta) => {
    if (isVisitor || !myId || !attackerId || attackerId === myId) return;
    const value = Math.max(0, Math.min(99, (commanderDamage[myId]?.[attackerId] || 0) + delta));
    setCommanderDamage((values) => ({
      ...values,
      [myId]: { ...(values[myId] || {}), [attackerId]: value },
    }));
    connRef.current?.setCommanderDamage(attackerId, value);
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

  const makeJoinLink = (visitor = false) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("code", session.code);
    if (visitor) url.searchParams.set("visitor", "1");
    return url.toString();
  };

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("input");
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  };

  const copyJoinLink = async (visitor = false) => {
    await copyText(makeJoinLink(visitor));
    const setter = visitor ? setVisitorLinkCopied : setLinkCopied;
    setter(true);
    setTimeout(() => setter(false), 1600);
  };

  const copyGameCode = async () => {
    await copyText(session.code);
    setGameCodeCopied(true);
    setTimeout(() => setGameCodeCopied(false), 1600);
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
  const resolvedActivePlayerId = activePlayerId || players[0]?.id || "";
  const counterPlayers = [...players]
    .sort((a, b) => Number(b.id === myId) - Number(a.id === myId))
    .map((player) => ({
      ...player,
      isMe: player.id === myId,
      commander: commanders[player.id] || "",
      poison: poisonCounters[player.id] || 0,
      commanderDamage: commanderDamage[player.id] || {},
    }));
  const tiles = players.map((p, i) => ({
    ...p,
    life: lives[p.id] ?? 40,
    commander: commanders[p.id] || "",
    color: colors[p.id] || TILE_COLORS[i % TILE_COLORS.length],
    muted: !!mutedPlayers[p.id],
    stream: p.id === myId ? localStream : streams[p.id],
    isMe: p.id === myId,
    activeTurn: p.id === resolvedActivePlayerId,
  }));
  while (tiles.length < 4) tiles.push({ id: `empty-${tiles.length}`, empty: true });
  const resolvedHeroPlayerId = tiles.some((tile) => !tile.empty && tile.id === heroPlayerId)
    ? heroPlayerId
    : resolvedActivePlayerId;
  const heroTile = tiles.find((tile) => tile.id === resolvedHeroPlayerId) || tiles[0];
  const visibleTiles = videoLayout === "follow"
    ? [tiles.find((tile) => tile.id === resolvedActivePlayerId) || tiles[0]]
    : videoLayout === "hero"
      ? [heroTile, ...tiles.filter((tile) => tile.id !== heroTile.id)]
      : tiles;
  const myColor = colors[myId] || TILE_COLORS[Math.max(0, players.findIndex((p) => p.id === myId))] || TILE_COLORS[0];

  return (
    <div className="game">
      {visitors
        .filter((visitor) => visitor.id !== myId && streams[visitor.id])
        .map((visitor) => (
          <RemoteAudio key={visitor.id} stream={streams[visitor.id]} />
        ))}
      {videoLayout === "follow" && players
        .filter((player) => player.id !== resolvedActivePlayerId && player.id !== myId && streams[player.id])
        .map((player) => (
          <RemoteAudio key={`follow-audio-${player.id}`} stream={streams[player.id]} />
        ))}

      <div className="main">
        {sidebarOpen && (
          <CardSidebar
            current={current}
            lookups={lookups}
            lifeEvents={lifeEvents}
            diceRolls={diceRolls}
            chatMessages={chatMessages}
            currentUserId={myId}
            onSendChat={sendChat}
            onRollDie={rollDie}
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
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
            videoLayout={videoLayout}
            onVideoLayoutChange={chooseVideoLayout}
            counterPlayers={counterPlayers}
            onChangePoison={changePoison}
            onChangeCommanderDamage={changeCommanderDamage}
            onToggleCam={toggleCam}
            onToggleMic={toggleMic}
            onChooseCamera={chooseCamera}
            onChooseMic={chooseMic}
            onChooseColor={chooseColor}
            linkCopied={linkCopied}
            visitorLinkCopied={visitorLinkCopied}
            gameCodeCopied={gameCodeCopied}
            gameCode={session.code}
            playerLink={makeJoinLink(false)}
            visitorLink={makeJoinLink(true)}
            onCopyPlayerLink={() => copyJoinLink(false)}
            onCopyVisitorLink={() => copyJoinLink(true)}
            onCopyGameCode={copyGameCode}
            lobbyName={lobbyName || "Untitled game"}
            onRenameLobby={chooseLobbyName}
          />
        )}
        <div className="video-panel">
          {!sidebarOpen && (
            <div
              className="sidebar-edge-zone"
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setEdgeTabY(Math.max(34, Math.min(rect.height - 34, event.clientY - rect.top)));
              }}
            >
              <button
                className="sidebar-edge-tab"
                style={{ top: edgeTabY == null ? "50%" : `${edgeTabY}px` }}
                onClick={() => {
                  setSidebarView("lookup");
                  setSidebarOpen(true);
                }}
                aria-label="Open card panel"
                title="Open card panel"
              >
                <PanelLeft size={18} />
              </button>
            </div>
          )}
          {visitors.length > 0 && (
            <div className="video-visitor-overlay">
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
          )}
          <div className={videoLayout === "follow" ? "grid follow-active" : videoLayout === "hero" ? "grid hero-view" : "grid"}>
            {visibleTiles.map((t, i) => (
              <VideoTile
                key={t.id}
                tile={t}
                color={t.color || TILE_COLORS[i % TILE_COLORS.length]}
                innerSide={videoLayout === "follow" || i % 2 === 0 ? "right" : "left"}
                flash={flash?.tileId === t.id ? flash : null}
                onIdentify={identify}
                onChooseCommander={chooseCommander}
                onChangeLife={changeLife}
                onPassTurn={passTurn}
                heroRole={videoLayout === "hero" ? (i === 0 ? "main" : "thumbnail") : ""}
                onSelectHero={() => {
                  if (!t.empty) setHeroPlayerId(t.id);
                }}
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

let speakerAudioContext = null;

function getSpeakerAudioContext() {
  if (speakerAudioContext) return speakerAudioContext;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  speakerAudioContext = new AudioContext();

  // Safari and Chromium can suspend Web Audio when the game finishes joining
  // after the original button click. Resume on the next interaction as well as
  // immediately, so level detection never stays silently paused.
  const resume = () => {
    if (speakerAudioContext?.state === "suspended") speakerAudioContext.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume, { capture: true });
  window.addEventListener("keydown", resume, { capture: true });
  document.addEventListener("visibilitychange", resume);
  resume();
  return speakerAudioContext;
}

// Watch a stream's microphone level without routing any extra audio. A short
// release delay keeps the indicator steady across natural gaps between words.
function useSpeaking(stream, disabled = false) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const audioTrack = stream?.getAudioTracks?.()[0];
    if (!stream || !audioTrack || disabled) {
      setSpeaking(false);
      return undefined;
    }

    const context = getSpeakerAudioContext();
    if (!context) return undefined;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let lastVoiceAt = 0;
    let active = false;
    let noiseFloor = 0.004;
    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      // Learn the room's quiet level, but only while the signal is near it so
      // normal speech does not teach the threshold to ignore the speaker.
      if (rms < Math.max(0.012, noiseFloor * 2.2)) {
        noiseFloor = noiseFloor * 0.96 + rms * 0.04;
      }
      const voiceThreshold = Math.max(0.007, noiseFloor * 2.6);
      if (audioTrack.enabled && audioTrack.readyState === "live" && rms > voiceThreshold) {
        lastVoiceAt = now;
      }
      const next = now - lastVoiceAt < 360;
      if (next !== active) {
        active = next;
        setSpeaking(next);
      }
      frame = requestAnimationFrame(update);
    };
    if (context.state === "suspended") context.resume().catch(() => {});
    frame = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
    };
  }, [stream, disabled]);

  return speaking;
}

// Seat accent palette: yellow, blue, green, red.
const TILE_COLORS = [
  "#d7ac3f", "#e67e3c", "#d95757", "#d45b9b", "#a66bdd", "#626bc9",
  "#3f8fd2", "#38b8cf", "#31957e", "#58a75c", "#a6b94a", "#7c8796",
];

function VideoTile({ tile, color, innerSide, onIdentify, onChooseCommander, onChangeLife, onPassTurn, heroRole, onSelectHero, flash }) {
  const videoRef = useRef(null);
  const [flipped, setFlipped] = useState(false);
  const speaking = useSpeaking(tile.stream, tile.muted);
  useEffect(() => {
    if (videoRef.current && tile.stream) videoRef.current.srcObject = tile.stream;
  }, [tile.stream]);

  if (tile.empty) {
    return (
      <div className={`tile empty${heroRole === "thumbnail" ? " hero-thumbnail" : heroRole === "main" ? " hero-main" : ""}`} style={{ borderColor: color }}>
        <span>Waiting for player…</span>
      </div>
    );
  }

  return (
    <div
      className={`tile${tile.activeTurn ? " active-turn" : ""}${heroRole === "thumbnail" ? " hero-thumbnail" : heroRole === "main" ? " hero-main" : ""}`}
      style={{ borderColor: color, "--speaker-color": color }}
    >
      {heroRole === "thumbnail" && (
        <button
          type="button"
          className="hero-thumbnail-hit"
          onClick={onSelectHero}
          aria-label={`Make ${tile.name} the hero view`}
        />
      )}
      <CommanderBanner
        tile={tile}
        onChoose={onChooseCommander}
        speaking={speaking}
        onPassTurn={onPassTurn}
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

// Small, unadorned pips keep the commander's colors visible without competing
// with the name in the compact video overlay.
const MANA_BG = {
  W: "#f6f2dc", U: "#bcd7ea", B: "#c6bcb6", R: "#e8997c", G: "#a9c9a4", C: "#cdc4be",
};

function ManaCost({ cost }) {
  if (!cost) return null;
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return (
    <span className="mana-cost">
      {symbols.map((sym, i) => {
        return (
          <span
            key={`${sym}-${i}`}
            className="mana-symbol"
            style={{ background: MANA_BG[sym] || MANA_BG.C }}
            role="img"
            aria-label={`{${sym}}`}
          />
        );
      })}
    </span>
  );
}

// Three-dot video-options menu on the banner's first row.
function TileMenu({ flipped, onToggleFlip, canPassTurn, onPassTurn }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="banner-menu" onClick={(e) => e.stopPropagation()}>
      <button
        className="menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Video options"
        title="Video options"
      >
        <MoreVertical size={18} />
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
            <FlipVertical2 size={18} />
            <span>{flipped ? "Unflip video" : "Flip video"}</span>
          </button>
          {canPassTurn && (
            <button
              type="button"
              onClick={() => {
                onPassTurn?.();
                setOpen(false);
              }}
            >
              <SkipForward size={18} />
              <span>Pass turn</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommanderBanner({ tile, onChoose, speaking, onPassTurn, flipped, onToggleFlip }) {
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
      {tile.muted && <MicOff size={18} className="banner-muted" aria-label="Muted" />}
      <span className="banner-player">{playerLabel}</span>
      {speaking && (
        <span className="speaking-meter" role="img" aria-label="Speaking">
          <i /><i /><i /><i /><i />
        </span>
      )}
    </span>
  );

  const nameRow = (
    <div className="banner-row banner-name-row">
      {playerRow}
    </div>
  );

  if (!tile.isMe) {
    return (
      <div className="commander-banner">
        <TileMenu flipped={flipped} onToggleFlip={onToggleFlip} />
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
        <TileMenu flipped={flipped} onToggleFlip={onToggleFlip} canPassTurn={tile.activeTurn} onPassTurn={onPassTurn} />
        {nameRow}
        <div className="banner-row">
          <span className={tile.commander ? "commander-name" : "commander-name unset"}>
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
      <TileMenu flipped={flipped} onToggleFlip={onToggleFlip} canPassTurn={tile.activeTurn} onPassTurn={onPassTurn} />
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
