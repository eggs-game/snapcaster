import assert from "node:assert/strict";
import { getCounterTextColor } from "../src/videoCounters.js";

const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value > 0.04045 ? Math.pow((value + 0.055) / 1.055, 2.4) : value / 12.92);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const palette = ["#5d78dc", "#7c8796", "#d7ac3f", "#e67e3c", "#d95757", "#d45b9b", "#a66bdd", "#626bc9", "#3f8fd2", "#38b8cf", "#31957e", "#58a75c", "#a6b94a"];
for (let red = 0; red <= 255; red += 17) {
  for (let green = 0; green <= 255; green += 17) {
    for (let blue = 0; blue <= 255; blue += 17) palette.push(`#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`);
  }
}
for (const color of palette) {
  const foreground = getCounterTextColor(color);
  assert.ok(["#000", "#fff"].includes(foreground));
  const light = luminance(color);
  const ratio = foreground === "#000" ? (light + .05) / .05 : 1.05 / (light + .05);
  assert.ok(ratio >= 4.5, `${color} counter text has insufficient contrast: ${ratio}`);
}
assert.equal(getCounterTextColor("#789"), getCounterTextColor("#778899"));
assert.equal(getCounterTextColor("invalid"), "#18170f");
console.log("OK: small counter text meets 4.5:1 across tile palette, reported failures and 4096 RGB samples");
