import React, { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";

export default function AppToast({ message, onDismiss, duration = 4000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onDismiss]);

  if (!message) return null;

  return (
    <div className="app-toast-region" aria-live="polite" aria-atomic="true">
      <div className="app-toast is-success" role="status">
        <CheckCircle2 size={18} aria-hidden="true" />
        <span>{message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
