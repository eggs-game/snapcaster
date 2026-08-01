(() => {
  const saved = localStorage.getItem("theme-preference") || "dark";
  const preference = ["light", "dark", "system"].includes(saved) ? saved : "dark";
  const resolved = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
})();
