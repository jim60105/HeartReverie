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
      if (t.backgroundImage) {
        document.body.style.backgroundImage =
          "url('" + String(t.backgroundImage).replace(/'/g, "\\'") + "')";
      }
    }
    if (document.body) applyBg();
    else document.addEventListener("DOMContentLoaded", applyBg, { once: true });
  } catch (_) {}
})();
