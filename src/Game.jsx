import React, { useEffect, useRef, useState, useCallback } from "react";
import { GameConnection, captureLocalCrop, clickToNormalized } from "./webrtc.js";
import { identify as identifyCard, preload as preloadRecognition } from "./recognition/matcher.js";
import CardSidebar from "./CardSidebar.jsx";

export default function Game({ session, onLeave }) {
  const connRef = useRef(null);
  const [myId, setMyId] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lives, setLives] = useState({}); // id -> life
  const [streams, setStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    // Spin up the recognition worker now so OpenCV compiles in the background
    // (off the main thread) while the player sets up their camera and cards.
    preloadRecognition();
    const conn = new GameConnection({
      onRoster: setRoster,
      onRemoteStream: (id, stream) => setStreams((s) => ({ ...s, [id]: stream })),
      onPeerLeft: (id) => setStreams((s) => { const c = { ...s }; delete c[id]; return c; }),
      onLife: (id, life) => setLives((l) => ({ ...l, [id]: life })),
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
      const image = tileId === myId
        ? await captureLocalCrop(conn.localStream, pt.nx, pt.ny)
        : await conn.requestRemoteCapture(tileId, pt.nx, pt.ny);
      const data = await identifyCard(image);
      setCurrent({
        matches: data.matches || [],
        cardFound: data.card_found,
        cvStatus: data.cv_status,
        candidatesTried: data.candidates_tried,
      });
      const top = data.matches?.[0];
      if (top && top.confidence > 0.35) {
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
    stream: p.id === myId ? localStream : streams[p.id],
    isMe: p.id === myId,
  }));
  while (tiles.length < 4) tiles.push({ id: `empty-${tiles.length}`, empty: true });

  return (
    <div className="game">
      <header>
        <span className="logo">Snapcaster</span>
        <span className="code">Game code: <b>{session.code}</b></span>
        <div className="controls">
          <button onClick={toggleMic} className={micOn ? "" : "off"}>{micOn ? "Mute" : "Unmute"}</button>
          <button onClick={toggleCam} className={camOn ? "" : "off"}>{camOn ? "Camera off" : "Camera on"}</button>
          <button onClick={() => changeLife(-1)}>−1 life</button>
          <button onClick={() => changeLife(+1)}>+1 life</button>
          <button className="leave" onClick={onLeave}>Leave</button>
        </div>
      </header>
      <div className="main">
        <div className="grid">
          {tiles.map((t) => (
            <VideoTile key={t.id} tile={t} flash={flash?.tileId === t.id ? flash : null} onIdentify={identify} />
          ))}
        </div>
        <CardSidebar current={current} lookups={lookups} onPick={(m) => setCurrent({ matches: [m] })} />
      </div>
      <footer className="hint">Click any card on any video to identify it. Share code <b>{session.code}</b> with friends.</footer>
    </div>
  );
}

function VideoTile({ tile, onIdentify, flash }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && tile.stream) videoRef.current.srcObject = tile.stream;
  }, [tile.stream]);

  if (tile.empty) return <div className="tile empty"><span>Waiting for player…</span></div>;

  return (
    <div className="tile" onClick={(e) => videoRef.current && onIdentify(tile.id, videoRef.current, e.clientX, e.clientY)}>
      <video ref={videoRef} autoPlay playsInline muted={tile.isMe} />
      {flash && <div className="click-flash" style={{ left: flash.x, top: flash.y }} />}
      <div className="tile-bar">
        <span className="pname">{tile.name}{tile.isMe ? " (you)" : ""}</span>
        <span className="life">{tile.life} ❤</span>
      </div>
    </div>
  );
}
