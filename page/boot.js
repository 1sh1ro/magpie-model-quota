// 带路页：把 magpie 的插件框架导航到本插件的页面服务。
// 页面 CSP 是 connect-src 'none'，只能直接跳转，不能先探测。
(async () => {
  const DEFAULT_PORT = 3491
  let port = DEFAULT_PORT
  let theme = ""
  let tokens = null
  let service = ""

  try {
    const t = await window.magpie?.ready
    if (t) {
      if (typeof t.dark === "boolean") theme = t.dark ? "dark" : "light"
      if (t.tokens && typeof t.tokens === "object") tokens = t.tokens
    }
  } catch {}
  try {
    const s = window.magpie?.service
    if (typeof s === "string" && /^https?:\/\//.test(s)) service = s
  } catch {}
  try {
    const o = await window.magpie?.options?.get?.()
    if (o && Number.isFinite(Number(o.port)) && Number(o.port) > 0) port = Number(o.port)
  } catch {}

  const q = new URLSearchParams()
  if (theme) q.set("theme", theme)
  const slim = {}
  for (const [k, v] of Object.entries(tokens || {})) {
    const s = String(v ?? "").trim()
    if (s) slim[k] = s
  }
  if (Object.keys(slim).length) {
    try { q.set("tokens", btoa(unescape(encodeURIComponent(JSON.stringify(slim))))) } catch {}
  }

  function showFallback(p) {
    setTimeout(function () {
      const said = document.getElementById("said")
      if (!said) return
      said.textContent = "本地服务没有在运行（127.0.0.1:" + p + "）"
      if (document.getElementById("retry")) return
      const btn = document.createElement("button")
      btn.id = "retry"
      btn.type = "button"
      btn.textContent = "重试"
      btn.addEventListener("click", function () { location.reload() })
      said.parentNode.appendChild(btn)
    }, 5000)
  }

  if (service) {
    showFallback(port)
    location.replace(service + "?" + q.toString())
    return
  }
  const host = String(location.hostname || "").toLowerCase().replace(/^\[|\]$/g, "")
  const local = !host || host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host)
  if (!local) {
    const said = document.getElementById("said")
    if (said) said.textContent = "服务只在运行 magpie 的那台机器上监听 127.0.0.1:" + port + "，请在本机打开或做端口转发。"
    return
  }
  showFallback(port)
  location.replace("http://127.0.0.1:" + port + "/?" + q.toString())
})()
