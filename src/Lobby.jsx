import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, Mic, X } from "lucide-react";
import { isConfigured, makeCode, CODE_LENGTH } from "./signaling.js";
import { preload as preloadRecognition } from "./recognition/matcher.js";

export default function Lobby({ onStart }) {
  const params = new URLSearchParams(window.location.search);
  const visitorMode = params.get("visitor") === "1";
  const initialCode = (params.get("code") || "").toUpperCase().slice(0, CODE_LENGTH);
  const [modal, setModal] = useState(initialCode || visitorMode ? "join" : null);
  const [name, setName] = useState(localStorage.getItem("sc-name") || "");
  const [code, setCode] = useState(initialCode);
  const [lobbyName, setLobbyName] = useState("");
  const [bracket, setBracket] = useState("3");
  const [seatLimit, setSeatLimit] = useState("4");
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
  const previewRef = useRef(null);
  const previewStreamRef = useRef(null);
  const previewRequestRef = useRef(0);

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
        video: visitorMode ? false : {
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
    if (modal !== "join") {
      stopPreview();
      return undefined;
    }
    acquirePreview();
    return () => stopPreview();
    // Device changes are handled explicitly so opening the modal is the only
    // automatic permission request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, visitorMode]);

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
    if (!isConfigured()) {
      setError("Multiplayer is not configured for this deployment.");
      return;
    }
    localStorage.setItem("sc-name", playerName);
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
    go(makeCode(), "player", lobbyName, {
      bracket: Number(bracket),
      seatLimit: Number(seatLimit),
      creator: true,
    });
  };

  const joinGame = (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError("Enter the four-character game code.");
      return;
    }
    stopPreview();
    go(code, visitorMode ? "visitor" : "player", "", {
      videoDeviceId,
      audioDeviceId,
    });
  };

  const continueToSetup = (event) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError("Enter the four-character game code.");
      return;
    }
    setError("");
    setModal("join");
  };

  return (
    <main className="lobby-home">
      <section className="lobby-hero" aria-labelledby="snapcaster-title">
        <h1 id="snapcaster-title">Snapcaster</h1>
        <div className="home-actions">
          <button className="primary" onClick={() => openModal("create")}>Create game</button>
          <button onClick={() => openModal("join-code")}>Join game</button>
        </div>
      </section>

      {modal && (
        <div
          className="lobby-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !visitorMode) setModal(null);
          }}
        >
          <section className={`lobby-modal${modal === "join" ? " prejoin-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="lobby-modal-title">
            {!visitorMode && (
              <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">
                <X size={19} />
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
                </div>

                <ModalStatus status={indexStatus} count={indexCount} />
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
                    <input
                      className="code-input"
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, CODE_LENGTH));
                        setError("");
                      }}
                      placeholder="ABCD"
                      maxLength={CODE_LENGTH}
                      autoFocus
                    />
                  </label>
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
              <form onSubmit={joinGame}>
                <header className="modal-head compact">
                  <h2 id="lobby-modal-title">{visitorMode ? "Join as a visitor" : `Join room ${code}`}</h2>
                </header>

                <div className="prejoin-layout">
                  <div className="media-preview">
                    {visitorMode ? (
                      <div className="preview-placeholder"><Mic size={30} /><span>Voice-only visitor</span></div>
                    ) : (
                      <video ref={previewRef} autoPlay muted playsInline />
                    )}
                    {!visitorMode && !previewStream && !mediaError && (
                      <div className="preview-placeholder"><Camera size={30} /><span>Starting camera…</span></div>
                    )}
                    {mediaError && (
                      <div className="preview-placeholder error">
                        {visitorMode ? <Mic size={30} /> : <Camera size={30} />}
                        <span>{visitorMode ? "Microphone unavailable" : "Preview unavailable"}</span>
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

                    <div className={`device-options${visitorMode ? " single" : ""}`}>
                      {!visitorMode && (
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
                  </div>
                </div>

                <ModalStatus status={indexStatus} count={indexCount} />
                {mediaError && <p className="media-error">{mediaError}</p>}
                {error && <p className="modal-error" role="alert">{error}</p>}

                <footer className="modal-actions">
                  {!visitorMode && <button type="button" onClick={() => setModal(null)}>Cancel</button>}
                  <button className="primary" type="submit">
                    {visitorMode ? "Join as visitor" : "Join game"} <ArrowRight size={17} />
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
