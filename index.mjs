// magpie 页面插件入口：宿主把本模块当一个 OpenCode v1 插件加载，
// 调 default.server() 时把页面服务拉起来，并等它真正监听后才返回（宿主要探测端口）。

import { startServer } from "./lib/server.mjs"

let starting = null

export default {
  id: "magpie-model-quota",
  server: async (_input, options) => {
    if (!starting) {
      // manifest options.port 的 0/非法值归成 undefined：页面从同一份 options 读到的与这里一致。
      const n = Number(options?.port)
      const port = Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined
      starting = startServer({ options: { ...(options || {}), port } })
        .then((srv) => ({ ok: true, port: srv.port, reused: srv.reused }))
        .catch((err) => {
          starting = null // 允许下次调用重试
          console.error("[model-quota] server not started:", err?.message || err)
          throw err
        })
    }
    return await starting
  },
}
