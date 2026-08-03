import React from "react";
import { BarChart3, X } from "lucide-react";

export default function AccountPrompt({ onContinue, onDismiss, error = "" }) {
  return (
    <div className="lobby-modal-backdrop account-prompt-backdrop">
      <section
        className="lobby-modal account-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-prompt-title"
      >
        <button className="modal-close" onClick={onDismiss} aria-label="Close" data-tooltip="Close" data-tooltip-pos="right-bottom">
          <X size={20} />
        </button>
        <div className="account-prompt-icon" aria-hidden="true">
          <BarChart3 size={24} />
        </div>
        <header className="modal-head compact">
          <h2 id="account-prompt-title">Track your games and stats</h2>
          <p>
            Sign in with Discord to save game results, build your Commander record,
            and reconnect with people you enjoyed playing with.
          </p>
        </header>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <footer className="modal-actions account-prompt-actions">
          <button type="button" onClick={onDismiss}>Not now</button>
          <button className="primary discord-sign-in" type="button" onClick={onContinue}>
            Sign in with Discord
          </button>
        </footer>
      </section>
    </div>
  );
}
