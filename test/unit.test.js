// node --test test/  —— 纯逻辑与页面流程测试（用模拟的 wx / Page 运行小程序页面代码）
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')

// ---------- 模拟小程序运行时 ----------
const storage = {}
const requests = []
let routeHandler = null
let lastPage = null
const toasts = []
global.wx = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)) },
  removeStorageSync: (k) => { delete storage[k] },
  request: (opt) => {
    requests.push(opt)
    const r = routeHandler(opt)
    setTimeout(() => opt.success({ statusCode: r[0], data: r[1] }), 0)
  },
  connectSocket: () => ({ onOpen() {}, onMessage() {}, onClose() {}, onError() {}, send() {}, close() {} }),
  showToast: (o) => toasts.push(o.title),
  showModal: () => {},
  setNavigationBarTitle: () => {},
  showShareMenu: () => {},
  hideShareMenu: () => {},
  getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
  nextTick: () => {},
  navigateTo: () => {}, redirectTo: () => {}, reLaunch: () => {}, navigateBack: () => {},
  setClipboardData: () => {}, getClipboardData: () => {}
}
global.getCurrentPages = () => [1]
global.Page = (cfg) => {
  const p = Object.assign({}, cfg)
  p.data = JSON.parse(JSON.stringify(cfg.data || {}))
  p.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.includes('.')) { const [a, b] = k.split('.'); this.data[a] = Object.assign({}, this.data[a], { [b]: patch[k] }) } else this.data[k] = patch[k]
    })
  }
  lastPage = p
}
global.App = () => {}
const flush = () => new Promise((r) => setTimeout(r, 5))
const root = path.join(__dirname, '..')
const req = (p) => require(path.join(root, p))

// ---------- 校验 ----------
const v = req('utils/validate')

test('A1-03 称呼校验', () => {
  assert.ok(v.validateName(''))
  assert.ok(v.validateName('   '))
  assert.equal(v.validateName('奶奶'), null)
  assert.ok(v.validateName('一'.repeat(41)))
  assert.equal(v.validateName('一'.repeat(40)), null)
  assert.ok(v.validateName('奶奶13812345678'))
  assert.ok(v.validateName('a@b.com'))
})

test('A1-03 日期校验：单独生年可通过、卒早于生被拒、晚于今天被拒', () => {
  const now = new Date(2026, 10, 14).getTime()
  assert.equal(v.validateDates({ y: 1930 }, null, now), null)
  assert.equal(v.validateDates(null, { y: 2020, m: 5 }, now), null)
  assert.ok(v.validateDates({ y: 1990 }, { y: 1980 }, now))
  assert.ok(v.validateDates({ y: 2027 }, null, now))
  assert.ok(v.validateDates(null, { y: 2026, m: 12 }, now))
  assert.equal(v.validateDates({ y: 1950, m: 6 }, { y: 1950 }, now), null) // 同年不同精度不误判
  assert.ok(v.validateDates({ y: 1950, m: 6, d: 10 }, { y: 1950, m: 6, d: 9 }, now))
  assert.ok(v.validateDates({ y: 1799 }, null, now))
  assert.ok(v.validateDates({ y: 2001, m: 2, d: 30 }, null, now))
})

test('A1-03 墓志铭与地址', () => {
  assert.equal(v.validateEpitaph('字'.repeat(80)), null)
  assert.ok(v.validateEpitaph('字'.repeat(81)))
  assert.ok(v.validateAddress('XX墓园 电话 13800000000'))
  assert.equal(v.validateAddress('浙江省杭州市某某陵园 3 区 12 排'), null)
})

test('日期转接口格式与碑面显示', () => {
  assert.deepEqual(v.toApiDate({ y: 1931, m: 3 }), { date: '1931-03-01', precision: 'month', year: 1931 })
  assert.deepEqual(v.toApiDate(null), { date: null, precision: null, year: null })
  assert.equal(v.formatDate('1931-03-01', 'month'), '1931年3月')
  assert.equal(v.formatDate('1931-03-05', 'day'), '1931年3月5日')
  assert.equal(v.formatDate('1931-01-01', 'year'), '1931')
})

// ---------- 链接解析 ----------
const { parseInvite } = req('utils/link')
test('邀请链接解析', () => {
  assert.deepEqual(parseInvite('https://yunsaomu.vercel.app/t/tmb_AbCdEf123456?inv=tok-_1'), { id: 'tmb_AbCdEf123456', kind: 'inv', token: 'tok-_1' })
  assert.deepEqual(parseInvite('来看看 https://x.cn/t/tmb_AbCdEf123456?adm=a%2Bb 谢谢'), { id: 'tmb_AbCdEf123456', kind: 'adm', token: 'a+b' })
  assert.deepEqual(parseInvite('/pages/tomb/tomb?id=tmb_AbCdEf123456&inv=zz'), { id: 'tmb_AbCdEf123456', kind: 'inv', token: 'zz' })
  assert.equal(parseInvite('https://yunsaomu.vercel.app/t/tmb_AbCdEf123456'), null)
  assert.equal(parseInvite('随便一段话'), null)
  assert.equal(parseInvite('https://x/t/../etc?inv=1'), null)
})

