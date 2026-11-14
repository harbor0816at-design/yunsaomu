// 建墓字段校验（PRD v0.2 第 3.1 节）。与后端 containsContact 规则保持一致。

function containsContact(text) {
  if (!text) return false
  if (/1[3-9]\d{9}/.test(text)) return true
  if (/\d{17}[\dXx]/.test(text)) return true
  if (/(电话|手机|微信|身份证|住址|门牌|宿舍号)\s*[:：]?\s*\w/.test(text)) return true
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return true
  return false
}

function len(s) { return Array.from(s || '').length }

function validateName(name) {
  const n = (name || '').trim()
  if (!n) return '请填写逝者姓名或纪念称呼'
  if (len(n) > 40) return '称呼请不超过 40 个字'
  if (containsContact(n)) return '称呼中请不要填写联系方式或证件号码'
  return null
}

function validateDisplayName(name) {
  const n = (name || '').trim()
  if (len(n) > 20) return '显示名请不超过 20 个字'
  if (containsContact(n)) return '显示名请不要填写证件号码、电话或详细住址'
  return null
}

function validateEpitaph(t) {
  if (len(t) > 80) return '墓志铭请不超过 80 个字'
  return null
}

function validateAddress(t) {
  if (len(t) > 120) return '地址请不超过 120 个字'
  if (/1[3-9]\d{9}/.test(t || '') || /\d{3,4}-?\d{7,8}/.test(t || '')) return '地址中请不要填写电话号码'
  return null
}

// 日期：{ y, m, d } 中 y 必填；precision = 'year' | 'month' | 'day'
function normDate(p) {
  if (!p || !p.y) return null
  const y = Number(p.y)
  const m = p.m ? Number(p.m) : null
  const d = m && p.d ? Number(p.d) : null
  return { y, m, d, precision: d ? 'day' : m ? 'month' : 'year' }
}

// 比较两日期的「最早可能值」与「最晚可能值」，只在确定先后颠倒时才报错
function lowerBound(dt) { return new Date(dt.y, (dt.m || 1) - 1, dt.d || 1).getTime() }
function upperBound(dt) {
  if (dt.d) return new Date(dt.y, dt.m - 1, dt.d).getTime()
  if (dt.m) return new Date(dt.y, dt.m, 0).getTime()
  return new Date(dt.y, 11, 31).getTime()
}

function validateOneDate(dt, label, now) {
  if (!dt) return null
  if (!Number.isInteger(dt.y) || dt.y < 1800) return `${label}年份不在合理范围内`
  if (dt.m && (dt.m < 1 || dt.m > 12)) return `${label}月份不正确`
  if (dt.d) {
    const last = new Date(dt.y, dt.m, 0).getDate()
    if (dt.d < 1 || dt.d > last) return `${label}日期不正确`
  }
  if (lowerBound(dt) > now) return `${label}不能晚于今天`
  return null
}

function validateDates(birth, death, nowMs) {
  const now = nowMs || Date.now()
  const b = normDate(birth)
  const d = normDate(death)
  const e1 = validateOneDate(b, '出生', now)
  if (e1) return e1
  const e2 = validateOneDate(d, '离世', now)
  if (e2) return e2
  if (b && d && upperBound(d) < lowerBound(b)) return '离世日期不能早于出生日期'
  return null
}

function toApiDate(p) {
  const dt = normDate(p)
  if (!dt) return { date: null, precision: null, year: null }
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${dt.y}-${pad(dt.m || 1)}-${pad(dt.d || 1)}`
  return { date, precision: dt.precision, year: dt.y }
}

function formatDate(date, precision) {
  if (!date) return ''
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  if (precision === 'day') return `${y}年${m}月${d}日`
  if (precision === 'month') return `${y}年${m}月`
  return `${y}`
}

module.exports = {
  containsContact, validateName, validateDisplayName, validateEpitaph, validateAddress,
  validateDates, toApiDate, formatDate, len
}
