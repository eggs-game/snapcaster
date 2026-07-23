import React from "react";
import SiteFooter from "./SiteFooter.jsx";

export default function LegalPage({ title, updated, children }) {
  return (
    <main className="lobby-home legal-page">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
      </header>
      <article className="legal-doc" aria-labelledby="legal-title">
        <header className="legal-doc-head">
          <h1 id="legal-title">{title}</h1>
          {updated && <p className="legal-updated">Last updated {updated}</p>}
        </header>
        <div className="legal-doc-body">
          {children}
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
