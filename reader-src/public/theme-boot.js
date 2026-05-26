(function () {
  try {
    const id = localStorage.getItem("heartReverie.themeId");
    if (!id) return;
    const raw = localStorage.getItem("heartReverie.themeCache." + id);
    if (!raw) return;
    const t = JSON.parse(raw);
    if (!t || typeof t.palette !== "object" || Array.isArray(t.palette)) return;
    const root = document.documentElement;
    const keys = Object.keys(t.palette);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = t.palette[k];
      if (typeof v === "string") root.style.setProperty(k, v);
    }
    if (t.colorScheme) root.style.setProperty("color-scheme", t.colorScheme);
    const applyBg = function () {
      if (!document.body) return;
      document.body.style.backgroundImage = t.backgroundImage || "none";
    };
    if (document.body) applyBg();
    else document.addEventListener("DOMContentLoaded", applyBg, { once: true });
    // ::highlight() cannot resolve var() — inject literal color for dialogue plugin
    const textName = t.palette["--text-name"];
    if (textName) {
      const s = document.createElement("style");
      s.id = "theme-highlight-override";
      s.textContent = "::highlight(dialogue-quote-straight)," +
        "::highlight(dialogue-quote-curly)," +
        "::highlight(dialogue-quote-guillemet)," +
        "::highlight(dialogue-quote-corner)," +
        "::highlight(dialogue-quote-corner-half)," +
        "::highlight(dialogue-quote-book){color:" + textName + "!important}";
      document.head.appendChild(s);
    }
  } catch (_e) {
    // theme-boot is best-effort; ignore storage/parse failures so the SPA still loads
  }
})();
