import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Drum, ExternalLink, MessageCircle, MessagesSquare, Mic, MoreVertical,
  PanelLeft, Play, Search, Settings, Users, Video,
} from "lucide-react";

const CARD_IDS = {
  giada: "bae077bd-fc8d-44d7-8c75-8dc8699c168e",
  lyraDawnbringer: "a2e0c8c5-ea0e-4347-b5cb-b7b1801a523b",
  righteousValkyrie: "02fb5f9f-8750-4eb5-a03a-6dacc60e0b90",
  youthfulValkyrie: "9d795f79-c3a5-4ea1-a5cf-1ce73d6837b6",
  pearlMedallion: "1225264f-b298-4b56-b208-c5da87bd6867",
  heraldsHorn: "07b06421-778a-4d23-862b-30fc5fa25928",
  smotheringTithe: "f25a4bbe-2af0-4d4a-95d4-d52c5937c747",
  seraphSanctuary: "f903b04a-2733-4ce7-9d83-9db8d5e1e10d",
  plainsA: "7cfd53b2-3991-4a57-81b5-46618aecce4a",
  plainsB: "c95e9696-6e9d-462a-a40e-117df77e3909",
  ghalta: "0104b5b3-9376-4ad7-9a77-3e564e9c42e6",
  topiaryStomper: "87bb2699-280f-4e1e-b3f8-73efe6088f31",
  goreclaw: "36d4574a-3266-4497-b145-fb25820d8a7f",
  gigantosaurus: "c1db84d8-d426-4c0d-b44e-5be7b0f5f5bf",
  garruksUprising: "7de1015f-8371-4fa6-817f-d10d11d50093",
  lightningGreaves: "e6cec97f-0a2b-4543-a02e-d5e42d337790",
  greatHenge: "af915ed2-1f34-43f6-85f5-2430325b720f",
  mosswortBridge: "cbc74505-4d75-4bae-bf43-ec08731dfdd9",
  forestA: "d99d5685-538d-4e6a-809b-3ebeab634363",
  forestB: "b70e30de-fc01-4512-b218-a1411cb50789",
  krenko: "aa078518-0ce2-4c6f-9061-aa7e22ed7493",
  goblinWarchief: "5bac033c-dc4e-40a0-b103-4892e4b50249",
  skirkProspector: "7bc508b3-8b38-4cf0-89a7-a2cb247ed083",
  goblinMatron: "2092e6db-1196-43bf-b7c9-07498fa7ca90",
  impactTremors: "56fb4035-197b-4d28-9bf7-bb62c304067e",
  skullclamp: "04733881-38a3-404c-837f-fad3fc5a5647",
  thousandYearElixir: "2b6ccfdc-acfb-4e73-a583-0c6964b86083",
  castleEmbereth: "8bb8512e-6913-4be6-8828-24cfcbec042e",
  mountainA: "a7aae748-27d8-48f8-beb2-8e0192d7cc5c",
  mountainB: "253c7d53-e34b-493b-8d46-da946245bebb",
  sai: "19316cbb-d1af-4ab7-b588-78637503e986",
  etheriumSculptor: "0d050f2d-bd65-4ab9-9ea6-9deba91b2792",
  foundryInspector: "9a0bd043-ae62-41fe-a33b-989acd89b175",
  steelOverseer: "3fb27f1e-21fb-4017-8ef2-37c3206003e3",
  efficientConstruction: "abfbe1d5-beb7-49b8-a504-f1cc47ee4731",
  thopterSpyNetwork: "d85d7885-8c2b-44e9-aa78-40471de15f71",
  rhysticStudy: "9f37c5b6-a59c-45cd-9a99-e9357fe9ea1b",
  seatOfTheSynod: "4277ebca-1c8d-4066-969a-28adf6445b3e",
  islandA: "b74648fc-587c-4d20-9432-58465bd7dca9",
  islandB: "8a5328db-c55a-488d-b085-fcfa7be184ca",
};

function scryfallCardImage(id) {
  return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
}

