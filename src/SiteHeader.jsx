import React, { useState } from "react";
import { Bell, LogIn, LogOut, Settings, Users, UserRound } from "lucide-react";
import { accountDisplayName } from "./account.js";

export default function SiteHeader({
  account,
  accountReady = true,
  accountError = "",
  notificationCount = 0,
  onCreate,
  onJoin,
  onSignIn,
  onSignOut,
}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="site-brand" href="/">Snapcast</a>
      <nav className="home-header-actions" aria-label="Game actions">
        <button className="home-header-create" type="button" onClick={onCreate}>Create</button>
        <button className="home-header-join" type="button" onClick={onJoin}>Join</button>
      </nav>
      <div className="site-account">
        {account ? (
          <>
            <button
              className="site-account-button"
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-expanded={accountMenuOpen}
            >
              <span>{accountDisplayName(account)}</span>
              {notificationCount > 0 && (
                <span className="site-notification-badge" aria-label={`${notificationCount} unread notifications`}>
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </button>
            {accountMenuOpen && (
              <div className="site-account-menu">
                <a href="/profile"><UserRound size={16} />Profile</a>
                <a href="/friends"><Users size={16} />Friends</a>
                <a href="/settings"><Settings size={16} />Settings</a>
                <a href="/notifications">
                  <Bell size={16} />
                  <span>Notifications</span>
                  {notificationCount > 0 && <strong>{notificationCount > 9 ? "9+" : notificationCount}</strong>}
                </a>
                <button type="button" onClick={() => onSignOut?.()}>
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            )}
          </>
        ) : accountReady ? (
          <>
            <button className="site-discord-button" type="button" onClick={onSignIn}>
              <LogIn size={17} />
              Sign in with Discord
            </button>
            {accountError && (
              <p className="site-account-error" role="alert">{accountError}</p>
            )}
          </>
        ) : null}
      </div>
    </header>
  );
}
