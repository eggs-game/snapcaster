import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Bell,
  Camera,
  Eye,
  Globe2,
  HeartPulse,
  LayoutGrid,
  LogIn,
  LogOut,
  Maximize,
  MessagesSquare,
  Mic,
  ScanLine,
  Settings,
  Share2,
  Smile,
  Users,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { isConfigured, makeCode, CODE_LENGTH } from "./signaling.js";
import { preload as preloadRecognition } from "./recognition/matcher.js";
import SiteFooter from "./SiteFooter.jsx";
import { accountDisplayName } from "./account.js";
import { createGameRoom, joinGameRoom } from "./gameRooms.js";
import { getLocalMockGame } from "./localMock.js";
import GamePreview from "./GamePreview.jsx";

const HOME_FEATURES = [
  {
    icon: ScanLine,
    title: "Instant card recognition",
    description: "Click a card to identify its exact printing without stopping the game.",
  },
  {
    icon: Video,
    title: "Up to 4K capture",
    description: "Use supported 4K cameras for sharper tables and more reliable card clicks.",
  },
  {
    icon: Eye,
    title: "Visitor mode",
    description: "Watch, listen, and join chat without taking a seat or sharing a camera.",
  },
  {
    icon: LayoutGrid,
    title: "Three table views",
    description: "Switch between Tiles, Follow, and Hero layouts as the game changes.",
  },
  {
    icon: Maximize,
    title: "Cover or fit video",
    description: "Fill each tile or show the complete camera frame with one setting.",
  },
  {
    icon: MessagesSquare,
    title: "Live table chat",
    description: "Keep the conversation and game updates together beside the table.",
  },
  {
    icon: Smile,
    title: "Emotes and reactions",
    description: "Drop visual reactions onto the table without interrupting the turn.",
  },
  {
    icon: AudioLines,
    title: "Shared sound effects",
    description: "Send applause, boos, creature sounds, and more to everyone in the room.",
  },
  {
    icon: Users,
    title: "Live audience",
    description: "Let friends watch the table and join the conversation as visitors.",
  },
  {
    icon: HeartPulse,
    title: "Commander game tools",
    description: "Track life, commander damage, turns, counters, dice, and ready checks.",
  },
  {
    icon: Globe2,
    title: "Public or private rooms",
    description: "Open a table for discovery or keep game night to people with the code.",
  },
  {
    icon: Share2,
    title: "Shared card results",
    description: "Share a recognized card once so everyone gets the result in Recents.",
  },
];

