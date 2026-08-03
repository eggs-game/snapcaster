import React, { useEffect, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import { getReviewEligibleProfiles, sendFriendRequest, submitPlayerReview } from "./account.js";

export default function ReviewPrompt({ sessionId, onClose }) {
  const [players, setPlayers] = useState([]);
  const [index, setIndex] = useState(0);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [friendOffer, setFriendOffer] = useState(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let active = true;
    getReviewEligibleProfiles(sessionId)
      .then((eligible) => {
        if (!active) return;
        setPlayers(eligible);
        if (!eligible.length) onCloseRef.current();
      })
      .catch(() => { if (active) onCloseRef.current(); });
    return () => { active = false; };
  }, [sessionId]);

  const player = players[index];
  if (!player) return null;

  const next = () => {
    setFriendOffer(null);
    setRating(0);
    setComment("");
    setError("");
    if (index + 1 >= players.length) onClose();
    else setIndex((value) => value + 1);
  };

  const submit = async () => {
    if (!rating) {
      setError("Choose a star rating first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await submitPlayerReview({ profileId: player.id, sessionId, rating, comment });
      if (rating >= 4) setFriendOffer(player);
      else next();
    } catch (submitError) {
      setError(String(submitError?.message || "Could not submit this review."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lobby-modal-backdrop review-prompt-backdrop">
      <section className="lobby-modal review-prompt" role="dialog" aria-modal="true" aria-labelledby="review-prompt-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close" data-tooltip="Close" data-tooltip-pos="right-bottom"><X size={20} /></button>
        {friendOffer ? (
          <>
            <header className="modal-head compact">
              <h2 id="review-prompt-title">Enjoyed playing with {friendOffer.display_name}?</h2>
              <p>Your private review was saved. You can also send a normal mutual friend request.</p>
            </header>
            <footer className="modal-actions">
              <button type="button" onClick={next}>Not now</button>
              <button className="primary" type="button" onClick={async () => {
                try { await sendFriendRequest(friendOffer.id); } catch { /* review remains saved */ }
                next();
              }}>Add friend</button>
            </footer>
          </>
        ) : (
          <>
            <header className="modal-head compact">
              <p className="review-progress">Player {index + 1} of {players.length}</p>
              <h2 id="review-prompt-title">How was your game with {player.display_name}?</h2>
              <p>Reviews are private to the player and separate from match results.</p>
            </header>
            <div className="review-stars" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} star${value === 1 ? "" : "s"}`}>
                  <Star size={28} fill={value <= rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <label className="modal-field">
              <span>Comment <em>Optional</em></span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} placeholder="Sportsmanship, table experience, or deck feedback" />
            </label>
            {error && <p className="modal-error" role="alert">{error}</p>}
            <footer className="modal-actions">
              <button type="button" onClick={next}>Maybe later</button>
              <button className="primary" type="button" disabled={saving} onClick={submit}>{saving ? "Saving…" : "Submit review"}</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
