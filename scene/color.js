// 颜色与随机数工具（纯函数，可在 node 中测试）

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  const r = Math.round(A[0] + (B[0] - A[0]) * k)
  const g = Math.round(A[1] + (B[1] - A[1]) * k)
  const bl = Math.round(A[2] + (B[2] - A[2]) * k)
  return `rgb(${r},${g},${bl})`
}

function mixHex(a, b, t) {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return '#' + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * k).toString(16).padStart(2, '0')).join('')
}

function rgba(hex, a) {
  const c = hexToRgb(hex)
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

function hashStr(s) {
  let h = 2166136261
  const str = String(s || 'yunsaomu')
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function rng(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

module.exports = { hexToRgb, mix, mixHex, rgba, hashStr, rng }
