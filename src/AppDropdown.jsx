import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import "./AppDropdown.css";

export default function AppDropdown({
  label,
  value,
  options = [],
  onChange,
  disabled = false,
  emptyLabel = "No options",
  variant = "field",
  placement = "bottom",
  className = "",
  searchable,
  searchThreshold = 8,
  searchPlaceholder,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => String(option.value) === String(value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : options[0];
  const unavailable = disabled || !options.length;
  const hasSearch = searchable ?? options.length >= searchThreshold;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      const searchableText = `${option.label || ""} ${option.searchText || ""}`.toLocaleLowerCase();
      return searchableText.includes(normalizedQuery);
    });
  }, [normalizedQuery, options]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.type === "pointerdown" && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open && query) setQuery("");
  }, [open, query]);

  const focusOption = (index) => {
    if (!filteredOptions.length) return;
    const nextIndex = (index + filteredOptions.length) % filteredOptions.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const openMenu = (focusIndex = 0, initialQuery = "") => {
    if (unavailable) return;
    setQuery(initialQuery);
    setOpen(true);
    window.requestAnimationFrame(() => {
      if (hasSearch) searchRef.current?.focus();
      else focusOption(focusIndex);
    });
  };

  const choose = (option) => {
    onChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={`app-dropdown app-dropdown-${variant} app-dropdown-${placement}${className ? ` ${className}` : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="app-dropdown-trigger"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        disabled={unavailable}
        onClick={() => (open ? setOpen(false) : openMenu(Math.max(0, selectedIndex)))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? options.length - 1 : Math.max(0, selectedIndex));
          } else if (hasSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            openMenu(0, event.key);
          }
        }}
      >
        <span>{selected?.label || emptyLabel}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="app-dropdown-menu">
          {hasSearch && (
            <label className="app-dropdown-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(filteredOptions.length - 1);
                  } else if (event.key === "Enter" && filteredOptions.length === 1) {
                    event.preventDefault();
                    choose(filteredOptions[0]);
                  }
                }}
                aria-label={`Search ${label}`}
                placeholder={searchPlaceholder || `Search ${label.toLocaleLowerCase()}`}
                autoComplete="off"
              />
            </label>
          )}
          <div className="app-dropdown-options" id={listboxId} role="listbox" aria-label={label}>
            {filteredOptions.map((option, index) => (
              <button
                type="button"
                role="option"
                key={String(option.value)}
                ref={(node) => { optionRefs.current[index] = node; }}
                aria-selected={String(option.value) === String(value)}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (index === 0 && hasSearch) searchRef.current?.focus();
                    else focusOption(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(filteredOptions.length - 1);
                  } else if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
              >
                <span>{option.label}</span>
                {String(option.value) === String(value) && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
            {!filteredOptions.length && (
              <p className="app-dropdown-empty" role="status">No matching options</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