// ---------- 季节 / 昼夜 ----------
const envu = req('utils/env')
test('A1-07 auto 季节：4/7/10/1 月', () => {
  assert.equal(envu.resolveSeason('auto', null, new Date(2026, 3, 10)), 'spring')
  assert.equal(envu.resolveSeason('auto', null, new Date(2026, 6, 10)), 'summer')
  assert.equal(envu.resolveSeason('auto', null, new Date(2026, 9, 10)), 'autumn')
  assert.equal(envu.resolveSeason('auto', null, new Date(2026, 0, 10)), 'winter')
  assert.equal(envu.resolveSeason('winter', null, new Date(2026, 6, 10)), 'winter')
  assert.equal(envu.resolveSeason('winter', 'spring', new Date(2026, 6, 10)), 'spring')
})
test('A1-08 21:00 为夜景，手动白昼可覆盖', () => {
  assert.equal(envu.resolvePhase('auto', new Date(2026, 0, 1, 21)), 'night')
  assert.equal(envu.resolvePhase('day', new Date(2026, 0, 1, 21)), 'noon')
  assert.equal(envu.resolvePhase('auto', new Date(2026, 0, 1, 6)), 'dawn')
  assert.equal(envu.resolvePhase('auto', new Date(2026, 0, 1, 17)), 'dusk')
})

// ---------- 动作短提示 ----------
const Hints = req('utils/hints')
test('A1-15 短提示：单条描述、5 秒内合并、约 3 秒消失', () => {
  const h = new Hints()
  assert.equal(h.push('flower', 1000), '有人刚刚献上了一束花')
  assert.equal(h.push('incense', 2000), '亲友们刚刚献花、上香')
  assert.equal(h.push('incense', 3000), '亲友们刚刚献花、上香')
  assert.ok(h.visible(5900))
  assert.ok(!h.visible(6100))
  assert.equal(h.push('candle', 20000), '有人刚刚点亮了一支烛')
  assert.equal(h.push('paper', 20001), null)
})

