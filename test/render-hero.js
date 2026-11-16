// 用 3D 墓园渲染首页头图（assets/hero.jpg）与分享封面（assets/share-cover.png）
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const bundle = `const __mods = {};function __def(n, fn){ __mods[n] = { fn, exports: null } }
function require(name){ const k = name.replace(/^.*\\//,''); const m = __mods[k]; if(!m.exports){ const module={exports:{}}; m.fn(module, module.exports, require); m.exports = module.exports } return m.exports }
__def('color', function(module, exports, require){ ${src('scene/color.js')} });
__def('memorial3d', function(module, exports, require){ ${src('scene3d/memorial3d.js')} });
window.Memorial3D = require('memorial3d');`
const now = Date.now(); const iso = (ms) => new Date(ms).toISOString()
const offs = ['baiju', 'huangju', 'cuibai', 'baiju', 'huangju', 'baiju'].map((s, i) => ({ id: 'f' + i, type: 'flower', subtype: s, state: 'active', placedAt: iso(now - (9 - i) * 6e4), expiresAt: iso(now + 864e5) }))
  .concat([{ id: 'i1', type: 'incense', state: 'active', placedAt: iso(now), expiresAt: iso(now + 1e5) }, { id: 'c1', type: 'candle', state: 'active', placedAt: iso(now), expiresAt: iso(now + 5e5) }, { id: 'c2', type: 'candle', state: 'active', placedAt: iso(now), expiresAt: iso(now + 5e5) }])
async function shot(page, w, h, file, env, cam) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0"><canvas id="c" style="width:${w}px;height:${h}px;display:block"></canvas></body></html>`)
  await page.addScriptTag({ path: path.join(root, 'demo/three.r108.min.js') })
  await page.addScriptTag({ content: bundle })
  await page.evaluate(({ w, h, env, cam, offs }) => {
    const s = new window.Memorial3D(THREE, document.getElementById('c'), { width: w, height: h, pixelRatio: 1, seed: 'hero' })
    s.setTomb({ name: '永远怀念', dates: '', epitaph: '', style: 'qingshi' })
    s.setEnv(env); s.setOfferings(offs); s.setWipeLevel(1)
    s.setPeers([{ key: 'a' }, { key: 'b' }])
    Object.assign(s, cam); s.yawGoal = s.yaw; s.pitchGoal = s.pitch; s.radiusGoal = s.radius
    let t = Date.now(); for (let i = 0; i < 60; i++) { t += 50; s.render(t) }
  }, { w, h, env, cam, offs })
  await page.locator('#c').screenshot({ path: file })
}
;(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const p = await b.newPage()
  await shot(p, 750, 760, '/tmp/hero.png', { season: 'autumn', phase: 'dusk', weather: 'clear' }, { yaw: 0.18, pitch: 0.22, radius: 12.8 })
  await shot(p, 500, 400, '/tmp/share.png', { season: 'autumn', phase: 'night', weather: 'clear' }, { yaw: -0.12, pitch: 0.2, radius: 11 })
  await b.close()
})()
