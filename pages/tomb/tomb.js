const api = require('../../utils/api')
const store = require('../../utils/store')
const v = require('../../utils/validate')
const envu = require('../../utils/env')
const Hints = require('../../utils/hints')
const Realtime = require('../../utils/realtime')
const Scene = require('../../scene/engine')
const Memorial3D = require('../../scene3d/memorial3d')
const config = require('../../config')

const FLOWERS = [
  { id: 'baiju', name: '白菊' },
  { id: 'huangju', name: '黄菊' },
  { id: 'cuibai', name: '翠柏' }
]
const K_ENV = 'ysm.env'
const SEASON_LABEL = { spring: '春日花开', summer: '夏日林荫', autumn: '秋日落叶', winter: '冬日飘雪' }
const PHASE_LABEL = { dawn: '晨', noon: '午', dusk: '黄昏', night: '夜' }
const WEATHER_CHAR = { clear: '晴', cloudy: '阴', rain: '雨' }
const SHEET_TITLE = { flower: '献一束花', message: '留言', settings: '景 · 场景与我', invite: '邀请家人' }

function datesLabel(t) {
  const b = t.birthDate ? v.formatDate(t.birthDate, t.birthPrecision) : (t.birthYear ? String(t.birthYear) : '')
  const d = t.deathDate ? v.formatDate(t.deathDate, t.deathPrecision) : (t.deathYear ? String(t.deathYear) : '')
  if (b && d) return `${b}—${d}`
  if (b) return `生于${b}`
  if (d) return `卒于${d}`
  return ''
}

