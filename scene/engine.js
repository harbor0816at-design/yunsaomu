// 祭奠场景 Canvas 2D 引擎（原创程序化资产，PRD 第 9 节）。
// 不依赖 DOM / 小程序 API：传入 2D context 即可绘制，可在 node 里用 mock context 跑通。
const { mix, mixHex, rgba, hashStr, rng } = require('./color')

// 色调对齐网页版：雾青、低饱和、带空气透视
const PHASE = {
  dawn: { skyTop: '#a9b2b6', skyBot: '#e3d6c2', light: 0.86, glow: 0.55 },
  noon: { skyTop: '#b3bcb2', skyBot: '#dcdfd2', light: 1, glow: 0.3 },
  dusk: { skyTop: '#858892', skyBot: '#d8b996', light: 0.7, glow: 0.75 },
  night: { skyTop: '#161b23', skyBot: '#353d47', light: 0.36, glow: 1 }
}
const NIGHT_TINT = '#151a21'

const SEASON = {
  spring: { ground: '#8a9876', grass: '#9ba886', hillFar: '#aab4a6', hillNear: '#8f9d8b', leaf: ['#e3c9cd', '#d8b6bd', '#eddcdd', '#d6bac2'], trunk: '#5e5246', deco: ['#eee5e1', '#e6dfb9', '#d6b8bf'] },
  summer: { ground: '#6e7e5f', grass: '#7e8e6b', hillFar: '#97a395', hillNear: '#758672', leaf: ['#5c7152', '#697e5c', '#4e6347', '#778b65'], trunk: '#4f463c', deco: ['#93a67a', '#d9d2a4'] },
  autumn: { ground: '#7c7051', grass: '#897c5b', hillFar: '#a79f88', hillNear: '#8d846a', leaf: ['#b78a52', '#9f7041', '#c8a364', '#8e6a45'], trunk: '#584a3c', deco: ['#9f733f', '#bd995b', '#7c5a3a'] },
  winter: { ground: '#dde0dc', grass: '#d5d9d5', hillFar: '#c1c8c6', hillNear: '#aab3b1', leaf: null, trunk: '#4e443c', deco: ['#f4f5f3', '#cfd6d6'] }
}

const FLOWER_COLORS = {
  baiju: { petal: '#f7f4ea', edge: '#dcd6c4', heart: '#e8cf6a' },
  huangju: { petal: '#f2c94c', edge: '#d9a92e', heart: '#b9822a' },
  cuibai: { petal: '#4f7d4f', edge: '#3a6440', heart: '#6f9a63' }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }

class Scene {
  constructor(ctx, opts) {
    this.ctx = ctx
    this.o = opts || {}
    this.w = 375
    this.h = 667
    this.seed = hashStr(this.o.seed || 'yunsaomu')
    this.season = 'spring'
    this.phase = 'noon'
    this.weather = 'clear'
    this.quality = 'standard'
    this.tomb = { name: '', dates: '', epitaph: '', style: 'qingshi' }
    this.flowers = []
    this.incense = []
    this.candles = []
    this.peers = []
    this.particles = []
    this.smoke = []
    this.serverOffset = 0
    this.incenseMs = 120000
    this.candleMs = 600000
    this.wipeLevel = 0
    this.cells = null
    this.wipeAcc = 0
    this.sweepAt = 0
    this.bow = null
    this.lastT = 0
    this.frameEma = 16
    this.slowSince = 0
    this.resize(this.w, this.h)
  }

  // ---------- 外部接口 ----------
  resize(w, h) {
    this.w = w
    this.h = h
    this.layout()
    this.genWorld()
  }

  setEnv(env) {
    if (env.season) this.season = env.season
    if (env.phase) this.phase = env.phase
    if (env.weather) this.weather = env.weather
    if (env.quality) this.quality = env.quality
  }

  setTomb(t) {
    const style = t.style || 'qingshi'
    const changed = style !== this.tomb.style
    this.tomb = { name: t.name || '', dates: t.dates || '', epitaph: t.epitaph || '', style }
    if (changed) { this.layout(); this.cells = null }
  }

  setTiming(t) {
    if (t.serverOffset !== undefined) this.serverOffset = t.serverOffset
    if (t.incenseMs) this.incenseMs = t.incenseMs
    if (t.candleMs) this.candleMs = t.candleMs
  }

  now() { return Date.now() + this.serverOffset }

