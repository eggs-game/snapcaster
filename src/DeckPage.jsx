import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  LayoutGrid,
  Link2,
  List,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import AppToast from "./AppToast.jsx";
import {
  addCardToSavedDeck,
  deleteCardFromSavedDeck,
  getAccountSession,
  getSavedCommanderDeck,
  importSavedDeckFromText,
  importSavedDeckFromUrl,
  replaceCardInSavedDeck,
  signInWithDiscord,
  signOutAccount,
  updateCardInSavedDeck,
} from "./account.js";
import { parseDeckAttributionUrl, primaryCardType } from "./deckImport.js";

const BOARD_LABELS = {
  commander: "Commander",
  mainboard: "Main deck",
  sideboard: "Sideboard",
  maybeboard: "Considering",
};
const BOARD_ORDER = ["commander", "mainboard", "sideboard", "maybeboard"];
const TYPE_ORDER = ["Commander", "Creature", "Planeswalker", "Battle", "Sorcery", "Instant", "Artifact", "Enchantment", "Land", "Other"];
const TYPE_LABELS = {
  Creature: "Creatures",
  Planeswalker: "Planeswalkers",
  Battle: "Battles",
  Sorcery: "Sorceries",
  Instant: "Instants",
  Artifact: "Artifacts",
  Enchantment: "Enchantments",
  Land: "Lands",
  Other: "Other cards",
};

function cardImageUrl(card, version = "normal") {
  const params = new URLSearchParams({ format: "image", version });
  if (card?.scryfall_id) return `https://api.scryfall.com/cards/${encodeURIComponent(card.scryfall_id)}?${params}`;
  params.set("exact", card?.name || "Magic card");
  return `https://api.scryfall.com/cards/named?${params}`;
}

function groupLabel(card, groupBy) {
  if (groupBy === "board") return BOARD_LABELS[card.board] || BOARD_LABELS.mainboard;
  if (groupBy === "cmc") {
    if (primaryCardType(card.type_line) === "Land") return "Lands";
    return card.mana_value == null ? "Mana value unknown" : `Mana value ${Number(card.mana_value)}`;
  }
  if (card.board === "commander") return "Commander";
  const type = primaryCardType(card.type_line);
  return TYPE_LABELS[type] || type;
}

function groupSort(left, right, groupBy) {
  if (groupBy === "board") return BOARD_ORDER.indexOf(left.key) - BOARD_ORDER.indexOf(right.key);
  if (groupBy === "cmc") {
    if (left.label === "Lands") return 1;
    if (right.label === "Lands") return -1;
    const a = Number(left.label.replace(/\D/g, ""));
    const b = Number(right.label.replace(/\D/g, ""));
    return (Number.isFinite(a) ? a : 999) - (Number.isFinite(b) ? b : 999);
  }
  const leftType = Object.keys(TYPE_LABELS).find((type) => TYPE_LABELS[type] === left.label) || left.label;
  const rightType = Object.keys(TYPE_LABELS).find((type) => TYPE_LABELS[type] === right.label) || right.label;
  return TYPE_ORDER.indexOf(leftType) - TYPE_ORDER.indexOf(rightType);
}

