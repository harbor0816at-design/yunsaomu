// headless Chrome + WebGL（SwiftShader）渲染 3D 墓园，输出截图：node test/render-3d.js <out>
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const bundle = `
const __mods = {};
function __def(name, fn){ __mods[name] = { fn, exports: null } }
function require(name){ const k = name.replace(/^.*\\//,''); const m = __mods[k]; if(!m.exports){ const module={exports:{}}; m.fn(module, module.exports, require); m.exports = module.exports } return m.exports }
__def('color', function(module, exports, require){ ${src('scene/color.js')} });
__def('memorial3d', function(module, exports, require){ ${src('scene3d/memorial3d.js')} });
window.Memorial3D = require('memorial3d');
`
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
function offerings(nf) {
  const subs = ['baiju', 'huangju', 'cuibai']
  const l = []
  for (let i = 0; i < nf; i++) l.push({ id: 'f' + i, type: 'flower', subtype: subs[i % 3], state: 'active', placedAt: iso(now - (nf - i) * 6e4), expiresAt: iso(now + 864e5) })
  l.push({ id: 'i1', type: 'incense', state: 'active', placedAt: iso(now - 3e4), expiresAt: iso(now + 9e4) })
  l.push({ id: 'i2', type: 'incense', state: 'active', placedAt: iso(now - 9e4), expiresAt: iso(now + 3e4) })
  l.push({ id: 'c1', type: 'candle', state: 'active', placedAt: iso(now), expiresAt: iso(now + 5e5) })
  l.push({ id: 'c2', type: 'candle', state: 'active', placedAt: iso(now), expiresAt: iso(now + 5e5) })
  return l
}
const cases = [
  { file: 'autumn-noon-qingshi', season: 'autumn', phase: 'noon', weather: 'clear', style: 'qingshi', flowers: 6, wipe: 0.3 },
  { file: 'spring-dawn-yuanshou', season: 'spring', phase: 'dawn', weather: 'clear', style: 'yuanshou', flowers: 3, wipe: 1 },
  { file: 'summer-night-peers', season: 'summer', phase: 'night', weather: 'clear', style: 'qingshi', flowers: 2, wipe: 1, peers: 9, bowPeer: true },
  { file: 'autumn-noon-walk', season: 'autumn', phase: 'noon', weather: 'clear', style: 'qingshi', flowers: 4, wipe: 1, peers: 4, walk: [1.4, 6.2] },
  { file: 'winter-night-wubei', season: 'winter', phase: 'night', weather: 'clear', style: 'wubei', flowers: 4, wipe: 1 },
  { file: 'summer-noon-rain', season: 'summer', phase: 'noon', weather: 'rain', style: 'qingshi', flowers: 3, wipe: 1 },
  { file: 'autumn-dusk-bow', season: 'autumn', phase: 'dusk', weather: 'clear', style: 'qingshi', flowers: 9, wipe: 1, bow: true, yaw: 0.4 }
]
;(async () => {
  const out = process.argv[2] || path.join(root, 'test', 'out3d')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)) })
  await page.setContent('<html><body style="margin:0;background:#000"><canvas id="c" style="width:390px;height:844px;display:block"></canvas></body></html>')
  await page.addScriptTag({ path: path.join(root, 'demo/three.r108.min.js') })
  await page.addScriptTag({ content: bundle })
  const results = []
  for (const c of cases) {
    const r = await page.evaluate(({ c, offs }) => {
      const cv = document.getElementById('c')
      if (window.__s) window.__s.dispose()
      const s = window.__s = new window.Memorial3D(THREE, cv, { width: 390, height: 844, pixelRatio: 1, seed: 'tmb_demo123456' })
      s.setTomb({ name: '王秀英', dates: '1931—2019', epitaph: '一生勤俭，福泽儿孙', style: c.style })
      s.setEnv({ season: c.season, phase: c.phase, weather: c.weather, quality: 'standard' })
      s.setOfferings(offs)
      s.setWipeLevel(c.wipe)
      if (c.peers) s.setPeers(Array.from({ length: c.peers }, (_, i) => ({ key: 'p' + i })))
      if (c.yaw) { s.yawGoal = c.yaw; s.yaw = c.yaw }
      let t = Date.now()
      for (let i = 0; i < 160; i++) { t += 50; s.render(t) }
      if (c.bowPeer) { s.peerBow('p0'); s.peerBow('p3'); for (let i = 0; i < 26; i++) { t += 50; s.render(t) } }
      if (c.walk) { s.walkTo(c.walk[0], c.walk[1]); for (let i = 0; i < 14; i++) { t += 50; s.render(t) } }
      if (c.bow) { s.startBow(3); for (let i = 0; i < 26; i++) { t += 50; s.render(t) } }
      const info = s.renderer.info.render
      return { calls: info.calls, tris: info.triangles, dust: s.dustAmount(), me: [s.me.x.toFixed(2), s.me.z.toFixed(2)], peersArrived: s.peers.filter((p) => !p.target).length + '/' + s.peers.length }
    }, { c, offs: offerings(c.flowers) })
    await page.locator('#c').screenshot({ path: path.join(out, c.file + '.png') })
    results.push({ case: c.file, ...r })
  }
  // 交互：碑面命中与擦拭
  const wipe = await page.evaluate(() => {
    const s = window.__s
    s.setTomb({ name: '奶奶', style: 'qingshi' })
    s.setWipeLevel(0)
    s.yaw = s.yawGoal = 0; s.pitch = s.pitchGoal = 0.2; s.radius = s.radiusGoal = 7.6
    s.render(Date.now())
    const v = new THREE.Vector3()
    s.face.getWorldPosition(v)
    v.project(s.camera)
    const cx = (v.x + 1) / 2 * 390
    const cy = (1 - v.y) / 2 * 844
    const before = s.dustAmount()
    const on = s.isOnStele(cx, cy)
    const off = s.isOnStele(20, 20)
    for (let dy = -60; dy <= 60; dy += 6) for (let dx = -20; dx <= 20; dx += 10) s.wipeAt(cx + dx, cy + dy)
    return { cx: Math.round(cx), cy: Math.round(cy), on, off, before, after: s.dustAmount() }
  })
  const walk = await page.evaluate(() => {
    const s = window.__s
    const v = new THREE.Vector3(1.2, 0.08, 5.0).project(s.camera)
    const tapped = s.tap((v.x + 1) / 2 * 390, (1 - v.y) / 2 * 844)
    let t = Date.now()
    for (let i = 0; i < 120; i++) { t += 50; s.render(t) }
    const arrived = [s.me.x.toFixed(2), s.me.z.toFixed(2)]
    const facing = (s.me.ry % (Math.PI * 2)).toFixed(2)
    let ended = false
    s.o.onBowEnd = () => { ended = true }
    s.startBow(3)
    for (let i = 0; i < 220; i++) { t += 50; s.render(t) }
    return { tapped, arrived, facing, bowEnded: ended, bowing: s.isBowing() }
  })
  console.log(JSON.stringify({ results, wipe, walk, errors: errors.filter((e) => !/GPU stall|willReadFrequently/.test(e)).slice(0, 8) }, null, 1))
  await browser.close()
})()