  setOfferings(list) {
    const now = this.now()
    const active = (list || []).filter((o) => o.state === 'active')
    const alive = (o) => !o.expiresAt || Date.parse(o.expiresAt) > now
    this.flowers = active.filter((o) => o.type === 'flower' && alive(o))
      .sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt))
    this.incense = active.filter((o) => o.type === 'incense' && alive(o)).slice(-8)
    this.candles = active.filter((o) => o.type === 'candle' && alive(o)).slice(-6)
  }

  setPeers(peers) {
    const prev = {}
    this.peers.forEach((p) => { prev[p.key] = p })
    this.peers = (peers || []).slice(0, 6).map((p, i) => Object.assign({ bowAt: 0 }, prev[p.key] || {}, p, { slot: i }))
  }

  peerBow(key) {
    const p = this.peers.find((x) => x.key === key)
    if (p) p.bowAt = Date.now()
  }

  // 擦碑：服务端进度（0..1，1 = 干净）。本地灰尘只减不增，远端擦拭会同步下压。
  setWipeLevel(level) {
    this.wipeLevel = clamp(Number(level) || 0, 0, 1)
    const target = 1 - this.wipeLevel
    if (!this.cells) this.initCells(target)
    else for (let i = 0; i < this.cells.length; i++) this.cells[i].d = Math.min(this.cells[i].d, target)
  }

  // 返回 true 表示触点落在碑面上（页面据此阻止其它手势）
  isOnStele(x, y) {
    const f = this.face
    return x >= f.x - 6 && x <= f.x + f.w + 6 && y >= f.y - 6 && y <= f.y + f.h + 6
  }

  wipeAt(x, y) {
    if (this.bow || !this.cells || !this.isOnStele(x, y)) return 0
    const f = this.face
    const r = Math.max(f.w, f.h) * 0.11
    let removed = 0
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.d <= 0) continue
      const dx = c.cx - x
      const dy = c.cy - y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > r) continue
      const k = 0.34 * (1 - dist / r)
      const nd = Math.max(0, c.d - k)
      removed += c.d - nd
      c.d = nd
    }
    const frac = removed / this.cells.length
    this.wipeAcc += frac
    return frac
  }

  consumeWipe() { const v = this.wipeAcc; this.wipeAcc = 0; return v }

  dustAmount() {
    if (!this.cells) return 1 - this.wipeLevel
    let s = 0
    for (let i = 0; i < this.cells.length; i++) s += this.cells[i].d
    return s / this.cells.length
  }

  sweep() { this.sweepAt = Date.now() }

  startBow(cycles) { this.bow = { at: Date.now(), cycles: cycles || 3 } }
  stopBow() { this.bow = null }
  isBowing() { return !!this.bow }

  // ---------- 布局与世界生成 ----------
  layout() {
    const w = this.w
    const h = this.h
    this.horizon = h * 0.4
    this.baseY = h * 0.66
    const cx = w / 2
    const style = this.tomb.style
    let sw; let sh
    if (style === 'wubei') { sw = Math.min(w * 0.5, 240); sh = sw * 0.5 } else { sw = Math.min(w * 0.3, 150); sh = sw * 1.75 }
    if (style !== 'wubei' && sh > h * 0.34) { sh = h * 0.34; sw = sh / 1.75 }
    this.stele = { x: cx - sw / 2, y: this.baseY - sh, w: sw, h: sh, cx }
    const pad = sw * 0.12
    const topPad = style === 'yuanshou' ? sw * 0.36 : style === 'qingshi' ? sw * 0.2 : pad
    this.face = { x: this.stele.x + pad, y: this.stele.y + topPad, w: sw - pad * 2, h: sh - topPad - pad }
    this.table = { x: cx - w * 0.29, y: h * 0.755, w: w * 0.58, h: h * 0.032 }
    this.cells = null
  }

  initCells(dust) {
    const f = this.face
    const cols = 8
    const rows = this.tomb.style === 'wubei' ? 5 : 14
    const R = rng(this.seed ^ 0x51ed)
    const cells = []
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cw = f.w / cols
        const ch = f.h / rows
        const specks = []
        for (let k = 0; k < 5; k++) specks.push({ x: R() * cw, y: R() * ch, r: 0.6 + R() * 1.6, a: 0.4 + R() * 0.6 })
        cells.push({ x: f.x + i * cw, y: f.y + j * ch, w: cw, h: ch, cx: f.x + (i + 0.5) * cw, cy: f.y + (j + 0.5) * ch, d: dust, specks })
      }
    }
    this.cells = cells
  }

  genWorld() {
    const R = rng(this.seed)
    const w = this.w
    const h = this.h
    const hills = (amp, base, freq, phase) => {
      const pts = []
      for (let i = 0; i <= 24; i++) {
        const x = (i / 24) * w
        const y = base - amp * (0.55 * Math.sin(i * freq + phase) + 0.3 * Math.sin(i * freq * 2.3 + phase * 1.7) + 0.15 * Math.sin(i * freq * 5.1))
        pts.push([x, y])
      }
      return pts
    }
    this.hillFar = hills(h * 0.06, this.horizon - h * 0.02, 0.42, R() * 6)
    this.hillNear = hills(h * 0.035, this.horizon + h * 0.012, 0.6, R() * 6)
    this.stars = []
    for (let i = 0; i < 60; i++) this.stars.push({ x: R() * w, y: R() * this.horizon * 0.85, r: 0.4 + R() * 1.1, p: R() * 6 })
    this.clouds = []
    for (let i = 0; i < 7; i++) this.clouds.push({ x: R() * w, y: h * (0.05 + R() * 0.22), s: 0.6 + R() * 0.9, v: 2 + R() * 4 })
    this.trees = [
      { x: w * 0.08, y: h * 0.7, s: 1.25, front: true },
      { x: w * 0.93, y: h * 0.72, s: 1.35, front: true },
      { x: w * 0.2, y: this.horizon + h * 0.05, s: 0.55, front: false },
      { x: w * 0.79, y: this.horizon + h * 0.06, s: 0.6, front: false },
      { x: w * 0.36, y: this.horizon + h * 0.02, s: 0.35, front: false },
      { x: w * 0.66, y: this.horizon + h * 0.025, s: 0.38, front: false }
    ].map((t) => {
      const blobs = []
      for (let i = 0; i < 9; i++) blobs.push({ dx: (R() - 0.5) * 70, dy: -60 - R() * 70, r: 18 + R() * 20, c: Math.floor(R() * 4) })
      return Object.assign(t, { blobs })
    })
    this.deco = []
    for (let i = 0; i < 70; i++) {
      const y = this.horizon + h * 0.04 + R() * (h - this.horizon - h * 0.04)
      this.deco.push({ x: R() * w, y, r: 1 + R() * 2.2, c: Math.floor(R() * 3) })
    }
    this.particles = []
  }

  // ---------- 帧 ----------
  render(t) {
    const ctx = this.ctx
    const now = t || Date.now()
    const dt = this.lastT ? Math.min(100, now - this.lastT) : 16
    this.lastT = now
    this.trackPerf(dt, now)
    const P = PHASE[this.phase] || PHASE.noon
    const S = SEASON[this.season] || SEASON.spring
    const shade = (hex) => mix(hex, NIGHT_TINT, (1 - P.light) * 0.85)
    const grey = this.weather === 'cloudy' || this.weather === 'rain'

    ctx.save()
    ctx.clearRect(0, 0, this.w, this.h)
    const cam = this.camera(now)
    ctx.translate(this.w / 2, this.h * 0.62)
    ctx.scale(cam.scale, cam.scale)
    ctx.translate(-this.w / 2, -this.h * 0.62 + cam.dy)

    this.drawSky(P, grey, now)
    this.drawHills(S, shade)
    this.drawGround(S, shade)
    this.trees.filter((tr) => !tr.front).forEach((tr) => this.drawTree(tr, S, shade))
    this.drawHaze(P, grey)
    this.drawPath(shade)
    this.drawStele(shade, P)
    this.drawDust(now)
    this.drawFlowers(shade, now)
    this.drawTable(shade)
    this.drawIncense(shade, now, dt)
    this.drawCandles(shade, P, now)
    this.drawPeers(shade, now)
    this.trees.filter((tr) => tr.front).forEach((tr) => this.drawTree(tr, S, shade))
    this.drawSmoke(dt, P)
    this.drawGlows(P, now)
    this.drawParticles(dt, now)
    ctx.restore()
    if (cam.vignette > 0) this.drawVignette(cam.vignette)
  }

  trackPerf(dt, now) {
    this.frameEma = this.frameEma * 0.92 + dt * 0.08
    if (this.quality !== 'standard') return
    if (this.frameEma > 34) {
      if (!this.slowSince) this.slowSince = now
      else if (now - this.slowSince > 3000) {
        this.quality = 'smooth'
        this.slowSince = 0
        if (this.o.onQuality) this.o.onQuality('smooth')
      }
    } else this.slowSince = 0
  }

  // 镜头鞠躬（S1-12）：低头稍近；结束后回调
  camera(now) {
    if (!this.bow) return { scale: 1, dy: 0, vignette: 0 }
    const period = 2800
    const el = now - this.bow.at
    if (el >= period * this.bow.cycles) {
      this.bow = null
      if (this.o.onBowEnd) this.o.onBowEnd()
      return { scale: 1, dy: 0, vignette: 0 }
    }
    const p = (el % period) / period
    let k
    if (p < 0.35) k = easeInOut(p / 0.35)
    else if (p < 0.6) k = 1
    else k = 1 - easeInOut((p - 0.6) / 0.4)
    return { scale: 1 + 0.06 * k, dy: -this.h * 0.07 * k, vignette: 0.35 * k }
  }

  drawVignette(a) {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.75)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${a})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.w, this.h)
  }

  drawSky(P, grey, now) {
    const ctx = this.ctx
    const top = grey ? mix(P.skyTop, '#7c8590', 0.6) : P.skyTop
    const bot = grey ? mix(P.skyBot, '#b9bec4', 0.6) : P.skyBot
    const g = ctx.createLinearGradient(0, -this.h * 0.1, 0, this.horizon + this.h * 0.05)
    g.addColorStop(0, top)
    g.addColorStop(1, bot)
    ctx.fillStyle = g
    ctx.fillRect(-this.w * 0.1, -this.h * 0.2, this.w * 1.2, this.horizon + this.h * 0.3)

    if (this.phase === 'night') {
      if (!grey) {
        ctx.fillStyle = '#ffffff'
        this.stars.forEach((s) => {
          ctx.globalAlpha = 0.45 + 0.4 * Math.sin(now / 900 + s.p)
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill()
        })
        ctx.globalAlpha = 1
      }
      const mx = this.w * 0.8
      const my = this.h * 0.11
      ctx.fillStyle = grey ? 'rgba(230,232,236,0.35)' : '#f4efdc'
      ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = mix(P.skyTop, '#24304b', 0.3)
      ctx.beginPath(); ctx.arc(mx + 7, my - 4, 14, 0, Math.PI * 2); ctx.fill()
    } else if (!grey) {
      const pos = { dawn: [0.18, 0.3, '#fbe3b0'], noon: [0.72, 0.1, '#fff8e2'], dusk: [0.82, 0.3, '#f6b07a'] }[this.phase]
      const sx = this.w * pos[0]
      const sy = this.h * pos[1]
      const sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 60)
      sg.addColorStop(0, pos[2])
      sg.addColorStop(0.3, rgba('#fff3d6', 0.5))
      sg.addColorStop(1, 'rgba(255,240,210,0)')
      ctx.fillStyle = sg
      ctx.beginPath(); ctx.arc(sx, sy, 60, 0, Math.PI * 2); ctx.fill()
    }

    const count = grey ? this.clouds.length : 3
    const cc = grey ? (this.phase === 'night' ? 'rgba(70,78,90,0.75)' : 'rgba(214,218,224,0.85)') : (this.phase === 'night' ? 'rgba(120,130,150,0.25)' : 'rgba(255,255,255,0.7)')
    ctx.fillStyle = cc
    for (let i = 0; i < count; i++) {
      const c = this.clouds[i]
      const x = ((c.x + (now / 1000) * c.v) % (this.w + 160)) - 80
      const s = c.s * (grey ? 1.4 : 1)
      ctx.beginPath()
      ctx.arc(x, c.y, 18 * s, 0, Math.PI * 2)
      ctx.arc(x + 20 * s, c.y - 8 * s, 22 * s, 0, Math.PI * 2)
      ctx.arc(x + 44 * s, c.y, 17 * s, 0, Math.PI * 2)
      ctx.rect(x, c.y, 44 * s, 14 * s)
      ctx.fill()
    }
  }

  // 空气透视：地平线附近一层雾，越远越淡
  drawHaze(P, grey) {
    const ctx = this.ctx
    const fog = grey ? mixHex(P.skyBot, '#b9bec4', 0.6) : P.skyBot
    const top = this.horizon - this.h * 0.08
    const bot = this.horizon + this.h * 0.16
    const g = ctx.createLinearGradient(0, top, 0, bot)
    const a = this.phase === 'night' ? 0.35 : 0.62
    g.addColorStop(0, rgba(fog, 0))
    g.addColorStop(0.45, rgba(fog, a))
    g.addColorStop(1, rgba(fog, 0))
    ctx.fillStyle = g
    ctx.fillRect(-this.w * 0.1, top, this.w * 1.2, bot - top)
  }

  poly(pts, bottom, fill) {
    const ctx = this.ctx
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(-this.w * 0.1, bottom)
    pts.forEach((p, i) => { if (i === 0) ctx.lineTo(-this.w * 0.1, p[1]); ctx.lineTo(p[0], p[1]) })
    ctx.lineTo(this.w * 1.1, pts[pts.length - 1][1])
    ctx.lineTo(this.w * 1.1, bottom)
    ctx.closePath()
    ctx.fill()
  }

  drawHills(S, shade) {
    this.poly(this.hillFar, this.horizon + this.h * 0.05, shade(S.hillFar))
    this.poly(this.hillNear, this.horizon + this.h * 0.06, shade(S.hillNear))
  }

  drawGround(S, shade) {
    const ctx = this.ctx
    const g = ctx.createLinearGradient(0, this.horizon, 0, this.h)
    g.addColorStop(0, shade(S.grass))
    g.addColorStop(1, shade(S.ground))
    ctx.fillStyle = g
    ctx.fillRect(-this.w * 0.1, this.horizon + this.h * 0.03, this.w * 1.2, this.h)
    const n = this.quality === 'smooth' ? 35 : this.deco.length
    for (let i = 0; i < n; i++) {
      const d = this.deco[i]
      ctx.fillStyle = shade(S.deco[d.c % S.deco.length])
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
    }
  }

  drawPath(shade) {
    const ctx = this.ctx
    const cx = this.w / 2
    ctx.fillStyle = shade('#b4b0a4')
    ctx.beginPath()
    ctx.moveTo(cx - this.w * 0.09, this.baseY + this.h * 0.02)
    ctx.lineTo(cx + this.w * 0.09, this.baseY + this.h * 0.02)
    ctx.lineTo(cx + this.w * 0.26, this.h + 10)
    ctx.lineTo(cx - this.w * 0.26, this.h + 10)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = shade('#99958a')
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      const y = this.baseY + this.h * 0.02 + i * (this.h - this.baseY) / 6
      const half = this.w * (0.09 + 0.17 * (i / 6))
      ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke()
    }
    // 底座平台
    const s = this.stele
    ctx.fillStyle = shade('#8a877c')
    ctx.fillRect(s.x - s.w * 0.22, this.baseY - 2, s.w * 1.44, this.h * 0.028)
    ctx.fillStyle = shade('#b8b4a8')
    ctx.fillRect(s.x - s.w * 0.22, this.baseY - 2, s.w * 1.44, this.h * 0.008)
  }

  steleShape() {
    const ctx = this.ctx
    const s = this.stele
    ctx.beginPath()
    if (this.tomb.style === 'yuanshou') {
      const r = s.w / 2
      ctx.moveTo(s.x, s.y + s.h)
      ctx.lineTo(s.x, s.y + r)
      ctx.arc(s.cx, s.y + r, r, Math.PI, 0)
      ctx.lineTo(s.x + s.w, s.y + s.h)
    } else if (this.tomb.style === 'wubei') {
      const lean = s.h * 0.12
      ctx.moveTo(s.x, s.y + s.h)
      ctx.lineTo(s.x + lean, s.y)
      ctx.lineTo(s.x + s.w - lean, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.h)
    } else {
      ctx.moveTo(s.x, s.y + s.h)
      ctx.lineTo(s.x, s.y + s.w * 0.12)
      ctx.lineTo(s.x + s.w * 0.08, s.y)
      ctx.lineTo(s.x + s.w * 0.92, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.w * 0.12)
      ctx.lineTo(s.x + s.w, s.y + s.h)
    }
    ctx.closePath()
  }

  drawStele(shade, P) {
    const ctx = this.ctx
    const s = this.stele
    // 投影
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse ? ctx.ellipse(s.cx + s.w * 0.1, this.baseY + 2, s.w * 0.7, s.h * 0.05, 0, 0, Math.PI * 2) : ctx.rect(s.x, this.baseY, s.w, 4)
    ctx.fill()
    const g = ctx.createLinearGradient(s.x, 0, s.x + s.w, 0)
    g.addColorStop(0, shade('#7f7c72'))
    g.addColorStop(0.45, shade('#a7a397'))
    g.addColorStop(1, shade('#68655c'))
    ctx.fillStyle = g
    this.steleShape()
    ctx.fill()
    if (this.season === 'winter') {
      ctx.fillStyle = shade('#f4f7f9')
      ctx.fillRect(s.x + s.w * 0.06, s.y - 2, s.w * 0.88, 4)
    }
    // 碑面内框
    const f = this.face
    ctx.strokeStyle = shade('#5f5c53')
    ctx.lineWidth = 1
    ctx.strokeRect(f.x - 3, f.y - 3, f.w + 6, f.h + 6)
    this.drawMotif(shade)
    this.drawInscription(shade, P)
  }

  // 碑饰（网页版描述）：青石立碑—远山纹；卧碑—两侧回纹；圆首碑—碑额松针纹
  drawMotif(shade) {
    const ctx = this.ctx
    const s = this.stele
    const f = this.face
    ctx.strokeStyle = shade('#5f5c53')
    ctx.lineWidth = 1.2
    ctx.beginPath()
    if (this.tomb.style === 'yuanshou') {
      const cx = s.cx
      const cy = s.y + (f.y - s.y) * 0.55
      const r = s.w * 0.12
      for (let i = -3; i <= 3; i++) {
        const a = -Math.PI / 2 + i * 0.32
        ctx.moveTo(cx, cy + r * 0.6)
        ctx.lineTo(cx + Math.cos(a) * r, cy + r * 0.6 + Math.sin(a) * r)
      }
    } else if (this.tomb.style === 'wubei') {
      const sz = Math.min(10, f.h * 0.14)
      ;[f.x - sz * 1.6, f.x + f.w + sz * 0.6].forEach((x) => {
        for (let k = 0; k < 2; k++) {
          const y = f.y + f.h * 0.25 + k * sz * 1.6
          ctx.rect(x, y, sz, sz)
          ctx.moveTo(x + sz * 0.3, y + sz * 0.3); ctx.lineTo(x + sz * 0.7, y + sz * 0.3); ctx.lineTo(x + sz * 0.7, y + sz * 0.7)
        }
      })
    } else {
      const y = s.y + (f.y - s.y) * 0.62
      const w = s.w * 0.5
      const x0 = s.cx - w / 2
      ctx.moveTo(x0, y)
      ctx.lineTo(x0 + w * 0.22, y - w * 0.14)
      ctx.lineTo(x0 + w * 0.38, y - w * 0.04)
      ctx.lineTo(x0 + w * 0.55, y - w * 0.2)
      ctx.lineTo(x0 + w * 0.75, y - w * 0.05)
      ctx.lineTo(x0 + w, y)
    }
    ctx.stroke()
  }

  vText(text, x, y, fs, maxH) {
    const ctx = this.ctx
    const chars = Array.from(text)
    const step = fs * 1.08
    const n = Math.min(chars.length, Math.max(1, Math.floor(maxH / step)))
    for (let i = 0; i < n; i++) {
      const ch = i === n - 1 && n < chars.length ? '…' : chars[i]
      ctx.fillText(ch, x, y + i * step)
    }
  }

  drawInscription(shade, P) {
    const ctx = this.ctx
    const f = this.face
    const t = this.tomb
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const gold = this.phase === 'night' ? '#e6d29a' : shade('#efe2bb')
    const groove = 'rgba(30,34,30,0.55)'
    if (t.style === 'wubei') {
      const fs = Math.min(f.h * 0.42, f.w / Math.max(2, Array.from(t.name).length + 0.6))
      ctx.font = `${Math.round(fs)}px serif`
      ctx.fillStyle = groove
      ctx.fillText(t.name, f.x + f.w / 2 + 1, f.y + f.h * 0.08 + 1)
      ctx.fillStyle = gold
      ctx.fillText(t.name, f.x + f.w / 2, f.y + f.h * 0.08)
      const small = Math.max(9, Math.round(f.h * 0.13))
      ctx.font = `${small}px serif`
      ctx.fillStyle = shade('#e3dccb')
      if (t.dates) ctx.fillText(t.dates, f.x + f.w / 2, f.y + f.h * 0.52)
      if (t.epitaph) {
        const ep = Array.from(t.epitaph)
        const per = Math.max(4, Math.floor(f.w / (small * 1.05)))
        ctx.fillText(ep.slice(0, per).join('') + (ep.length > per ? '…' : ''), f.x + f.w / 2, f.y + f.h * 0.74)
      }
      return
    }
    const nameLen = Math.max(1, Array.from(t.name).length)
    const fs = Math.min(f.w * 0.38, (f.h * 0.86) / (nameLen * 1.08))
    ctx.font = `${Math.round(fs)}px serif`
    const nx = f.x + f.w / 2
    const ny = f.y + (f.h - Math.min(nameLen, Math.floor((f.h * 0.86) / (fs * 1.08))) * fs * 1.08) / 2
    ctx.fillStyle = groove
    this.vText(t.name, nx + 1, ny + 1, fs, f.h * 0.9)
    ctx.fillStyle = gold
    this.vText(t.name, nx, ny, fs, f.h * 0.9)
    const small = Math.max(8, Math.round(Math.min(f.w * 0.14, 13)))
    ctx.font = `${small}px serif`
    ctx.fillStyle = shade('#e3dccb')
    if (t.dates) this.vText(t.dates, f.x + f.w - small * 0.7, f.y + 4, small, f.h - 8)
    if (t.epitaph) this.vText(t.epitaph, f.x + small * 0.7, f.y + 4, small, f.h - 8)
  }

  drawDust(now) {
    if (!this.cells) this.initCells(1 - this.wipeLevel)
    const ctx = this.ctx
    const smooth = this.quality === 'smooth'
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]
      if (c.d < 0.02) continue
      ctx.fillStyle = `rgba(118,104,84,${(c.d * 0.42).toFixed(3)})`
      ctx.fillRect(c.x, c.y, c.w + 0.5, c.h + 0.5)
      if (smooth) continue
      ctx.fillStyle = `rgba(86,74,58,${(c.d * 0.6).toFixed(3)})`
      for (let k = 0; k < c.specks.length; k++) {
        const s = c.specks[k]
        ctx.beginPath(); ctx.arc(c.x + s.x, c.y + s.y, s.r, 0, Math.PI * 2); ctx.fill()
      }
    }
    // 「一道擦拭」的布巾动画
    const el = now - this.sweepAt
    if (this.sweepAt && el < 900) {
      const f = this.face
      const p = el / 900
      ctx.fillStyle = 'rgba(240,236,226,0.55)'
      ctx.fillRect(f.x - 4, f.y + f.h * p - 10, f.w + 8, 20)
    }
  }

  // 花束（S1-08）：按时间每 3 枝成一束，新的在前排中央，旧的往两侧后排、颜色稍淡
  bundles() {
    const out = []
    for (let i = 0; i < this.flowers.length; i += 3) out.push(this.flowers.slice(i, i + 3))
    return out.slice(-7)
  }

  drawFlowers(shade, now) {
    const bundles = this.bundles()
    if (!bundles.length) return
    const s = this.stele
    const order = [0, -1, 1, -2, 2, -3, 3]
    const n = bundles.length
    const slots = []
    for (let i = 0; i < n; i++) {
      const rank = n - 1 - i
      const o = order[rank]
      slots.push({ b: bundles[i], o, depth: Math.abs(o), age: rank })
    }
    slots.sort((a, b) => b.depth - a.depth)
    slots.forEach((sl) => {
      const x = s.cx + sl.o * s.w * 0.24
      const y = this.baseY + this.h * 0.03 - sl.depth * this.h * 0.006
      const k = this.tomb.style === 'wubei' ? 0.62 : 1
      this.drawBundle(sl.b, x, y, (1 - sl.depth * 0.08) * k, sl.age, shade, now)
    })
  }

  drawBundle(stems, x, y, scale, age, shade, now) {
    const ctx = this.ctx
    const fade = Math.min(0.35, age * 0.06)
    const H = this.h * 0.075 * scale
    const sway = Math.sin(now / 1400 + x) * 0.03
    stems.forEach((st, i) => {
      const k = stems.length === 1 ? 0 : (i / (stems.length - 1) - 0.5)
      const ang = k * 0.5 + sway
      const tx = x + Math.sin(ang) * H
      const ty = y - Math.cos(ang) * H
      ctx.strokeStyle = shade('#3f6a3c')
      ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + k * 6, y - H * 0.5, tx, ty); ctx.stroke()
      const col = FLOWER_COLORS[st.subtype] || FLOWER_COLORS.baiju
      if (st.subtype === 'cuibai') {
        ctx.fillStyle = shade(mixHex(col.petal, '#8a8a7a', fade))
        for (let j = 0; j < 5; j++) {
          ctx.beginPath(); ctx.arc(tx + (j - 2) * 2.4 * scale, ty + Math.abs(j - 2) * 2.5, 3.4 * scale, 0, Math.PI * 2); ctx.fill()
        }
      } else {
        const r = 7 * scale
        ctx.fillStyle = shade(mixHex(col.petal, '#9c9586', fade))
        for (let j = 0; j < 10; j++) {
          const a = (j / 10) * Math.PI * 2
          ctx.beginPath(); ctx.arc(tx + Math.cos(a) * r * 0.62, ty + Math.sin(a) * r * 0.5, r * 0.42, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillStyle = col.heart
        ctx.beginPath(); ctx.arc(tx, ty, r * 0.32, 0, Math.PI * 2); ctx.fill()
      }
    })
    // 包装纸
    ctx.fillStyle = shade('#efe6d2')
    ctx.beginPath()
    ctx.moveTo(x - 8 * scale, y - 10 * scale)
    ctx.lineTo(x + 8 * scale, y - 10 * scale)
    ctx.lineTo(x + 3 * scale, y + 4 * scale)
    ctx.lineTo(x - 3 * scale, y + 4 * scale)
    ctx.closePath()
    ctx.fill()
  }

  drawTable(shade) {
    const ctx = this.ctx
    const t = this.table
    ctx.fillStyle = shade('#6f6b62')
    ctx.fillRect(t.x + t.w * 0.08, t.y + t.h, t.w * 0.1, this.h * 0.04)
    ctx.fillRect(t.x + t.w * 0.82, t.y + t.h, t.w * 0.1, this.h * 0.04)
    ctx.fillStyle = shade('#8a867b')
    ctx.fillRect(t.x, t.y, t.w, t.h)
    ctx.fillStyle = shade('#a29e92')
    ctx.fillRect(t.x, t.y, t.w, t.h * 0.3)
    // 香炉
    const bx = t.x + t.w / 2
    const by = t.y
    this.burner = { x: bx, y: by - this.h * 0.028, r: t.w * 0.13 }
    ctx.fillStyle = shade('#6b5a3c')
    ctx.beginPath()
    ctx.moveTo(bx - this.burner.r, by - this.h * 0.03)
    ctx.lineTo(bx + this.burner.r, by - this.h * 0.03)
    ctx.lineTo(bx + this.burner.r * 0.75, by)
    ctx.lineTo(bx - this.burner.r * 0.75, by)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = shade('#8a7650')
    ctx.fillRect(bx - this.burner.r * 1.05, by - this.h * 0.034, this.burner.r * 2.1, this.h * 0.006)
  }

  incenseFrac(o, now) {
    const exp = Date.parse(o.expiresAt)
    return clamp((exp - now) / this.incenseMs, 0, 1)
  }

  drawIncense(shade, now, dt) {
    if (!this.incense.length || !this.burner) return
    const ctx = this.ctx
    const b = this.burner
    const n = this.incense.length
    const H = this.h * 0.07
    const snow = this.quality === 'smooth' ? 0.5 : 1
    this.incense.forEach((o, i) => {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5
      const x = b.x + k * b.r * 1.3
      const frac = this.incenseFrac(o, this.now())
      const len = H * (0.25 + 0.75 * frac)
      const top = b.y - len
      ctx.strokeStyle = shade('#9c3b2c')
      ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, top); ctx.stroke()
      ctx.fillStyle = '#ff8a3c'
      ctx.beginPath(); ctx.arc(x, top, 1.6, 0, Math.PI * 2); ctx.fill()
      if (Math.random() < 0.09 * snow * (dt / 16)) {
        this.smoke.push({ x, y: top, vx: (Math.random() - 0.5) * 0.02, vy: -0.03 - Math.random() * 0.015, r: 1.1, a: 0.26, life: 0 })
      }
    })
  }

  drawSmoke(dt, P) {
    if (!this.smoke.length) return
    const ctx = this.ctx
    const col = this.phase === 'night' ? '200,205,215' : '236,236,232'
    const next = []
    for (let i = 0; i < this.smoke.length; i++) {
      const p = this.smoke[i]
      p.life += dt
      p.x += p.vx * dt + Math.sin(p.life / 420) * 0.18
      p.y += p.vy * dt
      p.r += 0.0022 * dt
      p.a -= 0.00009 * dt
      if (p.a <= 0) continue
      ctx.fillStyle = `rgba(${col},${p.a.toFixed(3)})`
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      next.push(p)
    }
    this.smoke = next.slice(-90)
  }

  candleSlots() {
    const t = this.table
    const slots = []
    for (let i = 0; i < this.candles.length; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const step = Math.floor(i / 2)
      slots.push({ x: t.x + t.w / 2 + side * (t.w * 0.26 + step * t.w * 0.07), y: t.y, o: this.candles[i] })
    }
    return slots
  }

  drawCandles(shade, P, now) {
    const ctx = this.ctx
    this.candleSlots().forEach((c, i) => {
      const h = this.h * 0.03
      ctx.fillStyle = shade('#f1ebdc')
      ctx.fillRect(c.x - 3, c.y - h, 6, h)
      ctx.fillStyle = shade('#c9a24f')
      ctx.fillRect(c.x - 5, c.y - 2, 10, 2)
      const fl = 1 + Math.sin(now / 90 + i * 1.7) * 0.12 + Math.sin(now / 37 + i) * 0.05
      const fx = c.x
      const fy = c.y - h - 1
      ctx.fillStyle = '#ffd27a'
      ctx.beginPath()
      ctx.moveTo(fx, fy - 9 * fl)
      ctx.quadraticCurveTo(fx + 4, fy - 2, fx, fy)
      ctx.quadraticCurveTo(fx - 4, fy - 2, fx, fy - 9 * fl)
      ctx.fill()
      ctx.fillStyle = '#fff4d0'
      ctx.beginPath(); ctx.arc(fx, fy - 2.5, 1.4, 0, Math.PI * 2); ctx.fill()
    })
  }

  // 烛光光晕：夜间对比更高（S1-06 / S1-10）
  drawGlows(P, now) {
    const slots = this.candleSlots()
    if (!slots.length && !this.incense.length) return
    const ctx = this.ctx
    const smooth = this.quality === 'smooth'
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    slots.forEach((c, i) => {
      const r = (smooth ? 30 : 46) * (0.7 + P.glow * 0.6) * (1 + Math.sin(now / 120 + i) * 0.04)
      const y = c.y - this.h * 0.03 - 5
      const g = ctx.createRadialGradient(c.x, y, 1, c.x, y, r)
      g.addColorStop(0, `rgba(255,196,110,${(0.25 + 0.45 * P.glow).toFixed(3)})`)
      g.addColorStop(1, 'rgba(255,170,80,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(c.x, y, r, 0, Math.PI * 2); ctx.fill()
    })
    ctx.restore()
  }

  // 他人剪影（远处）：鞠躬时上身前倾
  drawPeers(shade, now) {
    if (!this.peers.length) return
    const ctx = this.ctx
    const xs = [0.2, 0.8, 0.28, 0.72, 0.13, 0.87]
    this.peers.forEach((p, i) => {
      const x = this.w * xs[i % xs.length]
      const y = this.h * (0.8 + (i % 2) * 0.01)
      const facing = x < this.w / 2 ? 1 : -1
      let bend = 0
      if (p.bowAt) {
        const el = now - p.bowAt
        if (el < 2800 * 3) {
          const ph = (el % 2800) / 2800
          bend = ph < 0.35 ? easeInOut(ph / 0.35) : ph < 0.6 ? 1 : 1 - easeInOut((ph - 0.6) / 0.4)
        } else p.bowAt = 0
      }
      // 约 45px 高的远处剪影
      const u = this.h * 0.0011
      ctx.fillStyle = this.phase === 'night' ? 'rgba(20,24,30,0.85)' : 'rgba(40,46,44,0.72)'
      ctx.fillRect(x - 6 * u, y - 26 * u, 12 * u, 26 * u)
      ctx.save()
      ctx.translate(x, y - 26 * u)
      ctx.rotate(facing * bend * 0.7)
      ctx.fillRect(-6.5 * u, -22 * u, 13 * u, 22 * u)
      ctx.beginPath(); ctx.arc(0, -28 * u, 6 * u, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    })
  }

  drawTree(tr, S, shade) {
    const ctx = this.ctx
    const s = tr.s * (this.h / 760)
    ctx.strokeStyle = shade(S.trunk)
    ctx.lineCap = 'round'
    ctx.lineWidth = 7 * s
    ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.x, tr.y - 70 * s); ctx.stroke()
    ctx.lineWidth = 3.5 * s
    ctx.beginPath()
    ctx.moveTo(tr.x, tr.y - 50 * s); ctx.lineTo(tr.x - 26 * s, tr.y - 92 * s)
    ctx.moveTo(tr.x, tr.y - 62 * s); ctx.lineTo(tr.x + 28 * s, tr.y - 104 * s)
    ctx.moveTo(tr.x, tr.y - 70 * s); ctx.lineTo(tr.x + 2 * s, tr.y - 118 * s)
    ctx.stroke()
    if (!S.leaf) {
      ctx.fillStyle = shade('#f5f8fa')
      ;[[-26, -92], [28, -104], [2, -118]].forEach((p) => {
        ctx.beginPath(); ctx.ellipse ? ctx.ellipse(tr.x + p[0] * s, tr.y + p[1] * s, 7 * s, 3 * s, 0, 0, Math.PI * 2) : ctx.arc(tr.x + p[0] * s, tr.y + p[1] * s, 5 * s, 0, Math.PI * 2); ctx.fill()
      })
      return
    }
    tr.blobs.forEach((b) => {
      ctx.fillStyle = shade(S.leaf[b.c % S.leaf.length])
      ctx.beginPath(); ctx.arc(tr.x + b.dx * s, tr.y + b.dy * s, b.r * s, 0, Math.PI * 2); ctx.fill()
    })
  }

  particleKind() {
    if (this.season === 'winter') return 'snow'
    if (this.weather === 'rain') return 'rain'
    if (this.season === 'spring') return 'petal'
    if (this.season === 'autumn') return 'leaf'
    return this.phase === 'night' ? 'firefly' : 'none'
  }

  drawParticles(dt, now) {
    const kind = this.particleKind()
    const smooth = this.quality === 'smooth'
    const heavy = this.weather === 'rain'
    const target = { snow: heavy ? 120 : 70, rain: 110, petal: 26, leaf: 22, firefly: 18, none: 0 }[kind] * (smooth ? 0.5 : 1)
    const ctx = this.ctx
    const W = this.w
    const H = this.h
    while (this.particles.length < target) {
      this.particles.push({
        k: kind, x: Math.random() * W, y: Math.random() * H - H * (kind === 'firefly' ? 0 : 0.2),
        v: kind === 'rain' ? 0.7 + Math.random() * 0.3 : kind === 'snow' ? 0.03 + Math.random() * 0.04 : 0.025 + Math.random() * 0.03,
        p: Math.random() * 6, r: kind === 'snow' ? 1 + Math.random() * 2 : 2 + Math.random() * 2,
        c: Math.floor(Math.random() * 4)
      })
    }
    // 雨也叠加在冬雪/春花之外（冬季下雨显示为大雪）
    const rainOverlay = heavy && kind !== 'rain' && kind !== 'snow'
    const next = []
    const S = SEASON[this.season]
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (p.k !== kind) continue
      if (next.length >= target) break
      if (kind === 'rain') {
        p.y += p.v * dt; p.x -= p.v * dt * 0.18
        ctx.strokeStyle = this.phase === 'night' ? 'rgba(170,185,210,0.35)' : 'rgba(210,222,235,0.55)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 3, p.y - 14); ctx.stroke()
      } else if (kind === 'snow') {
        p.y += p.v * dt * (heavy ? 1.5 : 1); p.x += Math.sin(now / 1200 + p.p) * 0.25
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      } else if (kind === 'firefly') {
        p.x += Math.sin(now / 900 + p.p) * 0.3; p.y += Math.cos(now / 1100 + p.p) * 0.2
        if (p.y < this.horizon) p.y = this.horizon + 20
        ctx.fillStyle = `rgba(230,255,150,${(0.4 + 0.5 * Math.sin(now / 300 + p.p)).toFixed(3)})`
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill()
      } else {
        p.y += p.v * dt; p.x += Math.sin(now / 900 + p.p) * 0.5 - 0.1
        const col = (S.leaf || ['#ffffff'])[p.c % (S.leaf || ['#fff']).length]
        ctx.fillStyle = col
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(now / 700 + p.p)
        ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r)
        ctx.restore()
      }
      if (p.y > H + 20 || p.x < -30 || p.x > W + 30) { p.y = -10; p.x = Math.random() * W * 1.1 }
      next.push(p)
    }
    this.particles = next
    if (rainOverlay) {
      ctx.strokeStyle = this.phase === 'night' ? 'rgba(170,185,210,0.3)' : 'rgba(210,222,235,0.45)'
      ctx.lineWidth = 1
      const n = smooth ? 30 : 60
      for (let i = 0; i < n; i++) {
        const x = (i * 97 + now * 0.05) % W
        const y = (i * 131 + now * 0.7) % H
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 14); ctx.stroke()
      }
    }
  }
}

Scene.SEASON = SEASON
Scene.PHASE = PHASE
module.exports = Scene
