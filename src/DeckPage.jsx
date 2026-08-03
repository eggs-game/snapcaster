import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Copy,
  Download,
  ExternalLink,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import AppToast from "./AppToast.jsx";
import AppDropdown from "./AppDropdown.jsx";
import { useConfirmDialog } from "./ConfirmDialog.jsx";
import {
  addCardToSavedDeck,
  deleteCardFromSavedDeck,
  getAccountSession,
  getPublicSavedDeck,
  getSavedCommanderDeck,
  importSavedDeckFromText,
  importSavedDeckFromUrl,
  signInWithDiscord,
  signOutAccount,
  updateCardPrintingInSavedDeck,
} from "./account.js";
import { parseDeckAttributionUrl, primaryCardType } from "./deckImport.js";
import { fetchCardPrintings } from "./cardSearch.js";
import {
  buildColorBreakdown,
  buildManaCurve,
  buildTypeBreakdown,
  formatDeckText,
  shuffleMainDeck,
} from "./deckAnalysis.js";

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
const EMPTY_CARDS = [];

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
  if (groupBy === "tag") {
    if (left.label === "Commander") return -1;
    if (right.label === "Commander") return 1;
    if (left.label.startsWith("Untagged")) return 1;
    if (right.label.startsWith("Untagged")) return -1;
    return left.label.localeCompare(right.label);
  }
  const leftType = Object.keys(TYPE_LABELS).find((type) => TYPE_LABELS[type] === left.label) || left.label;
  const rightType = Object.keys(TYPE_LABELS).find((type) => TYPE_LABELS[type] === right.label) || right.label;
  return TYPE_ORDER.indexOf(leftType) - TYPE_ORDER.indexOf(rightType);
}

function printingImageUrl(printing) {
  return printing?.image_uris?.normal || printing?.card_faces?.[0]?.image_uris?.normal || "";
}

