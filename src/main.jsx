import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// The benchmark page pulls in SnapTest + the scene generator + the degradation
// harness (~1300 lines) that no player ever runs. Split it out so it is fetched
// only when /snaptest is opened.
const SnapTest = lazy(() => import("./SnapTest.jsx"));
const TurnTest = lazy(() => import("./TurnTest.jsx"));
import "./styles.css";

const BUILD = "warm-lobby-1 (lobby core preload + ready handshake)";
window.__SNAP_BUILD = BUILD;
console.log(`%c[snapcaster] build: ${BUILD}`, "color:#0a0;font-weight:bold");

// Recognition benchmark page at /snaptest (see snaptest/README.md).
const route = window.location.pathname.replace(/\/+$/, "");
const isSnapTest = route === "/snaptest";
const isTurnTest = route === "/turntest";
createRoot(document.getElementById("root")).render(
  isSnapTest
    ? <Suspense fallback={null}><SnapTest /></Suspense>
    : isTurnTest
      ? <Suspense fallback={null}><TurnTest /></Suspense>
    : <App />,
);
