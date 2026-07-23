import React from "react";

const YEAR = new Date().getFullYear();

export default function SiteFooter({ compact = false }) {
  return (
    <footer className={`site-footer${compact ? " site-footer-compact" : ""}`}>
      <nav className="site-footer-nav" aria-label="Legal">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
      <p className="site-footer-copy">
        © {YEAR} Snapcast. Unofficial fan project — not affiliated with Wizards of the Coast.
        Card data via{" "}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">Scryfall</a>.
      </p>
    </footer>
  );
}
