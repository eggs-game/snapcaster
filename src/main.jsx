import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const BUILD = "ocr-2 (hi-res title strips + glare flatten)";
console.log(`%c[snapcaster] build: ${BUILD}`, "color:#0a0;font-weight:bold");

createRoot(document.getElementById("root")).render(<App />);