const PREVIEW_PLAYERS = [
  {
    name: "Maya", commander: "Sai, Master Thopterist", commanderCard: CARD_IDS.sai,
    life: 31, color: "#6b79cc", pips: ["U"],
    creatures: [CARD_IDS.etheriumSculptor, CARD_IDS.foundryInspector, CARD_IDS.steelOverseer],
    supports: [CARD_IDS.efficientConstruction, CARD_IDS.thopterSpyNetwork, CARD_IDS.skullclamp],
    lands: [CARD_IDS.seatOfTheSynod, CARD_IDS.islandA, CARD_IDS.islandB, CARD_IDS.islandA, CARD_IDS.islandB, CARD_IDS.islandA],
  },
  {
    name: "Drew", commander: "Krenko, Mob Boss", commanderCard: CARD_IDS.krenko,
    life: 24, color: "#ad5151", pips: ["R"],
    creatures: [CARD_IDS.goblinWarchief, CARD_IDS.skirkProspector, CARD_IDS.goblinMatron],
    supports: [CARD_IDS.impactTremors, CARD_IDS.skullclamp, CARD_IDS.thousandYearElixir],
    lands: [CARD_IDS.castleEmbereth, CARD_IDS.mountainA, CARD_IDS.mountainB, CARD_IDS.mountainA, CARD_IDS.mountainB, CARD_IDS.mountainA],
  },
  {
    name: "Sam", commander: "Giada, Font of Hope", commanderCard: CARD_IDS.giada,
    life: 38, color: "#c8a94e", pips: ["W"], active: true, bottom: true,
    creatures: [CARD_IDS.lyraDawnbringer, CARD_IDS.righteousValkyrie, CARD_IDS.youthfulValkyrie],
    supports: [CARD_IDS.pearlMedallion, CARD_IDS.heraldsHorn, CARD_IDS.smotheringTithe],
    lands: [CARD_IDS.seraphSanctuary, CARD_IDS.plainsA, CARD_IDS.plainsB, CARD_IDS.plainsA, CARD_IDS.plainsB, CARD_IDS.plainsA],
  },
  {
    name: "Nora", commander: "Ghalta, Primal Hunger", commanderCard: CARD_IDS.ghalta,
    life: 17, color: "#4e8d71", pips: ["G"], bottom: true,
    creatures: [CARD_IDS.topiaryStomper, CARD_IDS.goreclaw, CARD_IDS.gigantosaurus],
    supports: [CARD_IDS.garruksUprising, CARD_IDS.lightningGreaves, CARD_IDS.greatHenge],
    lands: [CARD_IDS.mosswortBridge, CARD_IDS.forestA, CARD_IDS.forestB, CARD_IDS.forestA, CARD_IDS.forestB, CARD_IDS.forestA],
  },
];

const MANA_COLORS = {
  W: "#c9c2aa", U: "#4f88b8", B: "#3d3a38", R: "#b5463e", G: "#4a7853",
};

function CardStackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15.1 2.8 6.1 2.6-4.1 12.1-2.7-1.1" />
      <rect x="3.5" y="2.5" width="11" height="16" rx="1.5" />
      <path d="M6.3 7.5h5.4M6.3 11h5.4" />
    </svg>
  );
}

function DeckBack({ mana }) {
  return (
    <span className={`home-preview-deck home-preview-deck-${mana}`} aria-hidden="true">
      <span className="home-preview-deck-layer home-preview-deck-layer-back" />
      <span className="home-preview-deck-layer home-preview-deck-layer-edge" />
      <span className="home-preview-deck-layer home-preview-deck-layer-face" />
    </span>
  );
}