Page({
  data: {
    status: 'loading', // loading | ready | error
    errMsg: '',
    navTop: 24, navH: 32,
    tombName: '',
    role: 'guest',
    online: 1,
    live: false,
    hint: '',
    hintOn: false,
    bowing: false,
    sheet: '', // flower | message | settings | invite
    flowers: FLOWERS,
    seasons: envu.SEASONS,
    tods: envu.TODS,
    weathers: envu.WEATHERS,
    env: { season: '', tod: 'auto', weather: 'clear', quality: 'standard' },
    displayName: '',
    nameErr: '',
    inscriptions: [],
    pendingCount: 0,
    draft: '',
    posting: false,
    canShare: false,
    seasonLabel: '', phaseLabel: '', weatherChar: '晴',
    sheetTitle: '',
    mode: '3d', // 3d | 2d（WebGL 不可用时退回 2D 画面）
    gestureTip: true,
    wipeShow: false, wipePct: 0
  },

  onLoad(q) {
    const dec = (x) => { try { return decodeURIComponent(x || '') } catch (e) { return x || '' } }
    const id = dec(q.id)
    const kind = q.adm ? 'adm' : 'inv'
    const token = dec(q.adm || q.inv)
    this.tombId = id
    this.auth = { token, tokenKind: kind }
    this.sessionId = store.getSessionId()
    this.offerings = []
    this.hints = new Hints()
    try {
      const m = wx.getMenuButtonBoundingClientRect()
      this.setData({ navTop: m.top, navH: m.height })
    } catch (e) { /* 旧基础库忽略 */ }
    let savedEnv = {}
    try { savedEnv = wx.getStorageSync(K_ENV) || {} } catch (e) { /* */ }
    this.setData({
      displayName: store.getDisplayName(),
      env: Object.assign({}, this.data.env, savedEnv, { season: '' })
    })
    if (!id || !token) {
      this.setData({ status: 'error', errMsg: '这条链接无效或已失效，无法进入纪念墓。' })
      return
    }
    this.enter()
  },

  async enter() {
    try {
      const res = await api.enter(this.tombId, {
        token: this.auth.token,
        tokenKind: this.auth.tokenKind,
        displayName: store.getDisplayName(),
        sessionId: this.sessionId
      })
      this.serverOffset = (res.serverTime || Date.now()) - Date.now()
      this.tomb = res.tomb
      this.offerings = res.offerings || []
      const role = res.session.role
      const rec = store.getTomb(this.tombId) || {}
      const inv = this.auth.tokenKind === 'inv' ? this.auth.token : rec.inv
      store.upsertTomb({
        id: this.tombId, name: res.tomb.deceasedName,
        inv: this.auth.tokenKind === 'inv' ? this.auth.token : '',
        adm: this.auth.tokenKind === 'adm' ? this.auth.token : ''
      })
      this.inviteToken = inv || ''
      this.setData({
        status: 'ready',
        tombName: res.tomb.deceasedName,
        role,
        canShare: !!this.inviteToken
      })
      wx.setNavigationBarTitle({ title: res.tomb.deceasedName })
      if (this.inviteToken) wx.showShareMenu({ menus: ['shareAppMessage'] })
      else wx.hideShareMenu()
      this.setInscriptions(res.inscriptions || [])
      this.applyTomb()
      this.startRealtime()
      this.startTimers()
      if (this.ctxReady) this.pushScene()
      this.initCanvas()
    } catch (e) {
      const msg = e.code === 'full' ? e.message : (e.status === 404 ? '这条链接无效或已失效，无法进入纪念墓。' : e.message)
      this.setData({ status: 'error', errMsg: msg })
    }
  },

  // ---------- 画布 ----------
  pixelRatio() {
    let pr = 2
    try { pr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2 } catch (e) { /* */ }
    return pr
  },

  initCanvas() {
    if (this.scene) return
    if (this.data.mode === '3d') this.init3D()
    else this.init2D()
    setTimeout(() => this.setData({ gestureTip: false }), 6500)
  },

  init3D() {
    wx.nextTick(() => {
      wx.createSelectorQuery().in(this).select('#scene3d').fields({ node: true, size: true }).exec((res) => {
        const r = res && res[0]
        if (!r || !r.node) { this.fallback2D(); return }
        try {
          const { createScopedThreejs } = require('../../libs/threejs-miniprogram')
          const canvas = r.node
          const THREE = createScopedThreejs(canvas)
          this.canvas = canvas
          this.cssW = r.width
          this.cssH = r.height
          this.basePr = this.pixelRatio()
          this.is3D = true
          this.scene = new Memorial3D(THREE, canvas, {
            width: r.width,
            height: r.height,
            pixelRatio: this.data.env.quality === 'smooth' ? 1 : Math.min(2, this.basePr),
            seed: this.tombId,
            createCanvas: (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h }),
            onBowEnd: () => this.setData({ bowing: false }),
            onQuality: (q) => {
              this.setData({ 'env.quality': q })
              this.applyPixelRatio()
              wx.showToast({ title: '已切换到流畅画质', icon: 'none' })
            }
          })
          this.ctxReady = true
          this.pushScene()
          this.loop()
        } catch (e) {
          console.error('3D 初始化失败，改用 2D', e)
          this.fallback2D()
        }
      })
    })
  },

  fallback2D() {
    this.is3D = false
    this.scene = null
    this.canvas = null
    this.setData({ mode: '2d' }, () => this.init2D())
  },

  init2D() {
    wx.nextTick(() => {
      wx.createSelectorQuery().in(this).select('#scene').fields({ node: true, size: true }).exec((res) => {
        const r = res && res[0]
        if (!r || !r.node) return
        const canvas = r.node
        const ctx = canvas.getContext('2d')
        this.canvas = canvas
        this.ctx = ctx
        this.cssW = r.width
        this.cssH = r.height
        this.basePr = this.pixelRatio()
        this.scene = new Scene(ctx, {
          seed: this.tombId,
          onBowEnd: () => this.setData({ bowing: false }),
          onQuality: (q) => {
            this.setData({ 'env.quality': q })
            this.applyPixelRatio()
            wx.showToast({ title: '已切换到流畅画质', icon: 'none' })
          }
        })
        this.applyPixelRatio()
        this.ctxReady = true
        this.pushScene()
        this.loop()
      })
    })
  },

  applyPixelRatio() {
    if (!this.canvas || !this.scene) return
    const pr = this.data.env.quality === 'smooth' ? 1 : Math.min(2, this.basePr)
    if (this.is3D) { this.scene.resize(this.cssW, this.cssH, pr); return }
    this.canvas.width = Math.round(this.cssW * pr)
    this.canvas.height = Math.round(this.cssH * pr)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(pr, pr)
    this.scene.resize(this.cssW, this.cssH)
    this.pushScene()
  },

  loop() {
    if (!this.canvas || this.stopped) return
    this.rafId = this.canvas.requestAnimationFrame(() => {
      try { this.scene.render(Date.now()) } catch (e) { console.error(e) }
      this.loop()
    })
  },

  applyTomb() {
    const t = this.tomb || {}
    this.tombLabel = { name: t.deceasedName || '', dates: datesLabel(t), epitaph: t.epitaph || '', style: t.steleStyleId || 'qingshi' }
    this.seasonMode = t.seasonMode || 'auto'
  },

  pushScene() {
    if (!this.scene) return
    const e = this.data.env
    const season = envu.resolveSeason(this.seasonMode, e.season || null)
    const phase = envu.resolvePhase(e.tod)
    this.setData({ seasonLabel: SEASON_LABEL[season], phaseLabel: PHASE_LABEL[phase], weatherChar: WEATHER_CHAR[e.weather] || '晴' })
    this.scene.setTomb(this.tombLabel || {})
    this.scene.setTiming({ serverOffset: this.serverOffset || 0, incenseMs: 120000, candleMs: 600000 })
    this.scene.setEnv({
      season,
      phase,
      weather: e.weather,
      quality: e.quality
    })
    this.scene.setOfferings(this.offerings)
    if (this.tomb) this.scene.setWipeLevel(this.tomb.wipeLevel || 0)
  },

  // ---------- 实时 ----------
  startRealtime() {
    if (this.rt) return
    this.rt = new Realtime(this.tombId, this.sessionId, {
      onStatus: (s) => this.setData({ live: s === 'online' }),
      onServer: (msg) => this.onServer(msg),
      onPresence: (list) => {
        const others = list.filter((p) => p.key !== this.sessionId)
        this.setData({ online: Math.max(1, others.length + 1) })
        if (this.scene) this.scene.setPeers(others.map((p) => ({ key: p.key })))
      }
    })
    this.rt.track({ at: Date.now() })
    this.rt.connect()
  },

  onServer(msg) {
    const ev = msg.event || {}
    if (msg.serverTime) this.serverOffset = msg.serverTime - Date.now()
    if (ev.kind === 'offering' || ev.kind === 'offering-update') {
      const o = ev.offering
      const i = this.offerings.findIndex((x) => x.id === o.id)
      if (i >= 0) this.offerings[i] = o; else this.offerings.push(o)
      if (this.scene) this.scene.setOfferings(this.offerings)
      if (ev.kind === 'offering' && o.sessionId !== this.sessionId) {
        this.showHint(o.type)
        if (o.type === 'bow' && this.scene) this.scene.peerBow(o.sessionId)
      }
    } else if (ev.kind === 'queue' && ev.sessionId === this.sessionId) {
      wx.showToast({ title: ev.message || '请稍候', icon: 'none' })
    } else if (ev.kind === 'wipe') {
      if (this.tomb) this.tomb.wipeLevel = ev.level
      if (this.scene) this.scene.setWipeLevel(ev.level)
      if (ev.sessionId !== this.sessionId) this.showHint('wipe')
    } else if (ev.kind === 'inscription-update') {
      this.mergeInscription(ev.inscription)
    } else if (ev.kind === 'tomb-update' && ev.tomb) {
      this.tomb = Object.assign({}, this.tomb, ev.tomb)
      this.applyTomb()
      this.setData({ tombName: this.tomb.deceasedName })
      this.pushScene()
    }
  },

  showHint(kind) {
    const text = this.hints.push(kind, Date.now())
    if (!text) return
    this.setData({ hint: text, hintOn: true })
  },

  startTimers() {
    this.hb = setInterval(() => {
      api.heartbeat(this.tombId, this.auth, this.sessionId).catch(() => {})
    }, config.heartbeatMs)
    this.tick = setInterval(() => {
      if (this.scene) this.scene.setOfferings(this.offerings)
      if (this.data.hintOn && !this.hints.visible(Date.now())) this.setData({ hintOn: false })
      this.flushWipe()
    }, 700)
  },

  stopTimers() {
    clearInterval(this.hb)
    clearInterval(this.tick)
  },

  // ---------- 擦碑 ----------
  onTouchStart(e) {
    const ts = e.touches || []
    if (!this.scene || !ts.length) return
    if (ts.length >= 2 && this.is3D) {
      this.wiping = false
      this.pinch = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y)
      return
    }
    const t = ts[0]
    this.wiping = this.scene.isOnStele(t.x, t.y)
    this.lastTouch = { x: t.x, y: t.y }
    if (this.wiping) this.showWipe()
    if (this.data.gestureTip) this.setData({ gestureTip: false })
  },
  onTouchMove(e) {
    const ts = e.touches || []
    if (!this.scene || !ts.length) return
    if (ts.length >= 2 && this.is3D) {
      const d = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y)
      if (this.pinch) this.scene.zoomBy(this.pinch / Math.max(1, d))
      this.pinch = d
      return
    }
    const t = ts[0]
    if (this.wiping) {
      this.scene.wipeAt(t.x, t.y)
      const pct = Math.round((1 - this.scene.dustAmount()) * 100)
      if (pct !== this.data.wipePct) this.setData({ wipePct: pct })
      return
    }
    if (this.is3D && this.lastTouch) {
      this.scene.dragBy(t.x - this.lastTouch.x, t.y - this.lastTouch.y)
      this.lastTouch = { x: t.x, y: t.y }
    }
  },
  showWipe() {
    clearTimeout(this.wipeHide)
    if (!this.data.wipeShow) this.setData({ wipeShow: true })
    if (this.scene) this.setData({ wipePct: Math.round((1 - this.scene.dustAmount()) * 100) })
    this.wipeHide = setTimeout(() => this.setData({ wipeShow: false }), 2600)
  },
  onTouchEnd(e) {
    if (this.wiping) this.showWipe()
    this.wiping = false
    this.pinch = 0
    this.lastTouch = null
    this.flushWipe()
  },
  flushWipe() {
    if (!this.scene || this.wipeBusy) return
    const inc = this.scene.consumeWipe()
    if (inc < 0.004) return
    this.wipeBusy = true
    api.wipe(this.tombId, this.auth, { sessionId: this.sessionId, progress: Math.min(1, inc) })
      .then((r) => { if (this.tomb) this.tomb.wipeLevel = r.wipeLevel; this.scene.setWipeLevel(r.wipeLevel) })
      .catch(() => {})
      .then(() => { this.wipeBusy = false })
  },
  wipeOnce() {
    if (!this.scene) return
    this.scene.sweep()
    this.showWipe()
    api.wipe(this.tombId, this.auth, { sessionId: this.sessionId, progress: 0.35 })
      .then((r) => { if (this.tomb) this.tomb.wipeLevel = r.wipeLevel; this.scene.setWipeLevel(r.wipeLevel); this.showWipe() })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },

  // ---------- 祭奠动作 ----------
  async offer(type, subtype) {
    try {
      const res = await api.offer(this.tombId, this.auth, { sessionId: this.sessionId, type, subtype })
      if (res.queued) { wx.showToast({ title: res.queued.message, icon: 'none' }); return }
      if (res.offering) {
        const i = this.offerings.findIndex((x) => x.id === res.offering.id)
        if (i < 0) this.offerings.push(res.offering)
        if (this.scene) this.scene.setOfferings(this.offerings)
      }
    } catch (e) {
      if (e.status === 400 && /进入/.test(e.message)) { await this.enter(); return }
      wx.showToast({ title: e.message, icon: 'none' })
    }
  },
  openFlowers() { this.openSheet('flower') },
  openSheet(k) { this.setData({ sheet: k, sheetTitle: SHEET_TITLE[k] || '' }) },
  pickFlower(e) {
    this.setData({ sheet: '' })
    this.offer('flower', e.currentTarget.dataset.id)
  },
  doIncense() { this.offer('incense') },
  doCandle() { this.offer('candle') },
  toggleBow() {
    if (!this.scene) return
    if (this.scene.isBowing()) { this.scene.stopBow(); this.setData({ bowing: false }); return }
    this.scene.startBow(3)
    this.setData({ bowing: true })
    this.offer('bow')
  },

  // ---------- 留言 ----------
  setInscriptions(list) {
    const pend = list.filter((x) => x.status === 'pending').length
    this.setData({
      inscriptions: list.slice().reverse().map((x) => Object.assign({}, x, { time: (x.createdAt || '').slice(0, 10) })),
      pendingCount: this.data.role === 'creator' ? pend : 0
    })
    this.rawIns = list
  },
  mergeInscription(ins) {
    if (!ins) return
    const list = (this.rawIns || []).slice()
    const i = list.findIndex((x) => x.id === ins.id)
    const mine = ins.sessionId === this.sessionId
    const visible = ins.status === 'approved' || this.data.role === 'creator' || (mine && ins.status === 'pending')
    if (i >= 0) {
      if (visible) list[i] = Object.assign({}, list[i], ins); else list.splice(i, 1)
    } else if (visible) list.push(ins)
    if (i < 0 && ins.status === 'approved' && !mine) this.showHint('inscription')
    this.setInscriptions(list)
  },
  openMessages() { this.openSheet('message') },
  onDraft(e) { this.setData({ draft: e.detail.value }) },
  async postMessage() {
    const body = (this.data.draft || '').trim()
    if (!body) { wx.showToast({ title: '请写下想说的话', icon: 'none' }); return }
    if (v.len(body) > 140) { wx.showToast({ title: '留言请不超过 140 个字', icon: 'none' }); return }
    this.setData({ posting: true })
    try {
      const res = await api.inscribe(this.tombId, this.auth, { body, displayName: store.getDisplayName(), sessionId: this.sessionId })
      if (res.rejected) { wx.showToast({ title: res.message, icon: 'none' }); return }
      this.mergeInscription(Object.assign({}, res.inscription, { mine: true, sessionId: this.sessionId }))
      this.setData({ draft: '' })
      wx.showToast({ title: '已提交，审核通过后亲友可见', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    } finally {
      this.setData({ posting: false })
    }
  },
  async moderate(e) {
    const { id, action } = e.currentTarget.dataset
    try {
      const res = await api.moderate(this.tombId, id, this.auth.token, action)
      this.mergeInscription(res.inscription)
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' })
    }
  },

  // ---------- 设置 ----------
  openSettings() { this.setData({ nameErr: '' }); this.openSheet('settings') },
  cycleWeather() {
    const order = ['clear', 'cloudy', 'rain']
    const next = order[(order.indexOf(this.data.env.weather) + 1) % order.length]
    this.setEnvKey({ currentTarget: { dataset: { key: 'weather', val: next } } })
    wx.showToast({ title: '天气：' + ({ clear: '晴', cloudy: '阴', rain: '细雨' })[next], icon: 'none' })
  },
  setEnvKey(e) {
    const { key, val } = e.currentTarget.dataset
    const env = Object.assign({}, this.data.env, { [key]: val })
    this.setData({ env })
    const { tod, weather, quality } = env
    try { wx.setStorageSync(K_ENV, { tod, weather, quality }) } catch (err) { /* */ }
    if (key === 'quality' && this.scene) { this.scene.setEnv({ quality: val }); this.applyPixelRatio() }
    this.pushScene()
  },
  onDisplayName(e) { this.setData({ displayName: e.detail.value, nameErr: '' }) },
  saveDisplayName() {
    const err = v.validateDisplayName(this.data.displayName)
    if (err) { this.setData({ nameErr: err }); return }
    store.setDisplayName(this.data.displayName)
    this.setData({ displayName: store.getDisplayName() })
    wx.showToast({ title: '已保存', icon: 'none' })
    api.enter(this.tombId, { token: this.auth.token, tokenKind: this.auth.tokenKind, displayName: store.getDisplayName(), sessionId: this.sessionId }).catch(() => {})
  },

  // ---------- 邀请 ----------
  openInvite() {
    if (!this.inviteToken) { wx.showToast({ title: '这台手机上没有这座墓的邀请链接', icon: 'none' }); return }
    this.openSheet('invite')
  },
  copyWebLink() {
    wx.setClipboardData({ data: `${config.webOrigin}/t/${this.tombId}?inv=${encodeURIComponent(this.inviteToken)}` })
  },
  onShareAppMessage() {
    const t = this.tomb || {}
    const title = t.showNameInShare !== false && t.deceasedName ? `来为${t.deceasedName}扫扫墓` : '一座家人的纪念墓'
    return {
      title,
      path: `/pages/tomb/tomb?id=${encodeURIComponent(this.tombId)}&inv=${encodeURIComponent(this.inviteToken || '')}`,
      imageUrl: '/assets/share-cover.png'
    }
  },

  closeSheet() { this.setData({ sheet: '' }) },
  noop() {},
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/index/index' })
  },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }) },

  // ---------- 生命周期 ----------
  onShow() {
    if (this.stopped && this.canvas) { this.stopped = false; this.loop() }
  },
  onHide() {
    this.stopped = true
    if (this.scene && this.scene.isBowing()) { this.scene.stopBow(); this.setData({ bowing: false }) }
  },
  onUnload() {
    this.stopped = true
    this.stopTimers()
    if (this.rt) this.rt.close()
    if (this.tombId && this.auth && this.data.status === 'ready') api.leave(this.tombId, this.auth, this.sessionId).catch(() => {})
  }
})
