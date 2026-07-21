import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// The benchmark page pulls in SnapTest + the scene generator + the degradation
// harness (~1300 lines) that no player ever runs. Split it out so it is fetched
// only when /snaptest is opened.
const SnapTest = lazy(() => import("./SnapTest.jsx"));
import "./styles.css";

const BUILD = "art-margin-1 (confidence margin vs rival CARD, not printing)";
window.__SNAP_BUILD = BUILD;
console.log(`%c[snapcaster] build: ${BUILD}`, "color:#0a0;font-weight:bold");

// Recognition benchmark page at /snaptest (see snaptest/README.md).
const isSnapTest = window.location.pathname.replace(/\/+$/, "") === "/snaptest";
createRoot(document.getElementById("root")).render(
  isSnapTest
    ? <Suspense fallback={null}><SnapTest /></Suspense>
    : <App />,
);
