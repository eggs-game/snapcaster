import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import SnapTest from "./SnapTest.jsx";
import "./styles.css";

const BUILD = "ocr-corroborate-15 (short OCR names need visual backup)";
window.__SNAP_BUILD = BUILD;
console.log(`%c[snapcaster] build: ${BUILD}`, "color:#0a0;font-weight:bold");

// Recognition benchmark page at /snaptest (see snaptest/README.md).
const isSnapTest = window.location.pathname.replace(/\/+$/, "") === "/snaptest";
createRoot(document.getElementById("root")).render(isSnapTest ? <SnapTest /> : <App />);