function HomeFeatures() {
  return (
    <section className="home-features" aria-labelledby="home-features-title">
      <div className="home-features-inner">
        <header className="home-features-head">
          <h2 id="home-features-title">Everything game night needs.</h2>
          <p>Clearer cards, flexible video, and more ways for everyone at the table to join the fun.</p>
        </header>
        <div className="home-features-grid">
          {HOME_FEATURES.map(({ icon: Icon, title, description }) => (
            <article className="home-feature-card" key={title}>
              <span className="home-feature-icon" aria-hidden="true">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Lobby({
  onStart,
  account,
  accountReady,
  accountError = "",
  onSignIn,
  onSignOut,
  onSaveEntryPreferences,
  notificationCount = 0,
}) {
  const params = new URLSearchParams(window.location.search);
  const visitorMode = params.get("visitor") === "1";
  const initialAction = params.get("action");
  const initialCode = (params.get("code") || "").toUpperCase().slice(0, CODE_LENGTH);
  const [modal, setModal] = useState(
    initialCode || visitorMode
      ? "join"
      : initialAction === "create"
        ? "create"
        : initialAction === "join"
          ? "join-code"
          : null,
  );
  const [name, setName] = useState(localStorage.getItem("sc-name") || "");
  const [code, setCode] = useState(initialCode);
  const [lobbyName, setLobbyName] = useState("");
  const [bracket, setBracket] = useState("3");
  const [seatLimit, setSeatLimit] = useState("4");
  const [visibility, setVisibility] = useState("private");
  const [joinRole, setJoinRole] = useState(visitorMode ? "visitor" : "player");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [indexStatus, setIndexStatus] = useState("loading");
  const [indexCount, setIndexCount] = useState(0);
  const [previewStream, setPreviewStream] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [localMockRoom, setLocalMockRoom] = useState(null);
  const [localMockChecked, setLocalMockChecked] = useState(false);
  const previewRef = useRef(null);
  const previewStreamRef = useRef(null);
  const previewRequestRef = useRef(0);
  const joiningAsVisitor = visitorMode || (modal === "join" && joinRole === "visitor");
  const joiningLocalMock = modal === "join" && Boolean(localMockRoom);

  useEffect(() => {
    if (!account) return;
    setName(accountDisplayName(account));
    setVideoDeviceId(account.preferences?.preferred_camera_id || "");
    setAudioDeviceId(account.preferences?.preferred_microphone_id || "");
  }, [account]);

  useEffect(() => {
    preloadRecognition()
      .then((count) => { setIndexCount(count); setIndexStatus("ok"); })
      .catch(() => setIndexStatus("missing"));
  }, []);

  useEffect(() => {
    if (!modal) return undefined;
    const close = (event) => {
      if (event.key === "Escape" && !visitorMode) setModal(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, visitorMode]);

  useEffect(() => {
    let cancelled = false;
    if (modal !== "join") {
      setLocalMockRoom(null);
      setLocalMockChecked(true);
      return undefined;
    }
    setLocalMockChecked(false);
    getLocalMockGame(code).then((room) => {
      if (cancelled) return;
      setLocalMockRoom(room);
      setLocalMockChecked(true);
    });
    return () => { cancelled = true; };
  }, [code, modal]);

  const stopPreview = () => {
    previewRequestRef.current++;
    for (const track of previewStreamRef.current?.getTracks?.() || []) track.stop();
    previewStreamRef.current = null;
    setPreviewStream(null);
    setMicLevel(0);
  };

  const acquirePreview = async (nextVideoId = videoDeviceId, nextAudioId = audioDeviceId) => {
    const request = ++previewRequestRef.current;
    setMediaError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: joiningAsVisitor ? false : {
          ...(nextVideoId ? { deviceId: { exact: nextVideoId } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: {
          ...(nextAudioId ? { deviceId: { exact: nextAudioId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (request !== previewRequestRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      for (const track of previewStreamRef.current?.getTracks?.() || []) track.stop();
      previewStreamRef.current = stream;
      setPreviewStream(stream);
      setVideoDeviceId(stream.getVideoTracks()[0]?.getSettings?.().deviceId || nextVideoId || "");
      setAudioDeviceId(stream.getAudioTracks()[0]?.getSettings?.().deviceId || nextAudioId || "");
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === "videoinput"));
      setMics(devices.filter((device) => device.kind === "audioinput"));
    } catch (mediaFailure) {
      if (request === previewRequestRef.current) {
        setMediaError(String(mediaFailure?.message || "Camera and microphone access failed."));
      }
    }
  };

  useEffect(() => {
    if (modal !== "join" && modal !== "create-setup") {
      stopPreview();
      return undefined;
    }
    if (modal === "join" && (!localMockChecked || joiningLocalMock)) {
      stopPreview();
      setMediaError("");
      return undefined;
    }
    acquirePreview();
    return () => stopPreview();
    // Device changes are handled explicitly so opening the modal is the only
    // automatic permission request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, joiningAsVisitor, joiningLocalMock, localMockChecked]);

  useEffect(() => {
    if (previewRef.current && previewStream) {
      previewRef.current.srcObject = previewStream;
      previewRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  useEffect(() => {
    const audioTrack = previewStream?.getAudioTracks?.()[0];
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioTrack || !AudioContext) {
      setMicLevel(0);
      return undefined;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(previewStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let lastUpdate = 0;
    const measure = (now) => {
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (let index = 0; index < samples.length; index++) energy += samples[index] * samples[index];
      if (now - lastUpdate > 70) {
        setMicLevel(Math.min(1, Math.sqrt(energy / samples.length) * 14));
        lastUpdate = now;
      }
      frame = requestAnimationFrame(measure);
    };
    context.resume().catch(() => {});
    frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      context.close().catch(() => {});
    };
  }, [previewStream]);

  const openModal = (next) => {
    setError("");
    setModal(next);
  };

  const go = (roomCode, role = visitorMode ? "visitor" : "player", createdLobbyName = "", settings = {}) => {
    const playerName = name.trim();
    if (!playerName) {
      setError("Enter your player name to continue.");
      return;
    }
    if (!isConfigured() && !settings.mockGame) {
      setError("Multiplayer is not configured for this deployment.");
      return;
    }
    localStorage.setItem("sc-name", playerName);
    onSaveEntryPreferences?.({
      preferredCameraId: settings.videoDeviceId || "",
      preferredMicrophoneId: settings.audioDeviceId || "",
    });
    onStart({
      name: playerName,
      code: roomCode,
      role,
      creator: !!settings.creator,
      lobbyName: createdLobbyName.trim().slice(0, 48),
      ...settings,
    });
  };

  const createGame = (event) => {
    event.preventDefault();
    if (!lobbyName.trim()) {
      setError("Give your game a name to continue.");
      return;
    }
    setError("");
    setCode(makeCode());
    setModal("create-setup");
  };

  const finishCreate = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const capability = await createGameRoom({
        code,
        name: lobbyName,
        bracket: Number(bracket),
        visibility,
        seatLimit: Number(seatLimit),
        displayName: name.trim(),
      });
      stopPreview();
      go(code, "player", lobbyName, {
        bracket: Number(bracket),
        seatLimit: Number(seatLimit),
        visibility,
        creator: true,
        videoDeviceId,
        audioDeviceId,
        ...capability,
      });
    } catch (createError) {
      setError(String(createError?.message || "Could not create this game."));
    } finally {
      setSubmitting(false);
    }
  };

  const joinGame = async (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError("Enter the six-character game code.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const role = joiningAsVisitor ? "visitor" : "player";
      const capability = await joinGameRoom({ code, displayName: name.trim(), role });
      stopPreview();
      go(code, role, "", {
        videoDeviceId,
        audioDeviceId,
        ...capability,
      });
    } catch (joinError) {
      setError(String(joinError?.message || "Could not join this game."));
    } finally {
      setSubmitting(false);
    }
  };

  const continueToSetup = (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError("Enter the six-character game code.");
      return;
    }
    setError("");
    setModal("join");
  };

  return (
    <main className="lobby-home">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
        <nav className="home-header-actions" aria-label="Game actions">
          <button className="home-header-create" type="button" onClick={() => openModal("create")}>Create</button>
          <button className="home-header-join" type="button" onClick={() => openModal("join-code")}>Join</button>
        </nav>
        <div className="site-account">
          {account ? (
            <>
              <button
                className="site-account-button"
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-expanded={accountMenuOpen}
              >
                <span>{accountDisplayName(account)}</span>
                {notificationCount > 0 && (
                  <span className="site-notification-badge" aria-label={`${notificationCount} unread notifications`}>
                    {notificationCount > 9 ? "9+" : notificationCount}
                  </span>
                )}
              </button>
              {accountMenuOpen && (
                <div className="site-account-menu">
                  <a href="/profile"><UserRound size={16} />Profile</a>
                  <a href="/friends"><Users size={16} />Friends</a>
                  <a href="/settings"><Settings size={16} />Settings</a>
                  <a href="/notifications">
                    <Bell size={16} />
                    <span>Notifications</span>
                    {notificationCount > 0 && <strong>{notificationCount > 9 ? "9+" : notificationCount}</strong>}
                  </a>
                  <button type="button" onClick={() => onSignOut?.()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </>
          ) : accountReady ? (
            <>
              <button className="site-discord-button" type="button" onClick={onSignIn}>
                <LogIn size={17} />
                Sign in with Discord
              </button>
              {accountError && (
                <p className="site-account-error" role="alert">{accountError}</p>
              )}
            </>
          ) : null}
        </div>
      </header>
      <section className="lobby-hero lobby-hero-landing" aria-labelledby="snapcast-title">
        <div className="lobby-hero-content">
          <h1 id="snapcast-title">Online paper Magic with real table feel.</h1>
          <p className="lobby-hero-desc">
            Instant card recognition keeps play moving. Emotes, sound effects, table banter, and a live audience bring game night to life.
          </p>
          <div className="home-actions">
            <button className="primary" onClick={() => openModal("create")}>Make game</button>
            <a href="/games/lobbies">View games</a>
          </div>
        </div>
      </section>

      <GamePreview />

      <HomeFeatures />

      <SiteFooter />

      {modal && (
        <div
          className="lobby-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !visitorMode) setModal(null);
          }}
        >
          <section className={`lobby-modal${modal === "join" || modal === "create-setup" ? " prejoin-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="lobby-modal-title">
            {!visitorMode && (
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">
                <X size={20} />
              </button>
            )}

            {modal === "create" ? (
              <form onSubmit={createGame}>
                <header className="modal-head">
                  <h2 id="lobby-modal-title">Create a new game</h2>
                </header>

                <div className="modal-fields two-column">
                  <label className="modal-field">
                    <span>Game name <em>Required</em></span>
                    <input
                      value={lobbyName}
                      onChange={(event) => { setLobbyName(event.target.value); setError(""); }}
                      placeholder="Friday night Commander"
                      maxLength={48}
                      autoFocus
                    />
                  </label>
                  <label className="modal-field">
                    <span>Your name <em>Required</em></span>
                    <input
                      value={name}
                      onChange={(event) => { setName(event.target.value); setError(""); }}
                      placeholder="Player name"
                      maxLength={24}
                    />
                  </label>
                </div>

                <div className="modal-fields two-column table-options" aria-label="Game settings">
                  <label className="modal-field">
                    <span>Bracket</span>
                    <select value={bracket} onChange={(event) => setBracket(event.target.value)}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>Bracket {value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Player limit</span>
                    <select value={seatLimit} onChange={(event) => setSeatLimit(event.target.value)}>
                      {[2, 3, 4, 5, 6].map((value) => (
                        <option key={value} value={value}>{value} players</option>
                      ))}
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Visibility</span>
                    <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                      <option value="private">Private · Invite link only</option>
                      <option value="public">Public · Listed in Games</option>
                    </select>
                  </label>
                </div>

                <ModalStatus status={indexStatus} count={indexCount} />
                {accountError && <p className="modal-error" role="alert">{accountError}</p>}
                {error && <p className="modal-error" role="alert">{error}</p>}

                <footer className="modal-actions">
                  <button type="button" onClick={() => setModal(null)}>Cancel</button>
                  <button className="primary" type="submit">
                    Create game <ArrowRight size={17} />
                  </button>
                </footer>
              </form>
            ) : modal === "join-code" ? (
              <form onSubmit={continueToSetup}>
                <header className="modal-head compact">
                  <h2 id="lobby-modal-title">Join a game</h2>
                </header>

                <div className="modal-fields">
                  <label className="modal-field">
                    <span>Game code <em>Required</em></span>
                    <div className="code-input-shell">
                      <input
                        className="code-input"
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, CODE_LENGTH));
                          setError("");
                        }}
                        maxLength={CODE_LENGTH}
                        autoComplete="one-time-code"
                        inputMode="text"
                        enterKeyHint="next"
                        spellCheck={false}
                        aria-label="Six-character game code"
                        autoFocus
                      />
                      <span className="code-input-slots" aria-hidden="true">
                        {Array.from({ length: CODE_LENGTH }, (_, index) => (
                          <span
                            className={`code-input-slot${code[index] ? " filled" : ""}${code.length === index ? " current" : ""}`}
                            key={index}
                          >
                            {code[index] || "ABC123"[index]}
                          </span>
                        ))}
                      </span>
                    </div>
                  </label>
                  {!visitorMode && (
                    <fieldset className="join-role-field">
                      <legend>Join as</legend>
                      <div className="join-role-options">
                        <button
                          type="button"
                          className={joinRole === "player" ? "active" : ""}
                          onClick={() => setJoinRole("player")}
                        >
                          Player
                          <small>Use camera and take a seat</small>
                        </button>
                        <button
                          type="button"
                          className={joinRole === "visitor" ? "active" : ""}
                          onClick={() => setJoinRole("visitor")}
                        >
                          Visitor
                          <small>Watch, listen, and use chat</small>
                        </button>
                      </div>
                    </fieldset>
                  )}
                </div>

                {error && <p className="modal-error" role="alert">{error}</p>}
                <footer className="modal-actions">
                  <button type="button" onClick={() => setModal(null)}>Cancel</button>
                  <button className="primary" type="submit">
                    Continue <ArrowRight size={17} />
                  </button>
                </footer>
              </form>
            ) : (
              <form onSubmit={modal === "create-setup" ? finishCreate : joinGame}>
                <header className="modal-head compact">
                  <h2 id="lobby-modal-title">
                    {modal === "create-setup" ? `Set up before creating ${lobbyName}` : joiningAsVisitor ? "Join as a visitor" : `Join room ${code}`}
                  </h2>
                </header>

                <div className="prejoin-layout">
                  <div className="media-preview">
                    {joiningLocalMock ? (
                      <div className="preview-placeholder"><Camera size={30} /><span>Local mock · no camera needed</span></div>
                    ) : joiningAsVisitor ? (
                      <div className="preview-placeholder"><Mic size={30} /><span>Voice-only visitor</span></div>
                    ) : (
                      <video ref={previewRef} autoPlay muted playsInline />
                    )}
                    {!joiningLocalMock && !joiningAsVisitor && !previewStream && !mediaError && (
                      <div className="preview-placeholder"><Camera size={30} /><span>Starting camera…</span></div>
                    )}
                    {!joiningLocalMock && mediaError && (
                      <div className="preview-placeholder error">
                        {joiningAsVisitor ? <Mic size={30} /> : <Camera size={30} />}
                        <span>{joiningAsVisitor ? "Microphone unavailable" : "Preview unavailable"}</span>
                      </div>
                    )}
                  </div>

                  <div className="prejoin-controls">
                    <div className="modal-fields identity-fields">
                      <label className="modal-field">
                        <span>Your name <em>Required</em></span>
                        <input
                          value={name}
                          onChange={(event) => { setName(event.target.value); setError(""); }}
                          placeholder="Player name"
                          maxLength={24}
                          autoFocus
                        />
                      </label>
                    </div>

                    {!joiningLocalMock && (
                    <div className={`device-options${joiningAsVisitor ? " single" : ""}`}>
                      {!joiningAsVisitor && (
                        <label className="modal-field">
                          <span>Camera</span>
                          <select
                            value={videoDeviceId}
                            onChange={(event) => {
                              const value = event.target.value;
                              setVideoDeviceId(value);
                              acquirePreview(value, audioDeviceId);
                            }}
                          >
                            {cameras.map((device, index) => (
                              <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="modal-field">
                        <span>Microphone</span>
                        <select
                          value={audioDeviceId}
                          onChange={(event) => {
                            const value = event.target.value;
                            setAudioDeviceId(value);
                            acquirePreview(videoDeviceId, value);
                          }}
                        >
                          {mics.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
                          ))}
                        </select>
                        <div className="mic-test" aria-label="Microphone input level">
                          <span>Mic level</span>
                          <div className="mic-meter"><i style={{ width: `${Math.max(3, micLevel * 100)}%` }} /></div>
                        </div>
                      </label>
                    </div>
                    )}
                  </div>
                </div>

                <ModalStatus status={indexStatus} count={indexCount} />
                {!joiningLocalMock && mediaError && <p className="media-error">{mediaError}</p>}
                {error && <p className="modal-error" role="alert">{error}</p>}

                <footer className="modal-actions">
                  {!visitorMode && (
                    <button type="button" onClick={() => (modal === "create-setup" ? setModal("create") : setModal(null))}>
                      {modal === "create-setup" ? "Back" : "Cancel"}
                    </button>
                  )}
                  <button className="primary" type="submit" disabled={submitting}>
                    {submitting
                      ? "Please wait…"
                      : modal === "create-setup"
                        ? "Create game"
                        : joiningAsVisitor
                          ? "Join as visitor"
                          : "Join game"} {!submitting && <ArrowRight size={17} />}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ModalStatus({ status, count }) {
  if (status === "loading") return <p className="modal-status">Preparing card recognition…</p>;
  if (status === "missing") return <p className="modal-status warning">Card recognition index is unavailable.</p>;
  return <p className="modal-status">Recognition ready · {count.toLocaleString()} card printings</p>;
}
