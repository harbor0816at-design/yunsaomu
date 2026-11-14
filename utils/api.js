// 对接现有 Supabase Edge Function `api`（与网页版同一套接口与令牌）。
const config = require('../config')

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBase + path,
      method,
      data: data || undefined,
      timeout: 15000,
      header: { 'content-type': 'application/json', apikey: config.anonKey },
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
        else {
          const err = new Error(body.error || '服务暂时不可用，请稍后再试')
          err.status = res.statusCode
          err.code = body.code
          reject(err)
        }
      },
      fail(e) {
        const err = new Error('网络不太顺畅，请稍后再试')
        err.status = 0
        err.raw = e
        reject(err)
      }
    })
  })
}

const enc = encodeURIComponent

module.exports = {
  config: () => request('GET', '/config'),
  createTomb: (payload) => request('POST', '/tombs', payload),
  getTomb: (id, kind, token) => request('GET', `/tombs/${enc(id)}?${kind}=${enc(token)}`),
  enter: (id, body) => request('POST', `/tombs/${enc(id)}/enter`, body),
  heartbeat: (id, auth, sessionId) => request('POST', `/tombs/${enc(id)}/heartbeat`, { ...auth, sessionId }),
  leave: (id, auth, sessionId) => request('POST', `/tombs/${enc(id)}/leave`, { ...auth, sessionId }),
  offer: (id, auth, body) => request('POST', `/tombs/${enc(id)}/offerings`, { ...auth, ...body }),
  wipe: (id, auth, body) => request('POST', `/tombs/${enc(id)}/wipe`, { ...auth, ...body }),
  inscribe: (id, auth, body) => request('POST', `/tombs/${enc(id)}/inscriptions`, { ...auth, ...body }),
  moderate: (id, insId, admToken, action) =>
    request('POST', `/tombs/${enc(id)}/inscriptions/${enc(insId)}/moderate`, { token: admToken, action })
}
