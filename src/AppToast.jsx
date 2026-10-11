import React, { useEffect } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

export default function AppToast({ message, onDismiss, duration = 4000, kind = "success" }) {
  useEffect(() => {
    if (!message || duration <= 0) return undefined;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onDismiss]);

  if (!message) return null;

  return (
    <div className="app-toast-region" aria-live={kind === "error" ? "assertive" : "polite"} aria-atomic="true">
      <div className={`app-toast is-${kind === "error" ? "error" : "success"}`} role={kind === "error" ? "alert" : "status"}>
        {kind === "error" ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
        <span>{message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