// ---------- 页面流程（模拟后端） ----------
function fakeBackend() {
  const offerings = []
  const ins = []
  let wipe = 0
  return (opt) => {
    const u = opt.url.replace(/^https:\/\/[^/]+\/functions\/v1\/api/, '')
    const body = opt.data || {}
    if (u === '/tombs' && opt.method === 'POST') {
      if (!body.consent) return [400, { error: '请先阅读并同意说明' }]
      return [201, { tomb: { id: 'tmb_test12345678', deceasedName: body.deceasedName }, inviteToken: 'INV', adminToken: 'ADM', inviteUrl: 'u/i', adminUrl: 'u/a' }]
    }
    if (/\/enter$/.test(u)) {
      if (body.token !== 'INV' && body.token !== 'ADM') return [404, { error: 'x', code: 'invalid' }]
      return [200, {
        session: { id: body.sessionId, role: body.tokenKind === 'adm' ? 'creator' : 'guest' },
        tomb: { id: 'tmb_test12345678', deceasedName: '奶奶', birthYear: 1931, deathYear: null, epitaph: '', steleStyleId: 'qingshi', wipeLevel: wipe, showNameInShare: true },
        presence: [], offerings, inscriptions: ins, serverTime: Date.now()
      }]
    }
    if (/\/offerings$/.test(u)) {
      const o = { id: 'o' + offerings.length, type: body.type, subtype: body.subtype, state: 'active', sessionId: body.sessionId, placedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
      offerings.push(o)
      return [200, { offering: o }]
    }
    if (/\/wipe$/.test(u)) { wipe = Math.min(1, wipe + body.progress); return [200, { wipeLevel: wipe }] }
    if (/\/inscriptions$/.test(u)) {
      const i = { id: 'i' + ins.length, body: body.body, displayName: body.displayName, status: 'pending', sessionId: body.sessionId, createdAt: new Date().toISOString() }
      ins.push(i)
      return [201, { inscription: i }]
    }
    if (/\/moderate$/.test(u)) {
      const i = ins.find((x) => u.includes(x.id)); i.status = 'approved'
      return [200, { inscription: i }]
    }
    return [200, { ok: true }]
  }
}

test('A1-02 建墓最小路径：只填称呼 + 同意，园景默认值，写入本机记录', async () => {
  routeHandler = fakeBackend()
  requests.length = 0
  req('pages/create/create.js')
  const p = lastPage
  p.onLoad()
  p.next()
  assert.ok(p.data.nameErr, '未勾同意不能下一步')
  p.toggleConsent()
  p.onName({ detail: { value: '奶奶' } })
  p.next()
  assert.equal(p.data.step, 2)
  await p.submit()
  const sent = requests.find((r) => r.url.endsWith('/tombs')).data
  assert.equal(sent.deceasedName, '奶奶')
  assert.equal(sent.sceneTheme, 'default')
  assert.equal(sent.addressVisibility, 'private')
  assert.equal(sent.steleStyleId, 'qingshi')
  assert.ok(p.data.created)
  const store = req('utils/store')
  const rec = store.getTomb('tmb_test12345678')
  assert.equal(rec.adm, 'ADM')
  assert.equal(rec.inv, 'INV')
  assert.equal(rec.role, 'creator')
})

test('A1-03 建墓页拦截卒早于生', async () => {
  req('pages/create/create.js')
  const p = lastPage
  p.setData({ consent: true, name: '外公', birth: '1990', death: '1980', step: 2 })
  requests.length = 0
  await p.submit()
  assert.ok(p.data.err)
  assert.equal(requests.length, 0)
})

test('A1-06 / A1-10 / A1-16 访客直达场景、五种动作、留言待审', async () => {
  routeHandler = fakeBackend()
  delete require.cache[path.join(root, 'pages/tomb/tomb.js')]
  req('pages/tomb/tomb.js')
  const p = lastPage
  p.onLoad({ id: 'tmb_test12345678', inv: 'INV' })
  await flush()
  assert.equal(p.data.status, 'ready')
  assert.equal(p.data.role, 'guest')
  assert.equal(p.data.canShare, true)
  // 场景用 mock context 驱动
  const Scene = req('scene/engine')
  const noop = () => {}
  const grad = { addColorStop: noop }
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => grad : k === 'measureText' ? () => ({ width: 10 }) : noop), set: (t, k, val) => { t[k] = val; return true } })
  p.scene = new Scene(ctx, { seed: 'x' }); p.scene.resize(390, 844); p.pushScene()
  for (let i = 0; i < 30; i++) p.scene.render(Date.now() + i * 33)

  p.pickFlower({ currentTarget: { dataset: { id: 'baiju' } } })
  p.doIncense(); p.doCandle(); p.toggleBow()
  await flush()
  const types = requests.filter((r) => /\/offerings$/.test(r.url)).map((r) => r.data.type)
  assert.deepEqual(types.slice(-4), ['flower', 'incense', 'candle', 'bow'])
  assert.ok(!types.includes('paper'))
  assert.equal(p.data.bowing, true)
  p.wipeOnce(); await flush()
  assert.ok(p.tomb.wipeLevel > 0)
  // 碑面滑动 → 批量上报擦拭进度
  const f = p.scene.face
  p.scene.stopBow()
  p.onTouchStart({ touches: [{ x: f.x + 5, y: f.y + 5 }] })
  for (let y = f.y; y < f.y + f.h; y += 8) p.onTouchMove({ touches: [{ x: f.x + f.w / 2, y }] })
  p.onTouchEnd(); await flush()
  const wipes = requests.filter((r) => /\/wipe$/.test(r.url))
  assert.ok(wipes.length >= 2 && wipes[wipes.length - 1].data.progress > 0)

  p.onDraft({ detail: { value: '奶奶，我们都很好' } })
  await p.postMessage()
  const mine = p.data.inscriptions.find((x) => x.body === '奶奶，我们都很好')
  assert.equal(mine.status, 'pending')

  // 他人献花 → 短提示；自己的动作不提示
  p.onServer({ event: { kind: 'offering', offering: { id: 'zz', type: 'flower', sessionId: 'someone', state: 'active', placedAt: new Date().toISOString() } } })
  assert.equal(p.data.hint, '有人刚刚献上了一束花')
  p.hints = new Hints(); p.setData({ hint: '' })
  p.onServer({ event: { kind: 'offering', offering: { id: 'zy', type: 'flower', sessionId: p.sessionId, state: 'active', placedAt: new Date().toISOString() } } })
  assert.equal(p.data.hint, '')
  // 他人未审核的留言广播不会出现在访客列表
  p.onServer({ event: { kind: 'inscription-update', inscription: { id: 'other', body: 'x', status: 'pending', sessionId: 'someone' } } })
  assert.ok(!p.data.inscriptions.find((x) => x.id === 'other'))
  const share = p.onShareAppMessage()
  assert.ok(share.path.includes('inv=INV') && !share.path.includes('ADM'))
  assert.equal(share.imageUrl, '/assets/share-cover.png')
  p.onUnload()
})

test('建墓人进入可审核留言；无效链接显示错误', async () => {
  routeHandler = fakeBackend()
  delete require.cache[path.join(root, 'pages/tomb/tomb.js')]
  req('pages/tomb/tomb.js')
  const p = lastPage
  p.onLoad({ id: 'tmb_test12345678', adm: 'ADM' })
  await flush()
  assert.equal(p.data.role, 'creator')
  p.setInscriptions([{ id: 'i0', body: 'hi', status: 'pending', sessionId: 's', createdAt: '' }])
  assert.equal(p.data.pendingCount, 1)
  await p.moderate({ currentTarget: { dataset: { id: 'i0', action: 'approve' } } })
  p.onUnload()

  delete require.cache[path.join(root, 'pages/tomb/tomb.js')]
  req('pages/tomb/tomb.js')
  const q = lastPage
  q.onLoad({ id: 'tmb_test12345678', inv: 'WRONG' })
  await flush()
  assert.equal(q.data.status, 'error')
  assert.ok(/无效/.test(q.data.errMsg))
})
