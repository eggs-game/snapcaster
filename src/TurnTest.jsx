import React, { useEffect, useState } from "react";
import { testTurnConnectivity } from "./webrtc.js";

export default function TurnTest() {
  const [result, setResult] = useState({ status: "testing", relayCandidates: 0 });

  useEffect(() => {
    let active = true;
    testTurnConnectivity().then((next) => {
      if (active) setResult(next);
    });
    return () => { active = false; };
  }, []);

  return (
    <main className="lobby-home">
      <section className="lobby-hero" aria-labelledby="turn-test-title">
        <h1 id="turn-test-title">Cloudflare TURN diagnostic</h1>
        <p role="status">{result.status === "testing" ? "Gathering a relay candidate…" : result.status}</p>
        <pre data-testid="turn-result">{JSON.stringify(result, null, 2)}</pre>
      </section>
    </main>
  );
}
