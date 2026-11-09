// magpie 页面插件入口：宿主把本模块当一个 OpenCode v1 插件加载，
// 调 default.server() 时把页面服务拉起来。

import { startServer } from "./lib/server.mjs"

let started = null

async function ensure(options) {
  if (started) {
    const srv = await started
    if (srv && (srv.server?.listening || srv.waiting)) return srv
  }
  started = startServer({ options }).catch((err) => {
    console.error("[model-quota] 服务启动失败：", err?.message || err)
    return null
  })
  return started
}

export default {
  id: "magpie-model-quota",
  server: async (_input, options) => {
    await ensure(options)
    return {}
  },
}
