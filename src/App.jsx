import React, { useState } from "react";
import Lobby from "./Lobby.jsx";
import Game from "./Game.jsx";

export default function App() {
  const [session, setSession] = useState(null); // {code, name, role}
  return session
    ? <Game session={session} onLeave={() => setSession(null)} />
    : <Lobby onStart={setSession} />;
}
