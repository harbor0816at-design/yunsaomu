// 在 headless Chrome 的真实 Canvas 中渲染场景引擎，输出截图供人工检查（A1-07 / A1-08 / A1-11）。
// 用法：node test/render-scenes.js <输出目录>
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const root = path.join(__dirname, '..')
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const bundle = `
const __mods = {};
function __def(name, fn){ __mods[name] = { fn, exports: null } }
function require(name){ const k = name.replace(/^\\.\\//,''); const m = __mods[k]; if(!m.exports){ const module={exports:{}}; m.fn(module, module.exports, require); m.exports = module.exports } return m.exports }
__def('color', function(module, exports, require){ ${src('scene/color.js')} });
__def('engine', function(module, exports, require){ ${src('scene/engine.js')} });
window.Scene = require('engine');
`

const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
function offerings(nFlowers) {
  const list = []
  const subs = ['baiju', 'huangju', 'cuibai']
  for (let i = 0; i < nFlowers; i++) list.push({ id: 'f' + i, type: 'flower', subtype: subs[i % 3], state: 'active', placedAt: iso(now - (nFlowers - i) * 60000), expiresAt: iso(now + 86400000) })
  list.push({ id: 'i1', type: 'incense', state: 'active', placedAt: iso(now - 30000), expiresAt: iso(now + 90000) })
  list.push({ id: 'i2', type: 'incense', state: 'active', placedAt: iso(now - 90000), expiresAt: iso(now + 30000) })
  list.push({ id: 'c1', type: 'candle', state: 'active', placedAt: iso(now - 1000), expiresAt: iso(now + 500000) })
  list.push({ id: 'c2', type: 'candle', state: 'active', placedAt: iso(now - 1000), expiresAt: iso(now + 500000) })
  list.push({ id: 'p1', type: 'paper', state: 'active', placedAt: iso(now - 1000), expiresAt: iso(now + 20000) })
  return list
}

const cases = [
  { file: 'spring-noon-qingshi', season: 'spring', phase: 'noon', weather: 'clear', style: 'qingshi', flowers: 6, wipe: 0.2 },
  { file: 'summer-noon-rain', season: 'summer', phase: 'noon', weather: 'rain', style: 'qingshi', flowers: 3, wipe: 1 },
  { file: 'autumn-dusk-yuanshou', season: 'autumn', phase: 'dusk', weather: 'clear', style: 'yuanshou', flowers: 9, wipe: 0.6 },
  { file: 'winter-night-wubei', season: 'winter', phase: 'night', weather: 'clear', style: 'wubei', flowers: 4, wipe: 1 },
  { file: 'summer-night-fireflies', season: 'summer', phase: 'night', weather: 'clear', style: 'qingshi', flowers: 0, wipe: 1, peers: 3 },
  { file: 'spring-dawn-cloudy-bow', season: 'spring', phase: 'dawn', weather: 'cloudy', style: 'qingshi', flowers: 2, wipe: 1, bow: true },
  { file: 'night-vs-day-candle-day', season: 'autumn', phase: 'noon', weather: 'clear', style: 'qingshi', flowers: 0, wipe: 1 },
  { file: 'night-vs-day-candle-night', season: 'autumn', phase: 'night', weather: 'clear', style: 'qingshi', flowers: 0, wipe: 1 }
]

;(async () => {
  const out = process.argv[2] || path.join(root, 'test', 'out')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<html><body style="margin:0;background:#000"><canvas id="c" width="390" height="844"></canvas></body></html>')
  await page.addScriptTag({ content: bundle })
  const results = []
  for (const c of cases) {
    const r = await page.evaluate(async ({ c, offs, nowMs }) => {
      const ctx = document.getElementById('c').getContext('2d')
      const s = new window.Scene(ctx, { seed: 'tmb_demo123456' })
      s.resize(390, 844)
      s.setTomb({ name: '王秀英', dates: '1931—2019', epitaph: '一生勤俭，福泽儿孙', style: c.style })
      s.setEnv({ season: c.season, phase: c.phase, weather: c.weather, quality: 'standard' })
      s.setOfferings(offs)
      s.setWipeLevel(c.wipe)
      if (c.peers) s.setPeers(Array.from({ length: c.peers }, (_, i) => ({ key: 'p' + i })))
      if (c.peers) s.peerBow('p0')
      let t = nowMs
      for (let i = 0; i < 90; i++) { t += 33; s.render(t) }
      if (c.bow) { s.startBow(3); s.bow.at = t - 1200; s.render(t) }
      // 采样烛光附近亮度（A1-08）
      const slot = s.candleSlots()[0]
      let lum = null
      if (slot) {
        const d = ctx.getImageData(Math.round(slot.x) - 20, Math.round(slot.y - 60), 40, 40).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const bg = ctx.getImageData(10, 600, 40, 40).data
        let bsum = 0
        for (let i = 0; i < bg.length; i += 4) bsum += 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2]
        lum = { glow: sum / (d.length / 4), ground: bsum / (bg.length / 4) }
      }
      return { bundles: s.bundles().length, dust: s.dustAmount(), lum, particles: s.particles.length, smoke: s.smoke.length }
    }, { c, offs: offerings(c.flowers), nowMs: now })
    await page.locator('#c').screenshot({ path: path.join(out, c.file + '.png') })
    results.push({ case: c.file, ...r })
  }
  // 擦碑交互：沿碑面滑动后灰尘减少，碑面外滑动无效
  const wipe = await page.evaluate(() => {
    const ctx = document.getElementById('c').getContext('2d')
    const s = new window.Scene(ctx, { seed: 'x' })
    s.resize(390, 844)
    s.setTomb({ name: '奶奶', style: 'qingshi' })
    s.setWipeLevel(0)
    s.render(Date.now())
    const before = s.dustAmount()
    const outside = s.wipeAt(20, 20)
    const f = s.face
    for (let y = f.y; y < f.y + f.h; y += 6) for (let x = f.x; x < f.x + f.w; x += 12) s.wipeAt(x, y)
    const after = s.dustAmount()
    return { before, after, outside, acc: s.consumeWipe(), accAfter: s.consumeWipe() }
  })
  console.log(JSON.stringify({ results, wipe, errors }, null, 2))
  await browser.close()
})()
