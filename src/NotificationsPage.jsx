import React, { useEffect, useState } from "react";
import { Bell, MessageSquareText, Star, UserPlus, X } from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import {
  dismissNotification,
  getAccountSession,
  getMyReceivedReviews,
  getMySentReviews,
  getSocialDashboard,
  markNotificationsRead,
  reportPlayerReview,
  respondFriendRequest,
  respondGameInvitation,
  signInWithDiscord,
  signOutAccount,
  updateMyPlayerReview,
} from "./account.js";

function dateLabel(value) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Stars({ rating }) {
  return (
    <span className="notification-stars" aria-label={rating + " out of 5 stars"}>
      {"★".repeat(rating)}{"☆".repeat(5 - rating)}
    </span>
  );
}

export default function NotificationsPage() {
  const [account, setAccount] = useState(null);
  const [social, setSocial] = useState({ friends: [], notifications: [] });
  const [receivedReviews, setReceivedReviews] = useState([]);
  const [sentReviews, setSentReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("friend-requests");

  const refreshNotifications = async () => setSocial(await getSocialDashboard());

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then(async (nextAccount) => {
        if (!active) return;
        setAccount(nextAccount);
        if (!nextAccount) return;
        const [dashboard, received, sent] = await Promise.all([
          getSocialDashboard(),
          getMyReceivedReviews(),
          getMySentReviews(),
        ]);
        if (!active) return;
        setSocial(dashboard);
        setReceivedReviews(received);
        setSentReviews(sent);
        await markNotificationsRead(nextAccount);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load notifications."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handleFriendRequest = async (notification, accept) => {
    try {
      await respondFriendRequest(notification.reference_id, accept);
      await refreshNotifications();
    } catch (requestError) {
      setError(String(requestError?.message || "Could not respond to this friend request."));
    }
  };

  const dismiss = async (notification) => {
    try {
      await dismissNotification(notification.id);
      setSocial((current) => ({
        ...current,
        notifications: current.notifications.filter((item) => item.id !== notification.id),
      }));
    } catch (dismissError) {
      setError(String(dismissError?.message || "Could not dismiss this notification."));
    }
  };

  return (
    <main className="profile-page notifications-page">
      <SiteHeader
        account={account}
        accountReady={!loading}
        accountError={error}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: "/notifications" })}
        onSignOut={async () => {
          await signOutAccount();
          window.location.href = "/";
        }}
      />
      <section className="notifications-page-shell">
        {loading ? (
          <p className="public-games-state">Loading notifications…</p>
        ) : error && !account ? (
          <div className="games-empty"><h1>Notifications unavailable</h1><p>{error}</p></div>
        ) : !account ? (
          <div className="games-empty account-profile-sign-in">
            <Bell size={30} />
            <h1>Sign in to see notifications</h1>
            <p>Friend requests and private review activity will appear here.</p>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: "/notifications" })}>Sign in with Discord</button>
          </div>
        ) : (
          <>
            <header className="account-page-hero notifications-hero">
              <p>Account activity</p>
              <h1>Notifications</h1>
              <span>Friend requests and review history, all in one place.</span>
            </header>
            <div className="account-page-tabs notifications-tabs" role="tablist" aria-label="Notification activity">
              <button
                id="notifications-tab-friend-requests"
                type="button"
                role="tab"
                aria-selected={activeTab === "friend-requests"}
                aria-controls="notifications-panel-friend-requests"
                onClick={() => setActiveTab("friend-requests")}
              >
                Friend requests
              </button>
              <button
                id="notifications-tab-reviews-received"
                type="button"
                role="tab"
                aria-selected={activeTab === "reviews-received"}
                aria-controls="notifications-panel-reviews-received"
                onClick={() => setActiveTab("reviews-received")}
              >
                Reviews received
              </button>
              <button
                id="notifications-tab-reviews-sent"
                type="button"
                role="tab"
                aria-selected={activeTab === "reviews-sent"}
                aria-controls="notifications-panel-reviews-sent"
                onClick={() => setActiveTab("reviews-sent")}
              >
                Reviews sent
              </button>
            </div>
            {error && <p className="modal-error" role="alert">{error}</p>}
            <div className="notifications-layout">
              {activeTab === "friend-requests" && (
              <section
                id="notifications-panel-friend-requests"
                className="notifications-panel notifications-panel-wide"
                role="tabpanel"
                aria-labelledby="notifications-tab-friend-requests"
              >
                <header><UserPlus size={18} /><div><h2>Requests and updates</h2><p>Friend requests, invitations, and account activity.</p></div></header>
                {social.notifications.length ? (
                  <div className="notifications-feed">
                    {social.notifications.map((notification) => (
                      <article key={notification.id} className={notification.read_at ? "" : "unread"}>
                        <div className="notification-activity-icon">
                          {notification.kind === "friend_request" ? <UserPlus size={18} /> : <Bell size={18} />}
                        </div>
                        <div>
                          <strong>{notification.kind === "friend_request"
                            ? (notification.actor?.display_name || "A player") + " sent you a friend request"
                            : notification.kind === "friend_accepted"
                              ? (notification.actor?.display_name || "A player") + " accepted your friend request"
                              : notification.kind === "game_invitation"
                                ? (notification.actor?.display_name || "A friend") + " invited you to a game"
                                : "You have a new Snapcast update"}</strong>
                          <span>{dateLabel(notification.created_at)}</span>
                          {notification.actor?.id && <a href={"/profile?id=" + encodeURIComponent(notification.actor.id)}>View profile</a>}
                        </div>
                        {notification.kind === "friend_request" ? (
                          <div className="notification-row-actions">
                            <button type="button" onClick={() => handleFriendRequest(notification, false)}>Decline</button>
                            <button className="primary" type="button" onClick={() => handleFriendRequest(notification, true)}>Accept</button>
                          </div>
                        ) : notification.kind === "game_invitation" ? (
                          <div className="notification-row-actions">
                            <button type="button" onClick={async () => {
                              await respondGameInvitation(notification.reference_id, false);
                              refreshNotifications();
                            }}>Decline</button>
                            <button className="primary" type="button" onClick={async () => {
                              const invitation = await respondGameInvitation(notification.reference_id, true);
                              if (invitation?.accepted && invitation.code) {
                                window.location.href = "/?code=" + encodeURIComponent(invitation.code) + (invitation.role === "visitor" ? "&visitor=1" : "");
                              } else {
                                refreshNotifications();
                              }
                            }}>Join</button>
                          </div>
                        ) : (
                          <button className="notification-icon-button" type="button" onClick={() => dismiss(notification)} aria-label="Dismiss notification">
                            <X size={15} />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : <p className="notifications-empty">You’re all caught up.</p>}
              </section>
              )}

              {activeTab === "reviews-received" && (
              <section
                id="notifications-panel-reviews-received"
                className="notifications-panel notifications-panel-wide"
                role="tabpanel"
                aria-labelledby="notifications-tab-reviews-received"
              >
                <header><Star size={18} /><div><h2>Reviews received</h2><p>Private feedback other players left for you.</p></div></header>
                <div className="review-activity-list">
                  {receivedReviews.length ? receivedReviews.map((review) => (
                    <article key={review.id}>
                      <div><strong>{review.reviewer.display_name}</strong><Stars rating={review.rating} /></div>
                      {review.comment && <p>{review.comment}</p>}
                      <footer>
                        <span>{dateLabel(review.created_at)}</span>
                        <button type="button" onClick={async () => {
                          const reason = window.prompt("Why are you reporting this review?");
                          if (!reason?.trim()) return;
                          try {
                            await reportPlayerReview(review.id, reason.trim());
                            window.alert("Review reported for moderation.");
                          } catch (reportError) {
                            setError(String(reportError?.message || "Could not report this review."));
                          }
                        }}>Report</button>
                      </footer>
                    </article>
                  )) : <p className="notifications-empty">No reviews received yet.</p>}
                </div>
              </section>
              )}

              {activeTab === "reviews-sent" && (
              <section
                id="notifications-panel-reviews-sent"
                className="notifications-panel notifications-panel-wide"
                role="tabpanel"
                aria-labelledby="notifications-tab-reviews-sent"
              >
                <header><MessageSquareText size={18} /><div><h2>Reviews sent</h2><p>Your private feedback for other players.</p></div></header>
                <div className="review-activity-list">
                  {sentReviews.length ? sentReviews.map((review) => (
                    <article key={review.id}>
                      <div><strong>{review.reviewed.display_name}</strong><Stars rating={review.rating} /></div>
                      {review.comment && <p>{review.comment}</p>}
                      <footer>
                        <span>{dateLabel(review.created_at)}</span>
                        {new Date(review.editable_until) > new Date() && (
                          <button type="button" onClick={async () => {
                            const rating = Number(window.prompt("Update rating (1–5)", String(review.rating)));
                            if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
                            const comment = window.prompt("Update private review comment", review.comment || "");
                            if (comment === null) return;
                            try {
                              await updateMyPlayerReview(review.id, rating, comment);
                              setSentReviews((reviews) => reviews.map((item) => item.id === review.id
                                ? { ...item, rating, comment: comment.trim() }
                                : item));
                            } catch (reviewError) {
                              setError(String(reviewError?.message || "Could not update this review."));
                            }
                          }}>Edit</button>
                        )}
                      </footer>
                    </article>
                  )) : <p className="notifications-empty">No reviews sent yet.</p>}
                </div>
              </section>
              )}
            </div>
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
