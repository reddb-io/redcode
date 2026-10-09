;(function () {
  var key = "opencode-theme-id"
  var stored = localStorage.getItem(key)
  // `oc-2` is the retired built-in theme; the design system's Application theme replaced it.
  var themeId = !stored || stored === "oc-2" ? "application" : stored

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  // The design system Theme axis is always Application; the user's color theme is its own attribute.
  document.documentElement.dataset.theme = "application"
  document.documentElement.dataset.colorTheme = themeId
  document.documentElement.dataset.colorScheme = mode
  var background = themeId === "application" ? (isDark ? "#07080a" : "#f4f5f7") : isDark ? "#080808" : "#fafafa"
  document.documentElement.style.backgroundColor = background

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", background)

  if (themeId === "application") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
