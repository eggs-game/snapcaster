import React, { useEffect, useMemo, useState } from "react";
import { Crown, Mic, MicOff, Play, RefreshCw, Square, UserMinus, X } from "lucide-react";

export default function GameManagement({
  status,
  players,
  visitors,
  onClose,
  onStart,
  onManageMember,
  onEnd,
  onRestart,
  friends = [],
  onInviteFriend,
  onCancelInvitation,
}) {
  const [mode, setMode] = useState("manage");
  const [resultKind, setResultKind] = useState("winner");
  const [winnerId, setWinnerId] = useState(players[0]?.membershipId || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [inviteTarget, setInviteTarget] = useState("");
  const [sentInvitations, setSentInvitations] = useState([]);
  const eligiblePlayers = useMemo(() => {
    const active = players.filter((player) => player.membershipId && !player.eliminated);
    return active.length ? active : players.filter((player) => player.membershipId);
  }, [players]);

  useEffect(() => {
    if (!eligiblePlayers.some((player) => player.membershipId === winnerId)) {
      setWinnerId(eligiblePlayers[0]?.membershipId || "");
    }
  }, [eligiblePlayers, winnerId]);

  const run = async (label, action) => {
    setError("");
    setBusy(label);
    try {
      await action();
    } catch (actionError) {
      setError(String(actionError?.message || "That action could not be completed."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="lobby-modal-backdrop game-management-backdrop">
      <section className="lobby-modal game-management-modal" role="dialog" aria-modal="true" aria-labelledby="game-management-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <header className="modal-head compact">
          <p className="game-management-eyebrow"><Crown size={15} /> Owner controls</p>
          <h2 id="game-management-title">Game Management</h2>
        </header>

        {mode === "end" ? (
          <div className="game-management-end">
            <label className="modal-field">
              <span>Result</span>
              <select value={resultKind} onChange={(event) => setResultKind(event.target.value)}>
                <option value="winner">Choose a winner</option>
                <option value="draw">Draw</option>
                <option value="unresolved">End unresolved</option>
              </select>
            </label>
            {resultKind === "winner" && (
              <label className="modal-field">
                <span>Winner</span>
                <select value={winnerId} onChange={(event) => setWinnerId(event.target.value)}>
                  {eligiblePlayers.map((player) => (
                    <option key={player.membershipId} value={player.membershipId}>{player.name}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="game-management-note">
              Players get a 24-hour correction window before a submitted result becomes final.
            </p>
            {error && <p className="modal-error" role="alert">{error}</p>}
            <footer className="modal-actions">
              <button type="button" onClick={() => setMode("manage")}>Back</button>
              <button
                className="primary"
                type="button"
                disabled={Boolean(busy) || (resultKind === "winner" && !winnerId)}
                onClick={() => run("end", () => onEnd({ resultKind, winnerMembershipId: winnerId }))}
              >
                {busy === "end" ? "Ending…" : "Confirm end game"}
              </button>
            </footer>
          </div>
        ) : (
          <>
            <div className="game-management-status">
              <span className={`game-status-badge ${status}`}>{status === "live" ? "Live" : status === "lobby" ? "Lobby" : "Finished"}</span>
              <p>{players.length} players · {visitors.length} visitors</p>
            </div>

            <section className="game-management-group">
              <h3>Players</h3>
              <div className="game-management-roster">
                {players.map((player) => (
                  <ParticipantRow
                    key={player.id}
                    participant={player}
                    onRemove={player.isMe ? null : () => run(`remove-${player.id}`, () => onManageMember(player, "remove"))}
                    busy={busy}
                  />
                ))}
              </div>
            </section>

            <section className="game-management-group">
              <h3>Visitors</h3>
              <div className="game-management-roster">
                {visitors.length ? visitors.map((visitor) => (
                  <ParticipantRow
                    key={visitor.id}
                    participant={visitor}
                    onMute={() => run(`mute-${visitor.id}`, () => onManageMember(visitor, visitor.roomMuted ? "unmute" : "mute"))}
                    onRemove={() => run(`remove-${visitor.id}`, () => onManageMember(visitor, "remove"))}
                    busy={busy}
                  />
                )) : <p className="game-management-empty">No visitors are watching.</p>}
              </div>
            </section>

            {friends.length > 0 && (
              <section className="game-management-group">
                <h3>Invite a friend</h3>
                <div className="game-management-invite">
                  <select value={inviteTarget} onChange={(event) => setInviteTarget(event.target.value)}>
                    <option value="">Choose a friend</option>
                    {friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.display_name}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!inviteTarget || Boolean(busy)}
                    onClick={() => run("invite", async () => {
                      const invitationId = await onInviteFriend(inviteTarget);
                      const friend = friends.find((candidate) => candidate.id === inviteTarget);
                      setSentInvitations((invitations) => [...invitations, {
                        id: invitationId,
                        name: friend?.display_name || "Friend",
                      }]);
                      setInviteTarget("");
                    })}
                  >
                    {busy === "invite" ? "Sending…" : "Send invite"}
                  </button>
                </div>
                {sentInvitations.map((invitation) => (
                  <div className="game-management-sent-invite" key={invitation.id}>
                    <span>Invite sent to {invitation.name}</span>
                    <button type="button" disabled={Boolean(busy)} onClick={() => run(`cancel-invite-${invitation.id}`, async () => {
                      await onCancelInvitation(invitation.id);
                      setSentInvitations((invitations) => invitations.filter((item) => item.id !== invitation.id));
                    })}>Cancel</button>
                  </div>
                ))}
              </section>
            )}

            {error && <p className="modal-error" role="alert">{error}</p>}
            <footer className="game-management-actions">
              {status === "lobby" && (
                <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => run("start", onStart)}>
                  <Play size={16} /> {busy === "start" ? "Starting…" : "Start game"}
                </button>
              )}
              {status === "live" && (
                <button type="button" disabled={Boolean(busy)} onClick={() => setMode("end")}>
                  <Square size={16} /> End game
                </button>
              )}
              <button type="button" disabled={Boolean(busy)} onClick={() => run("restart", onRestart)}>
                <RefreshCw size={16} /> {busy === "restart" ? "Restarting…" : "Restart table"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function ParticipantRow({ participant, onMute, onRemove, busy }) {
  return (
    <div className="game-management-participant">
      <div className="game-management-participant-avatar">{participant.name?.trim().charAt(0).toUpperCase() || "P"}</div>
      <div>
        <strong>{participant.name}{participant.isMe ? " · You" : ""}</strong>
        <span>{participant.role === "visitor"
          ? "Visitor"
          : participant.eliminated
            ? `Out · ${participant.lossReason.replace("_", " ")}`
            : participant.commander || "Commander not selected"}</span>
      </div>
      <div className="game-management-participant-actions">
        {onMute && (
          <button
            type="button"
            onClick={onMute}
            disabled={Boolean(busy)}
            aria-label={participant.roomMuted ? `Unmute ${participant.name}` : `Mute ${participant.name}`}
            data-tooltip={participant.roomMuted ? "Unmute visitor" : "Mute visitor"}
          >
            {participant.roomMuted ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${participant.name} from this game?`)) onRemove();
            }}
            disabled={Boolean(busy)}
            aria-label={`Remove ${participant.name}`}
            data-tooltip="Remove participant"
          >
            <UserMinus size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
