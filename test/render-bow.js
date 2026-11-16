const fs = require('fs'), path = require('path'); const { chromium } = require('playwright')
const root = require('path').join(__dirname, '..'); const src = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const bundle = `const __mods = {};function __def(n, fn){ __mods[n] = { fn, exports: null } }
function require(name){ const k = name.replace(/^.*\\//,''); const m = __mods[k]; if(!m.exports){ const module={exports:{}}; m.fn(module, module.exports, require); m.exports = module.exports } return m.exports }
__def('color', function(module, exports, require){ ${src('scene/color.js')} });
__def('memorial3d', function(module, exports, require){ ${src('scene3d/memorial3d.js')} });
window.Memorial3D = require('memorial3d');`
;(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const p = await b.newPage({ viewport: { width: 300, height: 400 } })
  await p.setContent('<html><body style="margin:0"><canvas id="c" style="width:300px;height:400px;display:block"></canvas></body></html>')
  await p.addScriptTag({ path: path.join(root, 'demo/three.r108.min.js') }); await p.addScriptTag({ content: bundle })
  const shots = [['palms', 0.5], ['down', 1.35], ['hold', 1.8], ['rise', 2.6]]
  await p.evaluate(() => {
    const s = window.__s = new window.Memorial3D(THREE, document.getElementById('c'), { width: 300, height: 400, pixelRatio: 1, seed: 'x' })
    s.setEnv({ season: 'autumn', phase: 'noon', weather: 'clear' }); s.setTomb({ name: '奶奶', style: 'qingshi' }); s.setWipeLevel(1)
    s.me.x = 0; s.me.z = 4
    s.updateCamera = () => { s.camera.position.set(2.6, 1.0, 4.6); s.camera.lookAt(0, 0.6, 3.9) }
    let t = Date.now(); for (let i = 0; i < 30; i++) { t += 50; s.render(t) }
    s.startBow(3); window.__t = t
  })
  let last = 0
  for (const [name, at] of shots) {
    await p.evaluate((dt) => { const s = window.__s; let t = window.__t; const n = Math.round(dt / 0.05); for (let i = 0; i < n; i++) { t += 50; s.render(t) } window.__t = t }, at + 0.35 - last)
    last = at + 0.35
    await p.locator('#c').screenshot({ path: `' + (process.argv[2] || '/tmp') + '/bow-${name}.png` })
  }
  await b.close()
})()
