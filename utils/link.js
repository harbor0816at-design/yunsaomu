// 解析用户粘贴的网页版邀请 / 管理链接：https://<域名>/t/<id>?inv=<token> 或 ?adm=<token>
// 也接受小程序分享路径 pages/tomb/tomb?id=..&inv=..

function safeDecode(s) {
  try { return decodeURIComponent(s) } catch (e) { return s }
}

function parseQuery(q) {
  const out = {}
  String(q || '').replace(/^\?/, '').split('&').forEach((kv) => {
    if (!kv) return
    const i = kv.indexOf('=')
    const k = i >= 0 ? kv.slice(0, i) : kv
    const v = i >= 0 ? kv.slice(i + 1) : ''
    out[safeDecode(k)] = safeDecode(v.replace(/\+/g, ' '))
  })
  return out
}

function parseInvite(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const m = raw.match(/\/t\/([A-Za-z0-9_\-]+)\/?(\?[^\s#]*)?/)
  let id = ''
  let query = {}
  if (m) {
    id = m[1]
    query = parseQuery(m[2] || '')
  } else {
    const m2 = raw.match(/tomb\?([^\s#]*)/)
    if (!m2) return null
    query = parseQuery(m2[1])
    id = query.id || ''
  }
  if (!/^tmb_[A-Za-z0-9_\-]{6,}$/.test(id)) return null
  if (query.adm) return { id, kind: 'adm', token: query.adm }
  if (query.inv) return { id, kind: 'inv', token: query.inv }
  return null
}

module.exports = { parseInvite, parseQuery }
