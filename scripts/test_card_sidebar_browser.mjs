#!/usr/bin/env node
// Exercise the real sidebar in isolation: no account, camera, room, or Scryfall
// request is needed to reproduce these rendering and private-chat regressions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: "jsx",
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import CardSidebar from "./src/CardSidebar.jsx";
      import { ConfirmDialogProvider } from "./src/ConfirmDialog.jsx";
      const root = createRoot(document.getElementById("root"));
      window.sidebarEvents = [];
      window.sidebarProps = {
        current: { matches: [{ name: "Sol Ring", identified_by: "recent-hint", distance: 170,
          image: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="244" height="340"><rect width="244" height="340" fill="gray"/></svg>') }] },
        lookups: [], recognitionReports: [], chatMessages: [], currentUserId: "me",
        chatRecipients: [{id:"ann",name:"Ann",role:"player"},{id:"ann-marie",name:"Ann Marie",role:"visitor"}],
        chatParticipants: [{id:"me",name:"Me",role:"player"},{id:"ann",name:"Ann",role:"player"}],
        view: "lookup", collapsed: false, cameras: [], mics: [], tileColors: ["#d7ac3f"],
        themePreference: "dark", videoLayout: "tiles", outgoingVideoQuality: "1080p",
        counterPlayers: [{id:"me",name:"Me",isMe:true,poison:0},{id:"ann",name:"Ann",poison:0}],
        managementFriends: [], lobbyName: "Sidebar regression table",
        onViewChange: (view) => window.updateSidebar({view}),
        onOpen: () => window.updateSidebar({collapsed:false}),
        onClose: () => window.updateSidebar({collapsed:true}),
        onSendChat: (message) => { window.sidebarEvents.push(message); return {ok:true}; },
      };
      window.updateSidebar = (next) => {
        Object.assign(window.sidebarProps, next);
        root.render(<ConfirmDialogProvider><div className="game"><div className="main"><CardSidebar {...window.sidebarProps}/></div></div></ConfirmDialogProvider>);
      };
      window.updateSidebar({});
    `,
  },
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
  logLevel: "silent",
});
const styles = (await Promise.all([
  "src/styles.css", "src/AppDropdown.css", "src/ConfirmDialog.css",
].map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === "/styles.css") {
    response.writeHead(200, { "Content-Type": "text/css" });
    response.end(styles);
  } else if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  } else {
    // Autocomplete may warm its local index. It receives an empty fixture;
    // this test never accesses production, account APIs, or card services.
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("[]");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SNAPCAST_CHROME ? { executablePath: process.env.SNAPCAST_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://**/*", (route) => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole("button", { name: "Expand Sol Ring" })).toBeVisible();
  await expect(page.getByText("Image lookup failed", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/chat-view/);
  await page.getByRole("button", { name: "Open Commander damage" }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/chat-view/);
  assert.notEqual(await page.locator(".sidebar-content").evaluate((element) => getComputedStyle(element).overflowY), "hidden");
  await page.evaluate(() => window.updateSidebar({ chatMessages: [{ id: "incoming-1", from: "ann", name: "Ann", text: "While counters are open", at: Date.now() }] }));
  await expect(page.getByRole("button", { name: "Open chat, new messages" })).toBeVisible();
  await page.getByRole("button", { name: "Open chat, new messages" }).click();
  await expect(page.getByRole("button", { name: "Open chat", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.evaluate(() => window.updateSidebar({ chatMessages: Array.from({ length: 30 }, (_, i) => ({ id: "long-" + i, from: "ann", name: "Ann", text: "Incoming message " + i, at: Date.now() + i })) }));
  await expect(page.getByRole("button", { name: "Open chat, new messages" })).toBeVisible();
  await page.getByRole("button", { name: "Open chat, new messages" }).click();
  await expect.poll(() => page.locator(".chat-messages").evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);

  const chat = page.getByRole("textbox", { name: "Chat message", exact: true });
  await chat.fill("Hello while composing");
  await chat.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await page.evaluate(() => window.sidebarEvents.length), 0, "IME confirmation must not send the unfinished draft");
  await expect(chat).toHaveValue("Hello while composing");
  await chat.press("Enter");
  assert.equal(await page.evaluate(() => window.sidebarEvents[0].text), "Hello while composing");
  await chat.fill("/whisper @Ann Marie private hello");
  await chat.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.sidebarEvents[1]), {
    kind: "whisper", text: "private hello", targetId: "ann-marie", targetName: "Ann Marie", soundId: "",
  });
  assert.deepEqual(errors, [], "the sidebar must not throw while navigating and sending");
  console.log("OK: sidebar verified-card rendering, scrolling panels, hidden/collapsed unread chat, reopen scroll, IME input, and private prefix-name messages");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