export default function DeckPage({ deckId }) {
  const [account, setAccount] = useState(null);
  const [accountReady, setAccountReady] = useState(false);
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceAttribution, setSourceAttribution] = useState("");
  const [deckText, setDeckText] = useState("");
  const [cardName, setCardName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [board, setBoard] = useState("mainboard");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("text");
  const [groupBy, setGroupBy] = useState("type");
  const [sortBy, setSortBy] = useState("name");
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [replacementName, setReplacementName] = useState("");
  const [working, setWorking] = useState(false);
  const [busyCardId, setBusyCardId] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const dismissStatus = useCallback(() => setStatus(""), []);

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then(async (nextAccount) => {
        if (!active) return;
        setAccount(nextAccount);
        if (nextAccount) {
          const nextDeck = await getSavedCommanderDeck(nextAccount, deckId);
          if (!active) return;
          setDeck(nextDeck);
          setSourceAttribution(nextDeck?.source_url || "");
          setSourceUrl(nextDeck?.source_provider === "archidekt" ? nextDeck.source_url || "" : "");
          setSelectedCardId(nextDeck?.cards?.[0]?.id || null);
        }
      })
      .catch((loadError) => { if (active) setError(String(loadError?.message || "Could not load this deck.")); })
      .finally(() => {
        if (!active) return;
        setAccountReady(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [deckId]);

  const cards = deck?.cards || [];
  const selectedCard = cards.find((card) => card.id === selectedCardId) || cards[0] || null;
  const totalCards = cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
  const mainDeckCards = cards.filter((card) => card.board === "commander" || card.board === "mainboard")
    .reduce((sum, card) => sum + Number(card.quantity || 0), 0);
  const sideboardCards = cards.filter((card) => card.board === "sideboard")
    .reduce((sum, card) => sum + Number(card.quantity || 0), 0);
  const averageManaValue = useMemo(() => {
    const castable = cards.filter((card) => card.board === "mainboard" && card.mana_value != null && primaryCardType(card.type_line) !== "Land");
    const count = castable.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
    if (!count) return "—";
    const total = castable.reduce((sum, card) => sum + Number(card.quantity || 0) * Number(card.mana_value), 0);
    return (total / count).toFixed(2).replace(/\.00$/, "");
  }, [cards]);
  const moxfieldDeckUrl = useMemo(() => {
    if (!sourceAttribution.trim()) return "";
    try {
      const source = parseDeckAttributionUrl(sourceAttribution);
      return source.provider === "moxfield" ? source.url : "";
    } catch {
      return "";
    }
  }, [sourceAttribution]);

  const groups = useMemo(() => {
    const filtered = cards.filter((card) => card.name.toLocaleLowerCase("en-US").includes(query.trim().toLocaleLowerCase("en-US")));
    const grouped = new Map();
    for (const card of filtered) {
      const key = groupBy === "board" ? card.board : groupLabel(card, groupBy);
      if (!grouped.has(key)) grouped.set(key, { key, label: groupLabel(card, groupBy), cards: [] });
      grouped.get(key).cards.push(card);
    }
    for (const group of grouped.values()) {
      group.cards.sort((left, right) => sortBy === "cmc"
        ? (Number(left.mana_value ?? 999) - Number(right.mana_value ?? 999)) || left.name.localeCompare(right.name)
        : left.name.localeCompare(right.name));
    }
    return [...grouped.values()].sort((left, right) => groupSort(left, right, groupBy));
  }, [cards, groupBy, query, sortBy]);

  const applyCardResult = (result) => {
    if (!result?.card && !result?.removedId) return;
    setDeck((current) => {
      let nextCards = (current.cards || []).filter((card) => card.id !== result.removedId);
      if (result.card) {
        const index = nextCards.findIndex((card) => card.id === result.card.id);
        if (index >= 0) nextCards[index] = result.card;
        else nextCards.push(result.card);
      }
      return { ...current, cards: nextCards };
    });
    if (result.card) setSelectedCardId(result.card.id);
  };

  const runCardAction = async (card, action, successMessage) => {
    setError("");
    setStatus("");
    setBusyCardId(card.id);
    try {
      const result = await action();
      applyCardResult(result);
      if (successMessage) setStatus(successMessage(result));
    } catch (actionError) {
      setError(String(actionError?.message || "Card could not be updated."));
    } finally {
      setBusyCardId(null);
    }
  };

  const applyImport = async (kind) => {
    setError("");
    setStatus("");
    setWorking(true);
    try {
      const result = kind === "url"
        ? await importSavedDeckFromUrl(account, deck.id, sourceUrl)
        : await importSavedDeckFromText(account, deck.id, deckText, sourceAttribution);
      setDeck((current) => ({
        ...current,
        cards: result.cards,
        source_provider: result.sourceProvider,
        source_url: result.sourceUrl,
        imported_at: new Date().toISOString(),
      }));
      setSelectedCardId(result.cards[0]?.id || null);
      setSourceAttribution(result.sourceUrl || "");
      setSourceUrl(result.sourceProvider === "archidekt" ? result.sourceUrl || "" : "");
      setStatus(`${result.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)} cards imported${result.importedName ? ` from ${result.importedName}` : ""}.`);
      setPanel(null);
    } catch (importError) {
      setError(String(importError?.message || "Could not import that deck."));
    } finally {
      setWorking(false);
    }
  };

  const addCard = async (event) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setWorking(true);
    try {
      const result = await addCardToSavedDeck(account, deck.id, { name: cardName, quantity, board });
      applyCardResult(result);
      setCardName("");
      setQuantity(1);
      setStatus(`${result.card.name} added.`);
    } catch (addError) {
      setError(String(addError?.message || "Could not add that card."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="profile-page account-profile-page deck-editor-page">
      <SiteHeader
        account={account}
        accountReady={accountReady}
        accountError={error && !deck ? error : ""}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: window.location.pathname })}
        onSignOut={async () => { await signOutAccount(); window.location.href = "/"; }}
      />
      <section className="account-profile-page-shell deck-editor-shell">
        {loading ? (
          <p className="public-games-state">Loading deck…</p>
        ) : !account ? (
          <div className="games-empty account-profile-sign-in">
            <UserRound size={30} />
            <h1>Sign in to manage this deck</h1>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: window.location.pathname })}>Sign in with Discord</button>
          </div>
        ) : !deck ? (
          <div className="games-empty"><h1>Deck not found</h1><p>This deck may have been removed or belongs to another player.</p><a href="/profile">Back to profile</a></div>
        ) : (
          <>
            <a className="deck-editor-back" href="/profile"><ArrowLeft size={16} /> My decks</a>
            <header className="deck-editor-hero">
              <div>
                <h1>{deck.label}</h1>
                <p>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</p>
                {deck.source_url && <a className="deck-editor-source" href={deck.source_url} target="_blank" rel="noreferrer"><Link2 size={13} /> Imported from {deck.source_provider}</a>}
              </div>
              <div className="deck-editor-summary" aria-label={`${totalCards} cards`}>
                <strong>{totalCards}</strong>
                <span>{totalCards === 1 ? "card" : "cards"}</span>
              </div>
            </header>

            <section className="deck-builder-toolbar" aria-label="Deck controls">
              <label className="deck-builder-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find cards in this deck" /></label>
              <div className="deck-view-control" role="group" aria-label="Card view">
                <button type="button" className={view === "text" ? "selected" : ""} onClick={() => setView("text")} aria-label="Text view" title="Text view"><List size={17} /></button>
                <button type="button" className={view === "cards" ? "selected" : ""} onClick={() => setView("cards")} aria-label="Card view" title="Card view"><LayoutGrid size={17} /></button>
              </div>
              <label className="deck-builder-select"><span>Group</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="type">Type</option><option value="cmc">Mana value</option><option value="board">Section</option></select></label>
              <label className="deck-builder-select"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="name">Name</option><option value="cmc">Mana value</option></select></label>
              <button type="button" className="deck-builder-action" onClick={() => setPanel(panel === "import" ? null : "import")}><Download size={16} /> Import</button>
              <button type="button" className="deck-builder-action primary" onClick={() => setPanel(panel === "add" ? null : "add")}><Plus size={16} /> Add card</button>
            </section>

            {panel === "import" && (
              <section className="deck-editor-panel" aria-labelledby="deck-import-heading">
                <div className="deck-editor-section-heading"><div><h2 id="deck-import-heading">Import a deck list</h2><p>Importing replaces the current list. Snapcast never requests Moxfield automatically.</p></div><Download size={20} aria-hidden="true" /></div>
                <div className="deck-import-manual">
                  <label className="modal-field"><span>Original deck link <small>Optional attribution only</small></span><input type="url" value={sourceAttribution} onChange={(event) => setSourceAttribution(event.target.value)} placeholder="https://moxfield.com/decks/…" autoComplete="url" /></label>
                  {moxfieldDeckUrl && <a className="deck-open-provider" href={moxfieldDeckUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open deck in Moxfield</a>}
                  <p className="deck-provider-note">In the Moxfield tab, choose <strong>More → Export → Copy for Moxfield</strong>. Then return to Snapcast and paste the copied list below.</p>
                  <label className="modal-field"><span>Moxfield deck list</span><textarea value={deckText} onChange={(event) => setDeckText(event.target.value)} placeholder={"Commander\n1 The Astonishing Ant-Man\n\nMainboard\n1 Sol Ring"} rows={9} /></label>
                  <button className="primary" type="button" disabled={working || !deckText.trim()} onClick={() => applyImport("text")}><Download size={16} /> {working ? "Importing…" : "Import pasted list"}</button>
                </div>
                <details className="deck-text-fallback">
                  <summary>Import a public Archidekt link instead</summary>
                  <div className="deck-import-row">
                    <label className="modal-field"><span>Archidekt deck link</span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://archidekt.com/decks/…" autoComplete="url" /></label>
                    <button type="button" disabled={working || !sourceUrl.trim()} onClick={() => applyImport("url")}><Link2 size={16} /> {working ? "Importing…" : "Import Archidekt"}</button>
                  </div>
                </details>
              </section>
            )}

            {panel === "add" && (
              <section className="deck-editor-panel" aria-labelledby="deck-add-heading">
                <div className="deck-editor-section-heading"><div><h2 id="deck-add-heading">Add cards</h2><p>Search Scryfall by card name and choose where the card belongs.</p></div><Plus size={20} aria-hidden="true" /></div>
                <form className="deck-add-card-form" onSubmit={addCard}>
                  <label className="modal-field deck-card-name-field"><span>Card name</span><input value={cardName} onChange={(event) => setCardName(event.target.value)} maxLength={200} placeholder="Sol Ring" required /></label>
                  <label className="modal-field"><span>Quantity</span><input type="number" min="1" max="99" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
                  <label className="modal-field"><span>Section</span><select value={board} onChange={(event) => setBoard(event.target.value)}>{BOARD_ORDER.map((key) => <option value={key} key={key}>{BOARD_LABELS[key]}</option>)}</select></label>
                  <button className="primary" type="submit" disabled={working}>{working ? "Adding…" : "Add card"}</button>
                </form>
              </section>
            )}

            {error && <p className="modal-error deck-editor-message" role="alert">{error}</p>}
            <AppToast message={status} onDismiss={dismissStatus} />

            <div className="deck-builder-metrics" aria-label="Deck summary">
              <div><strong>{mainDeckCards}</strong><span>Main deck</span></div>
              <div><strong>{sideboardCards}</strong><span>Sideboard</span></div>
              <div><strong>{averageManaValue}</strong><span>Average mana value</span></div>
              <div><strong>{cards.length}</strong><span>Unique cards</span></div>
            </div>

            {totalCards === 0 ? (
              <div className="deck-cards-empty"><h3>This deck list is empty</h3><p>Import a public deck link or add cards one at a time.</p></div>
            ) : (
              <section className="deck-builder-workspace">
                <aside className="deck-card-inspector" aria-label="Selected card">
                  {selectedCard && (
                    <>
                      <img src={cardImageUrl(selectedCard)} alt={selectedCard.name} />
                      <div className="deck-card-inspector-copy">
                        <h2>{selectedCard.name}</h2>
                        <p>{selectedCard.type_line || "Card details"}{selectedCard.mana_value != null ? ` · MV ${Number(selectedCard.mana_value)}` : ""}</p>
                      </div>
                      <div className="deck-card-inspector-fields">
                        <label><span>Quantity</span><div className="deck-quantity-control"><button type="button" aria-label={`Decrease ${selectedCard.name} quantity`} disabled={busyCardId === selectedCard.id || selectedCard.quantity <= 1} onClick={() => runCardAction(selectedCard, () => updateCardInSavedDeck(account, deck.id, selectedCard.id, { quantity: selectedCard.quantity - 1, board: selectedCard.board }), () => "Quantity updated.")}><Minus size={15} /></button><strong>{selectedCard.quantity}</strong><button type="button" aria-label={`Increase ${selectedCard.name} quantity`} disabled={busyCardId === selectedCard.id} onClick={() => runCardAction(selectedCard, () => updateCardInSavedDeck(account, deck.id, selectedCard.id, { quantity: selectedCard.quantity + 1, board: selectedCard.board }), () => "Quantity updated.")}><Plus size={15} /></button></div></label>
                        <label><span>Section</span><select value={selectedCard.board} disabled={busyCardId === selectedCard.id} onChange={(event) => runCardAction(selectedCard, () => updateCardInSavedDeck(account, deck.id, selectedCard.id, { quantity: selectedCard.quantity, board: event.target.value }), () => "Card moved.")}>{BOARD_ORDER.map((key) => <option value={key} key={key}>{BOARD_LABELS[key]}</option>)}</select></label>
                      </div>
                      <form className="deck-replace-card" onSubmit={(event) => {
                        event.preventDefault();
                        if (!replacementName.trim()) return;
                        runCardAction(selectedCard, () => replaceCardInSavedDeck(account, deck.id, selectedCard.id, replacementName), (result) => `${result.card.name} swapped in.`);
                        setReplacementName("");
                      }}>
                        <label><span>Swap this card</span><input value={replacementName} onChange={(event) => setReplacementName(event.target.value)} placeholder="Replacement card name" /></label>
                        <button type="submit" disabled={busyCardId === selectedCard.id || !replacementName.trim()}><RefreshCw size={15} /> Swap card</button>
                      </form>
                      <button className="deck-remove-card" type="button" disabled={busyCardId === selectedCard.id} onClick={() => {
                        if (!window.confirm(`Remove ${selectedCard.name} from this deck?`)) return;
                        runCardAction(selectedCard, () => deleteCardFromSavedDeck(account, deck.id, selectedCard.id), () => `${selectedCard.name} removed.`);
                      }}><Trash2 size={15} /> Remove card</button>
                    </>
                  )}
                </aside>

                <div className={`deck-card-library is-${view}`} aria-label="Deck cards">
                  {groups.length === 0 ? <div className="deck-cards-empty"><h3>No matching cards</h3><p>Try a different search.</p></div> : groups.map((group) => (
                    <section className="deck-card-section" key={group.key}>
                      <header><h3>{group.label}</h3><span>{group.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)}</span></header>
                      <div className={view === "cards" ? "deck-visual-grid" : "deck-card-list"}>
                        {group.cards.map((card) => view === "cards" ? (
                          <button type="button" className={`deck-visual-card${card.id === selectedCard?.id ? " selected" : ""}`} key={card.id} onClick={() => setSelectedCardId(card.id)}>
                            <img src={cardImageUrl(card)} alt="" loading="lazy" />
                            <span>{card.quantity > 1 ? `${card.quantity}× ` : ""}{card.name}</span>
                          </button>
                        ) : (
                          <button type="button" className={`deck-card-row${card.id === selectedCard?.id ? " selected" : ""}`} key={card.id} onClick={() => setSelectedCardId(card.id)}>
                            <span className="deck-card-quantity">{card.quantity}</span>
                            <strong>{card.name}</strong>
                            <span className="deck-card-mana">{card.mana_value == null ? "—" : Number(card.mana_value)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
