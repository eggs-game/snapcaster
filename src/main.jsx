import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ConfirmDialogProvider } from "./ConfirmDialog.jsx";
// The benchmark page pulls in SnapTest + the scene generator + the degradation
// harness (~1300 lines) that no player ever runs. Split it out so it is fetched
// only when /snaptest is opened.
const SnapTest = lazy(() => import("./SnapTest.jsx"));
const PublicGames = lazy(() => import("./PublicGames.jsx"));
const TurnTest = lazy(() => import("./TurnTest.jsx"));
const Privacy = lazy(() => import("./Privacy.jsx"));
const Terms = lazy(() => import("./Terms.jsx"));
const ProfilePage = lazy(() => import("./ProfilePage.jsx"));
const DeckPage = lazy(() => import("./DeckPage.jsx"));
const FriendsPage = lazy(() => import("./FriendsPage.jsx"));
const SettingsPage = lazy(() => import("./SettingsPage.jsx"));
const NotificationsPage = lazy(() => import("./NotificationsPage.jsx"));
const Community = lazy(() => import("./Community.jsx"));
const ModerationPage = lazy(() => import("./ModerationPage.jsx"));
import "./styles.css";

const BUILD = "isolation-cap-1 (candidate prep cap x0.5)";
window.__SNAP_BUILD = BUILD;
console.log(`%c[snapcast] build: ${BUILD}`, "color:#0a0;font-weight:bold");

// Recognition benchmark page at /snaptest (see snaptest/README.md).
const route = window.location.pathname.replace(/\/+$/, "");
const deckRoute = route.match(/^\/profile\/decks\/([0-9a-f-]{36})$/i);
const page = route === "/snaptest" ? <SnapTest />
  : route === "/turntest" ? <TurnTest />
  : route === "/privacy" ? <Privacy />
  : route === "/terms" ? <Terms />
  : route === "/games" || route === "/games/lobbies" || route === "/games/live" ? <PublicGames />
  : route === "/profile" ? <ProfilePage />
  : deckRoute ? <DeckPage deckId={deckRoute[1]} />
  : route === "/friends" ? <FriendsPage />
  : route === "/settings" ? <SettingsPage />
  : route === "/notifications" ? <NotificationsPage />
  : route === "/community" ? <Community />
  : route === "/moderation" ? <ModerationPage />
  : null;
createRoot(document.getElementById("root")).render(
  <ConfirmDialogProvider>
    {page
      ? <Suspense fallback={null}>{page}</Suspense>
      : <App />}
  </ConfirmDialogProvider>,
);
