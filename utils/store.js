// 本机存储：会话 ID、显示名、「我的纪念墓」记录（Q5：只存墓 ID、称呼和令牌，不新增任何墓目录接口）
const K_SESSION = 'ysm.session'
const K_NAME = 'ysm.displayName'
const K_TOMBS = 'ysm.tombs'
const K_DRAFT = 'ysm.createDraft'
const DEFAULT_DISPLAY_NAME = '来访的亲人'

function wxGet(key, dflt) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? dflt : v
  } catch (e) { return dflt }
}
function wxSet(key, v) {
  try { wx.setStorageSync(key, v) } catch (e) { /* 存储满或被禁用时不阻断主流程 */ }
}

function randomId(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let s = ''
  for (let i = 0; i < 14; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return prefix + '_' + s
}

function getSessionId() {
  let id = wxGet(K_SESSION, '')
  if (!id) { id = randomId('ses'); wxSet(K_SESSION, id) }
  return id
}

function getDisplayName() { return wxGet(K_NAME, DEFAULT_DISPLAY_NAME) }
function setDisplayName(n) { wxSet(K_NAME, (n || '').trim() || DEFAULT_DISPLAY_NAME) }

function listTombs() {
  const list = wxGet(K_TOMBS, [])
  return Array.isArray(list) ? list.slice().sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0)) : []
}

// 合并写入：建墓时带 adm + inv；访客进入时只带 inv。已有的管理令牌永不被访客记录覆盖。
function upsertTomb(rec) {
  if (!rec || !rec.id) return
  const list = wxGet(K_TOMBS, [])
  const arr = Array.isArray(list) ? list : []
  const i = arr.findIndex((t) => t.id === rec.id)
  const prev = i >= 0 ? arr[i] : {}
  const next = {
    id: rec.id,
    name: rec.name || prev.name || '',
    inv: rec.inv || prev.inv || '',
    adm: rec.adm || prev.adm || '',
    role: (rec.adm || prev.adm) ? 'creator' : 'guest',
    lastVisit: Date.now()
  }
  if (i >= 0) arr[i] = next; else arr.push(next)
  wxSet(K_TOMBS, arr.slice(-50))
}

function removeTomb(id) {
  const arr = wxGet(K_TOMBS, [])
  wxSet(K_TOMBS, (Array.isArray(arr) ? arr : []).filter((t) => t.id !== id))
}

function getTomb(id) { return listTombs().find((t) => t.id === id) || null }

function getDraft() { return wxGet(K_DRAFT, null) }
function setDraft(d) { wxSet(K_DRAFT, d) }
function clearDraft() { try { wx.removeStorageSync(K_DRAFT) } catch (e) { /* */ } }

module.exports = {
  DEFAULT_DISPLAY_NAME,
  getSessionId, getDisplayName, setDisplayName,
  listTombs, upsertTomb, removeTomb, getTomb,
  getDraft, setDraft, clearDraft
}
