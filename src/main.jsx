import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const BUILD = "capture-3 (native-res click crops, ranked guesses)";
console.log(`%c[snapcaster] build: ${BUILD}`, "color:#0a0;font-weight:bold");

createRoot(document.getElementById("root")).render(<App />);
