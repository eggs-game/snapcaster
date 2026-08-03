import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import "./ConfirmDialog.css";

const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [request, setRequest] = useState(null);
  const pendingRef = useRef(null);
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const requestIdRef = useRef(0);

  const finish = useCallback((accepted) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    resolve?.(accepted);
  }, []);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    pendingRef.current?.(false);
    pendingRef.current = resolve;
    setRequest({
      id: ++requestIdRef.current,
      title: options.title || "Confirm action",
      description: options.description || "Are you sure you want to continue?",
      confirmLabel: options.confirmLabel || "Confirm",
      cancelLabel: options.cancelLabel || "Cancel",
      tone: options.tone === "danger" ? "danger" : "primary",
    });
  }), []);

  useEffect(() => {
    if (!request) return undefined;
    const previousFocus = document.activeElement;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [finish, request]);

  useEffect(() => () => pendingRef.current?.(false), []);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {request && (
        <div
          className="lobby-modal-backdrop confirmation-dialog-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) finish(false);
          }}
        >
          <section
            className="lobby-modal confirmation-dialog"
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`confirmation-dialog-title-${request.id}`}
            aria-describedby={`confirmation-dialog-description-${request.id}`}
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Close confirmation"
              onClick={() => finish(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <header className="modal-head compact">
              <h2 id={`confirmation-dialog-title-${request.id}`}>{request.title}</h2>
              <p id={`confirmation-dialog-description-${request.id}`}>{request.description}</p>
            </header>
            <footer className="modal-actions confirmation-dialog-actions">
              <button ref={cancelRef} type="button" onClick={() => finish(false)}>
                {request.cancelLabel}
              </button>
              <button
                className={request.tone === "danger" ? "confirmation-dialog-danger" : "primary"}
                type="button"
                onClick={() => finish(true)}
              >
                {request.confirmLabel}
              </button>
            </footer>
          </section>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmDialogContext);
  if (!confirm) throw new Error("useConfirmDialog must be used inside ConfirmDialogProvider");
  return confirm;
}