export default function DeckPage({ deckId }) {
  const confirmAction = useConfirmDialog();
  const [account, setAccount] = useState(null);
  const [accountReady, setAccountReady] = useState(false);
  const [deck, setDeck] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
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
  const [pageView, setPageView] = useState("deck");
  const [groupBy, setGroupBy] = useState("type");
  const [sortBy, setSortBy] = useState("name");
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [printings, setPrintings] = useState([]);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const [artLoading, setArtLoading] = useState(false);
  const [sampleHand, setSampleHand] = useState([]);
  const [sampleLibrary, setSampleLibrary] = useState([]);
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
        const ownedDeck = nextAccount ? await getSavedCommanderDeck(nextAccount, deckId) : null;
        const nextDeck = ownedDeck || await getPublicSavedDeck(deckId);
        if (!active) return;
        setCanEdit(Boolean(ownedDeck));
        setDeck(nextDeck);
        setSourceAttribution(nextDeck?.source_url || "");
        setSourceUrl(nextDeck?.source_provider === "archidekt" ? nextDeck.source_url || "" : "");
        setSelectedCardId(nextDeck?.cards?.[0]?.id || null);
      })
      .catch((loadError) => { if (active) setError(String(loadError?.message || "Could not load this deck.")); })
      .finally(() => {
        if (!active) return;
        setAccountReady(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [deckId]);

  const cards = deck?.cards || EMPTY_CARDS;
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
  const manaCurve = useMemo(() => buildManaCurve(cards), [cards]);
  const typeBreakdown = useMemo(() => buildTypeBreakdown(cards), [cards]);
  const colorBreakdown = useMemo(() => buildColorBreakdown(cards), [cards]);
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
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    const filtered = cards.filter((card) => !normalizedQuery
      || card.name.toLocaleLowerCase("en-US").includes(normalizedQuery)
      || (card.tags || []).some((tag) => tag.toLocaleLowerCase("en-US").includes(normalizedQuery)));
    const grouped = new Map();
    for (const card of filtered) {
      const labels = groupBy === "tag"
        ? card.board === "commander"
          ? ["Commander"]
          : (card.tags || []).length
            ? card.tags
            : [primaryCardType(card.type_line) === "Land" ? "Untagged lands" : "Untagged"]
        : [groupLabel(card, groupBy)];
      for (const label of labels) {
        const key = groupBy === "board" ? card.board : label;
        if (!grouped.has(key)) grouped.set(key, { key, label, cards: [] });
        grouped.get(key).cards.push(card);
      }
    }
    for (const group of grouped.values()) {
      group.cards.sort((left, right) => sortBy === "cmc"
        ? (Number(left.mana_value ?? 999) - Number(right.mana_value ?? 999)) || left.name.localeCompare(right.name)
        : left.name.localeCompare(right.name));
    }
    return [...grouped.values()].sort((left, right) => groupSort(left, right, groupBy));
  }, [cards, groupBy, query, sortBy]);

  const textGroupColumns = useMemo(() => {
    const columns = Array.from({ length: 3 }, () => ({ groups: [], weight: 0 }));
    for (const group of groups) {
      const column = columns.reduce((lightest, candidate) => (
        candidate.weight < lightest.weight ? candidate : lightest
      ));
      column.groups.push(group);
      column.weight += group.cards.length + 1;
    }
    return columns.map((column) => column.groups);
  }, [groups]);

  const dealHand = useCallback(() => {
    const library = shuffleMainDeck(cards);
    setSampleHand(library.slice(0, 7));
    setSampleLibrary(library.slice(7));
  }, [cards]);

  useEffect(() => {
    if (cards.length) dealHand();
    else {
      setSampleHand([]);
      setSampleLibrary([]);
    }
  }, [cards, dealHand]);

  useEffect(() => {
    setArtPickerOpen(false);
    setPrintings([]);
  }, [selectedCardId]);

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
        : await importSavedDeckFromText(account, deck.id, deckText, sourceAttribution, "moxfield");
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

  const copyDeckList = async () => {
    try {
      await navigator.clipboard.writeText(formatDeckText(cards));
      setStatus("Deck list copied.");
    } catch {
      setError("The deck list could not be copied.");
    }
  };

  const toggleArtPicker = async () => {
    if (!selectedCard) return;
    if (artPickerOpen) {
      setArtPickerOpen(false);
      return;
    }
    setArtPickerOpen(true);
    setArtLoading(true);
    setError("");
    try {
      setPrintings(await fetchCardPrintings(selectedCard));
    } catch {
      setError("Card artwork could not be loaded.");
      setPrintings([]);
    } finally {
      setArtLoading(false);
    }
  };

  const choosePrinting = (printing) => runCardAction(
    selectedCard,
    () => updateCardPrintingInSavedDeck(account, deck.id, selectedCard.id, printing.id),
    () => {
      setArtPickerOpen(false);
      return `Artwork changed to ${printing.set_name || String(printing.set || "").toUpperCase()}.`;
    },
  );

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
        ) : !deck ? (
          <div className="games-empty"><h1>Deck not found</h1><p>This deck may have been removed or belongs to another player.</p><a href="/profile">Back to profile</a></div>
        ) : (
          <>
            <a className="deck-editor-back" href={canEdit ? "/profile" : `/profile?id=${encodeURIComponent(deck.owner?.id || "")}`}>
              <ArrowLeft size={16} /> {canEdit ? "My decks" : `${deck.owner?.display_name || "Player"}'s profile`}
            </a>
            <header className="deck-editor-hero">
              <div>
                <h1>{deck.label}</h1>
                <p>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</p>
                {!canEdit && deck.owner && <a className="deck-editor-owner" href={`/profile?id=${encodeURIComponent(deck.owner.id)}`}>Deck by {deck.owner.display_name}</a>}
                {deck.source_url && <a className="deck-editor-source" href={deck.source_url} target="_blank" rel="noreferrer"><Link2 size={13} /> Imported from {deck.source_provider}</a>}
              </div>
              <div className="deck-editor-summary" aria-label={`${totalCards} cards`}>
                <strong>{totalCards}</strong>
                <span>{totalCards === 1 ? "card" : "cards"}</span>
              </div>
            </header>

            <div className="account-page-tabs deck-editor-tabs" role="tablist" aria-label="Deck views">
              <button type="button" role="tab" aria-selected={pageView === "deck"} onClick={() => setPageView("deck")}>Deck list</button>
              <button type="button" role="tab" aria-selected={pageView === "analysis"} onClick={() => setPageView("analysis")}>Analysis &amp; hand</button>
            </div>

            {error && <p className="modal-error deck-editor-message" role="alert">{error}</p>}
            <AppToast message={status} onDismiss={dismissStatus} />

            {pageView === "deck" ? (
              <>
            <section className="deck-builder-toolbar" aria-label="Deck controls">
              <label className="deck-builder-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find cards in this deck" /></label>
              <div className="deck-builder-select"><span>Group</span><AppDropdown label="Group cards" value={groupBy} onChange={setGroupBy} options={[{ value: "tag", label: "Tag" }, { value: "type", label: "Type" }, { value: "cmc", label: "Mana value" }, { value: "board", label: "Section" }]} /></div>
              <div className="deck-builder-select"><span>Sort</span><AppDropdown label="Sort cards" value={sortBy} onChange={setSortBy} options={[{ value: "name", label: "Name" }, { value: "cmc", label: "Mana value" }]} /></div>
              <button type="button" className="deck-builder-action" onClick={copyDeckList}><Copy size={16} /> Copy list</button>
              {canEdit && <button type="button" className="deck-builder-action" onClick={() => setPanel(panel === "import" ? null : "import")}><Download size={16} /> Import</button>}
              {canEdit && <button type="button" className="deck-builder-action primary" onClick={() => setPanel(panel === "add" ? null : "add")}><Plus size={16} /> Add card</button>}
              <div className="deck-view-control" role="group" aria-label="Card view">
                <button type="button" className={view === "text" ? "selected" : ""} onClick={() => setView("text")} aria-label="Text view" data-tooltip="Text view"><List size={17} /></button>
                <button type="button" className={view === "cards" ? "selected" : ""} onClick={() => setView("cards")} aria-label="Card view" data-tooltip="Card view"><LayoutGrid size={17} /></button>
              </div>
            </section>

            {panel === "import" && (
              <section className="deck-editor-panel" aria-labelledby="deck-import-heading">
                <div className="deck-editor-section-heading"><div><h2 id="deck-import-heading">Import a deck list</h2><p>Importing replaces the current list. Snapcast never requests Moxfield automatically.</p></div><Download size={20} aria-hidden="true" /></div>
                <div className="deck-import-manual">
                  <label className="modal-field"><span>Original deck link <small>Optional attribution only</small></span><input type="url" value={sourceAttribution} onChange={(event) => setSourceAttribution(event.target.value)} placeholder="https://moxfield.com/decks/…" autoComplete="url" /></label>
                  {moxfieldDeckUrl && <a className="deck-open-provider" href={moxfieldDeckUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open deck in Moxfield</a>}
                  <p className="deck-provider-note">In the Moxfield tab, choose <strong>More → Export → Copy for Moxfield</strong>. Then return to Snapcast and paste the copied list below.</p>
                  <label className="modal-field"><span>Moxfield deck list</span><textarea value={deckText} onChange={(event) => setDeckText(event.target.value)} placeholder={"Commander\n1 The Astonishing Ant-Man\n\nMainboard\n1 Sol Ring #!Ramp"} rows={9} /></label>
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
                  <div className="modal-field"><span>Section</span><AppDropdown label="Deck section" value={board} onChange={setBoard} options={BOARD_ORDER.map((key) => ({ value: key, label: BOARD_LABELS[key] }))} /></div>
                  <button className="primary" type="submit" disabled={working}>{working ? "Adding…" : "Add card"}</button>
                </form>
              </section>
            )}

            {totalCards === 0 ? (
              <div className="deck-cards-empty"><h3>This deck list is empty</h3><p>{canEdit ? "Import a public deck link or add cards one at a time." : "This player has not added cards to this deck yet."}</p></div>
            ) : (
              <section className="deck-builder-workspace">
                <aside className="deck-card-inspector" aria-label="Selected card">
                  {selectedCard && (
                    <>
                      <img src={cardImageUrl(selectedCard)} alt={selectedCard.name} />
                      <div className="deck-card-inspector-copy">
                        <h2>{selectedCard.name}</h2>
                        {canEdit && (
                          <details className="deck-card-actions">
                            <summary aria-label="Card options" data-tooltip="Card options"><MoreHorizontal size={16} aria-hidden="true" /></summary>
                            <div>
                              <button type="button" disabled={artLoading || busyCardId === selectedCard.id} onClick={toggleArtPicker}><Palette size={15} /> {artLoading ? "Loading art…" : "Change artwork"}</button>
                              <button className="danger" type="button" disabled={busyCardId === selectedCard.id} onClick={async () => {
                                if (!(await confirmAction({
                                  title: `Remove ${selectedCard.name}?`,
                                  description: "This card will be removed from the deck list.",
                                  confirmLabel: "Remove card",
                                  tone: "danger",
                                }))) return;
                                runCardAction(selectedCard, () => deleteCardFromSavedDeck(account, deck.id, selectedCard.id), () => `${selectedCard.name} removed.`);
                              }}><Trash2 size={15} /> Remove card</button>
                            </div>
                          </details>
                        )}
                      </div>
                      {canEdit && artPickerOpen && (
                        <div className="deck-art-picker" aria-label={`Artwork for ${selectedCard.name}`}>
                          <div className="deck-art-picker-heading"><strong>Choose artwork</strong><button type="button" onClick={() => setArtPickerOpen(false)} aria-label="Close artwork picker" data-tooltip="Close"><X size={15} /></button></div>
                          {artLoading ? <p>Loading printings…</p> : printings.length ? (
                            <div className="deck-art-grid">
                              {printings.map((printing) => (
                                <button type="button" key={printing.id} className={printing.id === selectedCard.scryfall_id ? "selected" : ""} onClick={() => choosePrinting(printing)} disabled={busyCardId === selectedCard.id}>
                                  <img src={printingImageUrl(printing)} alt={`${printing.name}, ${printing.set_name}`} loading="lazy" />
                                  <span>{String(printing.set || "").toUpperCase()} · {printing.collector_number}</span>
                                </button>
                              ))}
                            </div>
                          ) : <p>No alternate artwork found.</p>}
                        </div>
                      )}
                      {!canEdit && (
                        <dl className="deck-card-readonly-facts">
                          <div><dt>Quantity</dt><dd>{selectedCard.quantity}</dd></div>
                          <div><dt>Section</dt><dd>{BOARD_LABELS[selectedCard.board] || BOARD_LABELS.mainboard}</dd></div>
                        </dl>
                      )}
                    </>
                  )}
                </aside>

                <div className={`deck-card-library is-${view}`} aria-label="Deck cards">
                  {groups.length === 0 ? (
                    <div className="deck-cards-empty"><h3>No matching cards</h3><p>Try a different search.</p></div>
                  ) : view === "text" ? textGroupColumns.map((column, columnIndex) => (
                    <div className="deck-card-column" key={columnIndex}>
                      {column.map((group) => (
                        <section className="deck-card-section" key={group.key}>
                          <header><h3>{group.label}</h3><span>{group.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)}</span></header>
                          <div className="deck-card-list">
                            {group.cards.map((card) => (
                              <button type="button" className={`deck-card-row${card.id === selectedCard?.id ? " selected" : ""}`} key={card.id} onClick={() => setSelectedCardId(card.id)}>
                                <span className="deck-card-quantity">{card.quantity}</span>
                                <span className="deck-card-row-copy"><strong>{card.name}</strong>{!!(card.tags || []).length && <small>{card.tags.join(" · ")}</small>}</span>
                                <span className="deck-card-mana">{card.mana_value == null ? "—" : Number(card.mana_value)}</span>
                              </button>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )) : groups.map((group) => (
                    <section className="deck-card-section" key={group.key}>
                      <header><h3>{group.label}</h3><span>{group.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)}</span></header>
                      <div className="deck-visual-grid">
                        {group.cards.map((card) => (
                          <button type="button" className={`deck-visual-card${card.id === selectedCard?.id ? " selected" : ""}`} key={card.id} onClick={() => setSelectedCardId(card.id)}>
                            <img src={cardImageUrl(card)} alt="" loading="lazy" />
                            <span>{card.quantity > 1 ? `${card.quantity}× ` : ""}{card.name}</span>
                            {!!(card.tags || []).length && <small>{card.tags.join(" · ")}</small>}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            )}
              </>
            ) : (
              <section className="deck-analysis-dashboard" aria-label="Deck analysis">
                <div className="deck-builder-metrics" aria-label="Deck summary">
                  <div><strong>{mainDeckCards}</strong><span>Main deck</span></div>
                  <div><strong>{sideboardCards}</strong><span>Sideboard</span></div>
                  <div><strong>{averageManaValue}</strong><span>Average mana value</span></div>
                  <div><strong>{cards.length}</strong><span>Unique cards</span></div>
                </div>
                <div className="deck-analysis-grid">
                  <article className="deck-analysis-panel deck-mana-curve">
                    <header><div><h2>Mana value</h2><p>Nonland cards in the main deck and command zone.</p></div><BarChart3 size={19} /></header>
                    <div className="deck-mana-bars">
                      {manaCurve.map((entry) => {
                        const maximum = Math.max(1, ...manaCurve.map((item) => item.count));
                        return <div className="deck-mana-column" key={entry.label}><strong>{entry.count}</strong><span className="deck-mana-track"><i style={{ height: `${Math.round((entry.count / maximum) * 100)}%` }} /></span><small>{entry.label}</small></div>;
                      })}
                    </div>
                  </article>
                  <article className="deck-analysis-panel">
                    <header><div><h2>Card types</h2><p>Quantity across the main deck and command zone.</p></div></header>
                    <div className="deck-breakdown-list">
                      {typeBreakdown.map((entry) => <div key={entry.key}><span>{entry.label}</span><i><b style={{ width: `${Math.round((entry.count / Math.max(1, mainDeckCards)) * 100)}%` }} /></i><strong>{entry.count}</strong></div>)}
                    </div>
                  </article>
                  <article className="deck-analysis-panel deck-color-analysis">
                    <header><div><h2>Card colors</h2><p>Nonland cards can contribute to more than one color.</p></div></header>
                    <div className="deck-color-grid">
                      {colorBreakdown.map((entry) => <div key={entry.key}><span className={`deck-color-symbol is-${entry.key}`}>{entry.key}</span><span><strong>{entry.percentage}%</strong><small>{entry.label} · {entry.count}</small></span></div>)}
                    </div>
                  </article>
                  <article className="deck-analysis-panel deck-sample-hand">
                    <header><div><h2>Sample hand</h2><p>{sampleLibrary.length} cards remain in the shuffled library.</p></div><div className="deck-sample-actions"><button type="button" onClick={dealHand}><Shuffle size={15} /> Deal again</button><button type="button" disabled={!sampleLibrary.length} onClick={() => { setSampleHand((hand) => [...hand, sampleLibrary[0]]); setSampleLibrary((library) => library.slice(1)); }}>Draw one</button></div></header>
                    <div className="deck-sample-cards">
                      {sampleHand.map((card) => <figure key={card.drawKey}><img src={cardImageUrl(card)} alt={card.name} /><figcaption>{card.name}</figcaption></figure>)}
                    </div>
                  </article>
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
