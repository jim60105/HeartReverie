(function () {
  try {
    var id = localStorage.getItem("heartReverie.themeId");
    if (!id) return;
    var raw = localStorage.getItem("heartReverie.themeCache." + id);
    if (!raw) return;
    var t = JSON.parse(raw);
    if (!t || typeof t.palette !== "object" || Array.isArray(t.palette)) return;
    var root = document.documentElement;
    var keys = Object.keys(t.palette);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = t.palette[k];
      if (typeof v === "string") root.style.setProperty(k, v);
    }
    if (t.colorScheme) root.style.setProperty("color-scheme", t.colorScheme);
    function applyBg() {
      if (!document.body) return;
      document.body.style.backgroundImage = t.backgroundImage || "none";
    }
    if (document.body) applyBg();
    else document.addEventListener("DOMContentLoaded", applyBg, { once: true });
    // ::highlight() cannot resolve var() — inject literal color for dialogue plugin
    var textName = t.palette["--text-name"];
    if (textName) {
      var s = document.createElement("style");
      s.id = "theme-highlight-override";
      s.textContent =
        "::highlight(dialogue-quote-straight)," +
        "::highlight(dialogue-quote-curly)," +
        "::highlight(dialogue-quote-guillemet)," +
        "::highlight(dialogue-quote-corner)," +
        "::highlight(dialogue-quote-corner-half)," +
        "::highlight(dialogue-quote-book){color:" + textName + "!important}";
      document.head.appendChild(s);
    }
  } catch (_) {}
})();