function PreviewChatMessage({ name, color, children, delay = 0, kind = "", sound = false }) {
  return (
    <div className="chat-message-row home-preview-chat-message" style={{ "--message-delay": `${delay}ms` }}>
      <div className="chat-message-wrap">
        <div className="chat-message-header">
          <strong style={{ color }}>{name}</strong>
          <span className="chat-message-timestamp">8:42 PM</span>
        </div>
        <div className={`chat-message${kind ? ` object ${kind}` : ""}${sound ? " sound" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function PreviewTile({ player, index }) {
  const lifePosition = index === 0
    ? { background: player.color, right: 0, borderRadius: "8px 0 0 0" }
    : index === 1
      ? { background: player.color, left: 0, borderRadius: "0 8px 0 0" }
      : index === 2
        ? { background: player.color, top: 0, bottom: "auto", right: 0, borderRadius: "0 0 0 8px" }
        : { background: player.color, top: 0, bottom: "auto", left: 0, borderRadius: "0 0 8px 0" };

  return (
    <article
      className={`tile${player.active ? " active-turn" : ""}`}
      style={player.active
        ? { "--active-turn-glow": player.color, "--speaker-color": player.color }
        : { borderColor: player.color, "--speaker-color": player.color }}
    >
      <div className={player.bottom ? "commander-banner banner-at-bottom" : "commander-banner"}>
        <div className="banner-menu" aria-hidden="true">
          <span className="menu-btn menu-status"><Video size={16} /></span>
          <span className="menu-btn menu-status"><Mic size={16} /></span>
          <span className="menu-btn"><MoreVertical size={16} /></span>
        </div>
        <div className="banner-row banner-name-row">
          <span className="banner-player-row"><span className="banner-player">{player.name}</span></span>
        </div>
        <div className="banner-row commander-detail">
          <span className="commander-pair"><span className="commander-name">{player.commander}</span></span>
          <span className="mana-cost">
            {player.pips.map((pip) => <span key={pip} className="mana-symbol" style={{ background: MANA_COLORS[pip] }} />)}
          </span>
        </div>
      </div>

      <div className={`video-wrap home-preview-camera home-preview-camera-${index + 1}`} aria-hidden="true">
        <div className="video-fit-box">
          <div className="home-preview-playmat">
            <DeckBack mana={player.pips[0]} />
            {index !== 3 && (
              <img
                className="home-preview-commander"
                src={scryfallCardImage(player.commanderCard)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            )}
            <div className={`home-preview-creatures${index === 3 ? " has-commander" : ""}`}>
              {index === 3 && (
                <img
                  className="home-preview-commander-in-row"
                  src={scryfallCardImage(player.commanderCard)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
              {player.creatures.map((cardId, cardIndex) => (
                <img
                  key={`${cardId}-creature-${cardIndex}`}
                  src={scryfallCardImage(cardId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
            <div className="home-preview-supports">
              {player.supports.map((cardId, cardIndex) => (
                <img
                  key={`${cardId}-support-${cardIndex}`}
                  src={scryfallCardImage(cardId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
            <div className="home-preview-lands">
              {player.lands.map((cardId, cardIndex) => (
                <img
                  key={`${cardId}-land-${cardIndex}`}
                  src={scryfallCardImage(cardId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          </div>
        </div>
        <div className="life-badge" style={lifePosition}><span className="life-value">{player.life}</span></div>
      </div>
    </article>
  );
}

export default function GamePreview() {
  const [demoStage, setDemoStage] = useState("previous");
  const [demoCycle, setDemoCycle] = useState(0);
  const showcaseRef = useRef(null);
  const chatVisible = demoStage === "chat";
  const previousCardVisible = demoStage === "previous";
  const featuredCard = previousCardVisible
    ? { id: CARD_IDS.ghalta, name: "Ghalta, Primal Hunger" }
    : { id: CARD_IDS.rhysticStudy, name: "Rhystic Study" };
  const recentCards = previousCardVisible
    ? [featuredCard, { id: CARD_IDS.skullclamp, name: "Skullclamp" }]
    : [featuredCard, { id: CARD_IDS.ghalta, name: "Ghalta, Primal Hunger" }];

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
      setDemoStage("chat");
      return undefined;
    }

    let timers = [];
    let playing = false;
    const clearTimers = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
    const runCycle = () => {
      if (!playing) return;
      setDemoStage("previous");
      setDemoCycle((cycle) => cycle + 1);
      timers.push(window.setTimeout(() => setDemoStage("card"), 1200));
      timers.push(window.setTimeout(() => setDemoStage("sharing"), 3900));
      timers.push(window.setTimeout(() => setDemoStage("chat"), 5300));
      timers.push(window.setTimeout(runCycle, 9800));
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !playing) {
        playing = true;
        runCycle();
      } else if (!entry.isIntersecting && playing) {
        playing = false;
        clearTimers();
      }
    }, { threshold: 0.18 });
    if (showcaseRef.current) observer.observe(showcaseRef.current);
    return () => {
      playing = false;
      clearTimers();
      observer.disconnect();
    };
  }, []);

  return (
    <section ref={showcaseRef} className="home-game-showcase" aria-labelledby="home-game-showcase-title">
      <header className="home-game-showcase-head">
        <h2 id="home-game-showcase-title">The whole table, right where it belongs.</h2>
      </header>

      <div className="home-game-preview home-game-preview-exact" aria-label="Coded rendering of the Snapcast four-player game interface">
        <div className="home-game-exact-canvas">
          <div className="main home-game-exact-main">
            <aside className={`sidebar home-game-exact-sidebar${chatVisible ? " chat-view" : ""}`}>
              <nav className="sidebar-rail" aria-label="Game preview sidebar">
                <span className="drawer-toggle panel-toggle"><PanelLeft className="expanded-panel-icon" size={20} /><ChevronLeft className="expanded-panel-arrow" size={20} /></span>
                <span className={chatVisible ? "drawer-toggle" : "drawer-toggle active"}><CardStackIcon /></span>
                <span className={chatVisible ? "drawer-toggle sidebar-chat-toggle active" : "drawer-toggle sidebar-chat-toggle"}>
                  <MessagesSquare size={20} />
                  {demoStage === "sharing" && <span className="chat-unread-dot" />}
                </span>
                <span className="sidebar-rail-divider" />
                <span className="drawer-toggle"><Settings size={20} /></span>
              </nav>
              <div className="sidebar-content">
                <div className="sidebar-head">
                  {chatVisible
                    ? <><span className="logo">Chat</span><span className="home-preview-room-count"><Users size={14} />4 players · 2 watching</span></>
                    : <span className="sidebar-game-name readonly">Dragons After Dark</span>}
                </div>
                {chatVisible ? (
                  <div className="chat-panel home-preview-chat" key={`chat-${demoCycle}`}>
                    <div className="chat-messages">
                      <PreviewChatMessage name="Maya" color="#8996eb" delay={0} kind="card">
                        <span className="chat-card-object">
                          <img src={scryfallCardImage(CARD_IDS.rhysticStudy)} alt="" />
                          <span><strong>Rhystic Study</strong></span>
                          <ChevronRight size={16} />
                        </span>
                      </PreviewChatMessage>
                      <PreviewChatMessage name="Drew" color="#d97777" delay={180} sound>
                        <div className="chat-sound-message">
                          <span><Drum size={16} /> Boo!</span>
                          <button type="button" className="chat-sound-play" aria-label="Play Boo! locally" tabIndex={-1}>
                            <Play size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </PreviewChatMessage>
                      <PreviewChatMessage name="Nora" color="#70b995" delay={360}>
                        <p>That explains the seven cards in hand 😅</p>
                      </PreviewChatMessage>
                      <PreviewChatMessage name="Sam" color="#a9adbf" delay={540}>
                        <p>Anyone holding enchantment removal?</p>
                      </PreviewChatMessage>
                    </div>
                    <div className="chat-compose home-preview-chat-compose">
                      <div className="chat-compose-main"><span>Message the table…</span></div>
                      <button
                        type="button"
                        className="sound-picker-trigger"
                        aria-label="Add sound effect"
                        tabIndex={-1}
                      >
                        <Drum size={20} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sidebar-search">
                      <Search size={18} className="search-icon" />
                      <input value="" placeholder="Lookup cards" aria-label="Lookup cards" readOnly tabIndex={-1} />
                    </div>
                    <div className="home-preview-card-sequence" key={`card-${demoCycle}-${demoStage}`}>
                      <div className="card-hit home-preview-card-result">
                        <span className="card-hit-image">
                          <img src={scryfallCardImage(featuredCard.id)} alt={featuredCard.name} />
                        </span>
                        <div className="card-meta">
                          <b>{featuredCard.name}</b>
                          <span className="card-actions"><span className="scryfall-link"><ExternalLink size={16} /></span></span>
                        </div>
                      </div>
                      <section className="recent-cards home-preview-recent" aria-label="Recent cards">
                        <h3>Recent</h3>
                        <div className="recent-card-list">
                          {recentCards.map((card, cardIndex) => (
                            <div className="recent-card-row" key={card.id}>
                              <span className="recent-card-open">
                                <img src={scryfallCardImage(card.id)} alt="" />
                                <span className="recent-card-copy"><strong>{card.name}</strong></span>
                              </span>
                              {cardIndex === 0 && <span className={`recent-card-share home-preview-recent-share${demoStage === "sharing" ? " shared" : ""}`}>
                                <MessageCircle size={16} />
                              </span>}
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </>
                )}
              </div>
            </aside>

            <div className="video-panel home-game-exact-video-panel">
              <div className="grid">
                {PREVIEW_PLAYERS.map((player, index) => <PreviewTile key={player.name} player={player} index={index} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
