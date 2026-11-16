// 云扫墓 3D 墓园引擎（three.js r108；小程序经 threejs-miniprogram，浏览器用 three.min.js）
// 画面质感参考山寺：低多边形 + 平直着色的立体小院，深青夜空、枫叶琥珀、朱红立柱、纸灯暖光。
// 全部为程序化原创几何体，不加载外部模型或贴图。
// 接口与 2D 版 scene/engine.js 保持一致，页面代码可直接切换。
const { hashStr, rng, mixHex } = require('../scene/color')

// ---------- 色板 ----------
const PHASES = {
  dawn: { skyTop: '#46698a', skyMid: '#b99c86', skyBot: '#efd0a2', fog: '#c2ab92', hemiSky: '#ead7bf', hemiGround: '#3f3528', hemi: 0.58, sun: '#ffd29a', sunI: 0.62, sunPos: [-8, 4, 6], lamp: 0.35, star: 0 },
  noon: { skyTop: '#3a6c8c', skyMid: '#88afbf', skyBot: '#dcdccb', fog: '#b7c5c3', hemiSky: '#e3ebee', hemiGround: '#4a412f', hemi: 0.56, sun: '#fff0d4', sunI: 0.64, sunPos: [6, 12, 8], lamp: 0, star: 0 },
  dusk: { skyTop: '#263f5a', skyMid: '#8a6266', skyBot: '#e19d68', fog: '#866b60', hemiSky: '#d6a283', hemiGround: '#33281f', hemi: 0.5, sun: '#ffab72', sunI: 0.6, sunPos: [9, 3, 2], lamp: 0.75, star: 0.2 },
  night: { skyTop: '#0d1a27', skyMid: '#1b3344', skyBot: '#2a475a', fog: '#1b3242', hemiSky: '#56789a', hemiGround: '#171612', hemi: 0.5, sun: '#a3bad8', sunI: 0.3, sunPos: [-6, 10, -4], lamp: 1, star: 1 }
}
const SEASONS = {
  spring: { ground: ['#6f8a4f', '#7d9757', '#647f48'], leaf: ['#f1c3cf', '#e7a9bb', '#f7dbe2', '#ddb0c0'], pine: '#3f5f44', particle: '#f6d2dc', bare: false },
  summer: { ground: ['#4f7a3d', '#5d8845', '#466f37'], leaf: ['#3f7340', '#4f8648', '#2f6337', '#5f9450'], pine: '#2f5136', particle: '#e7ffa8', bare: false },
  autumn: { ground: ['#6f6436', '#7c6c3a', '#655a31'], leaf: ['#d0832f', '#b5561f', '#e3a542', '#9c3b1c'], pine: '#3c5a3e', particle: '#d9822f', bare: false },
  winter: { ground: ['#cfd7dc', '#dfe5e9', '#c3ccd2'], leaf: ['#e9eef1'], pine: '#3a5546', particle: '#ffffff', bare: true }
}
const STONE = '#8c887a'
const STONE_DARK = '#6f6b5f'
const STONE_LIGHT = '#a9a596'
const RED = '#8e2a1c'
const ROOF = '#2b2622'
const WOOD = '#8a6141'
const FLOWER = {
  baiju: { head: '#f4f0e2', heart: '#e2c45c' },
  huangju: { head: '#efc443', heart: '#b8812a' },
  cuibai: { head: '#3f6b45', heart: '#355c3b' }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }

class Memorial3D {
  constructor(THREE, canvas, opts) {
    this.T = THREE
    this.o = opts || {}
    this.canvas = canvas
    this.w = this.o.width || 375
    this.h = this.o.height || 667
    this.seed = hashStr(this.o.seed || 'yunsaomu')
    this.R = rng(this.seed)
    this.season = 'autumn'
    this.phase = 'noon'
    this.weather = 'clear'
    this.quality = 'standard'
    this.tomb = { name: '', dates: '', epitaph: '', style: 'qingshi' }
    this.offerings = []
    this.serverOffset = 0
    this.incenseMs = 120000
    this.candleMs = 600000
    this.wipeLevel = 0
    this.cells = null
    this.wipeAcc = 0
    this.sweepAt = 0
    this.bow = null
    this.peers = []
    this.frameEma = 16
    this.slowSince = 0
    this.lastT = 0
    this.yaw = 0
    this.pitch = 0.24
    this.radius = 13.4
    this.yawGoal = 0
    this.pitchGoal = 0.24
    this.radiusGoal = 13.4
    this.texDirty = true
    this.texAt = 0

    const T = THREE
    this.G = (name, ...a) => new (T[name + 'BufferGeometry'] || T[name + 'Geometry'])(...a)
    this.VC = T.VertexColors !== undefined ? T.VertexColors : true
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(this.o.pixelRatio || 1)
    this.renderer.setSize(this.w, this.h, false)
    this.scene = new T.Scene()
    this.camera = new T.PerspectiveCamera(42, this.w / this.h, 0.1, 200)
    this.raycaster = new T.Raycaster()
    this.mats = {}
    this.build()
    this.applyEnv()
  }

  // ---------- 工具 ----------
  mat(hex, opt) {
    const key = hex + JSON.stringify(opt || {})
    if (this.mats[key]) return this.mats[key]
    const T = this.T
    const m = new T.MeshLambertMaterial(Object.assign({ color: new T.Color(hex), flatShading: true }, opt || {}))
    this.mats[key] = m
    return m
  }
  mesh(geo, hex, opt) {
    const m = new this.T.Mesh(geo, typeof hex === 'string' ? this.mat(hex, opt) : hex)
    return m
  }
  add(obj, parent) { (parent || this.scene).add(obj); return obj }
  jitter(hex, amt) {
    const R = this.R
    return mixHex(hex, R() > 0.5 ? '#ffffff' : '#000000', R() * (amt || 0.08))
  }
  makeCanvas(w, h) {
    if (this.o.createCanvas) return this.o.createCanvas(w, h)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c
  }

  // ---------- 场景搭建 ----------
  build() {
    const T = this.T
    const s = this.scene
    this.hemi = this.add(new T.HemisphereLight(0xffffff, 0x444444, 0.8))
    this.sun = this.add(new T.DirectionalLight(0xffffff, 0.8))
    this.candleLight = this.add(new T.PointLight(0xffb764, 0, 6, 2))
    this.candleLight.position.set(0, 1.25, 1.35)
    this.lampLights = []
    s.fog = new T.Fog(0xc7d0cc, 14, 60)

    this.buildSky()
    this.buildMountains()
    this.buildGround()
    this.buildPath()
    this.buildCourtyard()
    this.buildGate()
    this.buildTrees()
    this.buildLanterns()
    this.buildTable()
    this.buildAvatar()
    this.peerGroup = this.add(new T.Group())
    this.flowerGroup = this.add(new T.Group())
    this.incenseGroup = this.add(new T.Group())
    this.candleGroup = this.add(new T.Group())
    this.buildParticles()
    this.buildSmoke()
  }

  buildSky() {
    const T = this.T
    const geo = this.G('Sphere', 90, 24, 16)
    const n = geo.attributes.position.count
    geo.addAttribute ? geo.addAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3)) : geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3))
    this.skyGeo = geo
    const m = new T.MeshBasicMaterial({ vertexColors: this.VC, side: T.BackSide, fog: false, depthWrite: false })
    this.sky = this.add(new T.Mesh(geo, m))
    // 星星
    const R = this.R
    const sp = new Float32Array(240 * 3)
    for (let i = 0; i < 240; i++) {
      const th = R() * Math.PI * 2
      const ph = 0.15 + R() * 1.2
      sp[i * 3] = Math.cos(th) * Math.cos(ph) * 80
      sp[i * 3 + 1] = Math.sin(ph) * 80
      sp[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 80
    }
    const sg = new T.BufferGeometry()
    sg.addAttribute ? sg.addAttribute('position', new T.BufferAttribute(sp, 3)) : sg.setAttribute('position', new T.BufferAttribute(sp, 3))
    this.stars = this.add(new T.Points(sg, new T.PointsMaterial({ color: 0xfffbe8, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false })))
    // 月亮
    this.moon = this.add(this.mesh(this.G('Sphere', 2.2, 16, 12), new T.MeshBasicMaterial({ color: 0xf6efd6, fog: false })))
    this.moon.position.set(-30, 34, -60)
    // 云（低多边形团块）
    this.clouds = this.add(new T.Group())
    for (let i = 0; i < 7; i++) {
      const c = new T.Group()
      for (let k = 0; k < 4; k++) {
        const b = this.mesh(this.G('Icosahedron', 1.6 + R() * 1.2, 0), new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.85, fog: false }))
        b.position.set(k * 1.8 - 2.7, R() * 0.8, R() * 0.6)
        b.scale.y = 0.6
        c.add(b)
      }
      const a = R() * Math.PI * 2
      c.position.set(Math.cos(a) * 55, 18 + R() * 10, Math.sin(a) * 55 - 10)
      c.userData.speed = 0.002 + R() * 0.003
      c.userData.angle = a
      this.clouds.add(c)
    }
  }

  paintSky(P) {
    const T = this.T
    const top = new T.Color(P.skyTop)
    const mid = new T.Color(P.skyMid)
    const bot = new T.Color(P.skyBot)
    const pos = this.skyGeo.attributes.position
    const col = this.skyGeo.attributes.color
    const c = new T.Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 90
      if (y > 0.25) c.copy(mid).lerp(top, clamp((y - 0.25) / 0.6, 0, 1))
      else c.copy(bot).lerp(mid, clamp((y + 0.05) / 0.3, 0, 1))
      col.setXYZ(i, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }

  buildMountains() {
    const R = this.R
    this.mountains = []
    const ring = [[34, 9, 11], [42, 13, 14], [50, 17, 18]]
    ring.forEach(([r, hMin, hVar], li) => {
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 0.9 + (R() - 0.5) * 0.2
        const h = hMin + R() * hVar
        const m = this.mesh(this.G('Cone', h * 0.9, h, 5 + Math.floor(R() * 3)), '#3f5a55')
        m.position.set(Math.cos(a) * r, h / 2 - 1.5, Math.sin(a) * r)
        m.rotation.y = R() * 3
        m.userData.layer = li
        this.mountains.push(m)
        this.add(m)
      }
    })
  }

  buildGround() {
    const T = this.T
    const geo = this.G('Plane', 90, 90, 44, 44)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const R = rng(this.seed ^ 0x9e37)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const d = Math.sqrt(x * x + z * z)
      const bump = d < 7 ? 0 : (Math.sin(x * 0.35) + Math.cos(z * 0.3)) * 0.35 * clamp((d - 7) / 10, 0, 1) + R() * 0.12 * clamp((d - 5) / 5, 0, 1)
      pos.setY(i, bump)
    }
    geo.computeVertexNormals()
    const n = pos.count
    const colors = new Float32Array(n * 3)
    geo.addAttribute ? geo.addAttribute('color', new T.BufferAttribute(colors, 3)) : geo.setAttribute('color', new T.BufferAttribute(colors, 3))
    this.groundGeo = geo
    this.groundNoise = []
    for (let i = 0; i < n; i++) this.groundNoise.push(R())
    this.ground = this.add(new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: this.VC, flatShading: true })))
  }

  paintGround(S) {
    const T = this.T
    const col = this.groundGeo.attributes.color
    const cs = S.ground.map((h) => new T.Color(h))
    for (let i = 0; i < col.count; i++) {
      const c = cs[Math.floor(this.groundNoise[i] * cs.length) % cs.length]
      col.setXYZ(i, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }

  buildPath() {
    const R = rng(this.seed ^ 0x51)
    this.pathGroup = this.add(new this.T.Group())
    for (let z = 2.6; z < 11.5; z += 0.62) {
      for (let k = 0; k < 2; k++) {
        const w = 0.55 + R() * 0.2
        const m = this.mesh(this.G('Cylinder', w, w * 1.05, 0.08, 6), this.jitter(STONE, 0.1))
        m.position.set((k ? 0.36 : -0.36) + (R() - 0.5) * 0.12, 0.04, z + (R() - 0.5) * 0.12)
        m.rotation.y = R() * Math.PI
        m.scale.set(1, 1, 0.7)
        this.pathGroup.add(m)
      }
    }
  }

  buildCourtyard() {
    const T = this.T
    const g = this.add(new T.Group())
    // 两级石台
    const b1 = this.mesh(this.G('Box', 5.2, 0.26, 4.4), STONE_DARK)
    b1.position.set(0, 0.13, 0)
    const b2 = this.mesh(this.G('Box', 3.4, 0.22, 2.6), STONE)
    b2.position.set(0, 0.37, -0.5)
    const step = this.mesh(this.G('Box', 1.8, 0.13, 0.5), STONE)
    step.position.set(0, 0.07, 2.35)
    g.add(b1, b2, step)
    // 矮石栏
    const R = this.R
    for (let i = 0; i < 9; i++) {
      const x = -2.5 + i * 0.625
      ;[-2.15].forEach((z) => {
        const p = this.mesh(this.G('Box', 0.16, 0.5, 0.16), STONE_LIGHT)
        p.position.set(x, 0.5, z)
        g.add(p)
      })
    }
    ;[-2.5, 2.5].forEach((x) => {
      for (let i = 0; i < 6; i++) {
        const p = this.mesh(this.G('Box', 0.16, 0.5, 0.16), STONE_LIGHT)
        p.position.set(x, 0.5, -2.15 + i * 0.75)
        g.add(p)
      }
      const rail = this.mesh(this.G('Box', 0.1, 0.08, 3.8), STONE)
      rail.position.set(x, 0.7, -0.27)
      g.add(rail)
    })
    const back = this.mesh(this.G('Box', 5.1, 0.08, 0.1), STONE)
    back.position.set(0, 0.7, -2.15)
    g.add(back)
    this.courtyard = g
    this.steleGroup = this.add(new T.Group())
    this.steleGroup.position.set(0, 0.48, -0.75)
    this.buildStele()
  }

  // 碑：三种样式；正面贴 DataTexture（刻字 + 灰尘）
  buildStele() {
    const T = this.T
    const g = this.steleGroup
    while (g.children.length) g.remove(g.children[0])
    const style = this.tomb.style
    const TILT = 0.32
    let fw, fh, faceY, faceZ
    if (style === 'wubei') {
      const body = this.mesh(this.G('Box', 2.0, 0.55, 0.9), STONE)
      body.position.set(0, 0.34, 0)
      body.rotation.x = TILT
      const base = this.mesh(this.G('Box', 2.3, 0.16, 1.1), STONE_DARK)
      base.position.set(0, 0.08, 0)
      g.add(body, base)
      fw = 1.8; fh = 0.78
    } else {
      const H = 1.85
      const W = 0.9
      const D = 0.22
      const body = this.mesh(this.G('Box', W, H, D), STONE)
      body.position.set(0, H / 2 + 0.12, 0)
      g.add(body)
      const base = this.mesh(this.G('Box', W + 0.5, 0.24, D + 0.4), STONE_DARK)
      base.position.set(0, 0.12, 0)
      g.add(base)
      if (style === 'yuanshou') {
        const top = this.mesh(this.G('Cylinder', W / 2, W / 2, D, 16, 1, false, 0, Math.PI), STONE)
        top.rotation.z = Math.PI / 2
        top.rotation.y = Math.PI / 2
        top.position.set(0, H + 0.12, 0)
        g.add(top)
      } else {
        const cap = this.mesh(this.G('Box', W + 0.14, 0.12, D + 0.1), STONE_LIGHT)
        cap.position.set(0, H + 0.18, 0)
        g.add(cap)
      }
      fw = W * 0.86; fh = H * 0.84; faceY = H / 2 + 0.12; faceZ = D / 2 + 0.006
    }
    // 碑面
    const geo = this.G('Plane', fw, fh)
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
    uv.needsUpdate = true
    this.texW = style === 'wubei' ? 512 : 256
    this.texH = style === 'wubei' ? 224 : 512
    this.texCanvas = this.makeCanvas(this.texW, this.texH)
    this.texCtx = this.texCanvas.getContext('2d')
    this.texData = new Uint8Array(this.texW * this.texH * 4)
    this.tex = new T.DataTexture(this.texData, this.texW, this.texH, T.RGBAFormat)
    this.tex.magFilter = T.LinearFilter
    this.tex.minFilter = T.LinearFilter
    this.tex.generateMipmaps = false
    const face = new T.Mesh(geo, new T.MeshLambertMaterial({ map: this.tex }))
    if (style === 'wubei') {
      // 卧碑的字刻在朝向观者的斜顶面上
      const n = { y: Math.cos(TILT), z: Math.sin(TILT) }
      face.rotation.x = -(Math.PI / 2 - TILT)
      face.position.set(0, 0.34 + n.y * 0.281, n.z * 0.281)
    } else {
      face.position.set(0, faceY, faceZ)
    }
    g.add(face)
    this.face = face
    this.cells = null
    this.texDirty = true
  }

  // 墓园门楼：两根朱红立柱、额枋、牌匾、灰瓦庑殿顶（中式，避免鸟居式出挑横梁）
  buildGate() {
    const T = this.T
    const g = this.add(new T.Group())
    g.position.set(0, 0, -4.3)
    ;[-1.9, 1.9].forEach((x) => {
      const p = this.mesh(this.G('Cylinder', 0.15, 0.17, 2.9, 8), RED)
      p.position.set(x, 1.45, 0)
      const base = this.mesh(this.G('Box', 0.5, 0.32, 0.5), STONE)
      base.position.set(x, 0.16, 0)
      g.add(p, base)
    })
    const lintel = this.mesh(this.G('Box', 3.8, 0.26, 0.3), RED)
    lintel.position.set(0, 2.72, 0)
    const lintel2 = this.mesh(this.G('Box', 3.8, 0.12, 0.26), '#c49a3e')
    lintel2.position.set(0, 2.5, 0)
    const bracket = this.mesh(this.G('Box', 4.0, 0.18, 0.5), '#5a3d28')
    bracket.position.set(0, 2.94, 0)
    const roof = this.mesh(this.G('Cylinder', 0.6, 3.0, 0.75, 4, 1), ROOF)
    roof.rotation.y = Math.PI / 4
    roof.scale.set(1.25, 1, 0.5)
    roof.position.set(0, 3.38, 0)
    const ridge = this.mesh(this.G('Box', 2.0, 0.16, 0.2), '#3b332d')
    ridge.position.set(0, 3.8, 0)
    ;[-1, 1].forEach((sx) => {
      const end = this.mesh(this.G('Cone', 0.09, 0.32, 4), '#3b332d')
      end.position.set(sx * 1.02, 3.95, 0)
      end.rotation.z = sx * -0.5
      g.add(end)
    })
    const plaque = this.mesh(this.G('Box', 1.1, 0.4, 0.06), '#1f2a24')
    plaque.position.set(0, 2.72, 0.18)
    const plaqueRim = this.mesh(this.G('Box', 1.22, 0.5, 0.04), '#c49a3e')
    plaqueRim.position.set(0, 2.72, 0.16)
    g.add(lintel, lintel2, bracket, roof, ridge, plaqueRim, plaque)
    this.gate = g
  }

  buildTrees() {
    const T = this.T
    const R = rng(this.seed ^ 0x77)
    this.maples = []
    this.pines = []
    const maplePos = [[-4.4, 1.2], [4.3, 0.4], [-5.6, -2.6], [5.8, -3.0], [-7.6, 4.2], [7.8, 3.6], [-9.5, 0.4], [9.4, -0.6]]
    maplePos.forEach(([x, z]) => {
      const t = new T.Group()
      const s = 0.85 + R() * 0.5
      const trunk = this.mesh(this.G('Cylinder', 0.09 * s, 0.16 * s, 1.6 * s, 6), '#4c3a2b')
      trunk.position.y = 0.8 * s
      t.add(trunk)
      const br = this.mesh(this.G('Cylinder', 0.04 * s, 0.07 * s, 0.9 * s, 5), '#4c3a2b')
      br.position.set(0.25 * s, 1.5 * s, 0)
      br.rotation.z = -0.7
      t.add(br)
      const leaves = []
      for (let k = 0; k < 6; k++) {
        const l = this.mesh(this.G('Icosahedron', (0.55 + R() * 0.35) * s, 0), '#c77a2c')
        l.position.set((R() - 0.5) * 1.3 * s, (1.8 + R() * 0.9) * s, (R() - 0.5) * 1.1 * s)
        l.rotation.set(R() * 3, R() * 3, R() * 3)
        l.userData.ci = Math.floor(R() * 4)
        t.add(l)
        leaves.push(l)
      }
      const snow = this.mesh(this.G('Icosahedron', 0.5 * s, 0), '#f4f7f9')
      snow.position.set(0, 2.25 * s, 0)
      snow.scale.y = 0.35
      t.add(snow)
      t.position.set(x, 0, z)
      t.rotation.y = R() * 6
      t.userData = { leaves, snow, sway: R() * 6 }
      this.add(t)
      this.maples.push(t)
    })
    const pinePos = [[-9, -6], [-6.5, -8], [8.6, -7], [11, -2], [-11, -1], [6, -9.5], [-2.8, -9], [2.6, -10]]
    pinePos.forEach(([x, z]) => {
      const t = new T.Group()
      const s = 1 + R() * 0.7
      const trunk = this.mesh(this.G('Cylinder', 0.1 * s, 0.14 * s, 0.8 * s, 5), '#3f3125')
      trunk.position.y = 0.4 * s
      t.add(trunk)
      const cones = []
      for (let k = 0; k < 3; k++) {
        const c = this.mesh(this.G('Cone', (1.1 - k * 0.28) * s, 1.3 * s, 7), '#2f5136')
        c.position.y = (1.0 + k * 0.7) * s
        t.add(c)
        cones.push(c)
      }
      t.position.set(x, 0, z)
      t.userData = { cones }
      this.add(t)
      this.pines.push(t)
    })
  }

  buildLanterns() {
    const T = this.T
    this.lanterns = []
    ;[[-1.95, 2.7], [1.95, 2.7]].forEach(([x, z], i) => {
      const g = new T.Group()
      const base = this.mesh(this.G('Cylinder', 0.26, 0.32, 0.18, 6), STONE)
      base.position.y = 0.09
      const post = this.mesh(this.G('Cylinder', 0.09, 0.11, 0.7, 6), STONE)
      post.position.y = 0.53
      const tray = this.mesh(this.G('Cylinder', 0.26, 0.2, 0.1, 6), STONE)
      tray.position.y = 0.92
      const box = this.mesh(this.G('Box', 0.32, 0.3, 0.32), new T.MeshLambertMaterial({ color: 0xc9b98f, emissive: new T.Color('#ffcf86'), emissiveIntensity: 0, flatShading: true }))
      box.position.y = 1.12
      const roof = this.mesh(this.G('Cone', 0.36, 0.26, 6), STONE_DARK)
      roof.position.y = 1.4
      const tip = this.mesh(this.G('Sphere', 0.06, 6, 4), STONE_DARK)
      tip.position.y = 1.56
      g.add(base, post, tray, box, roof, tip)
      g.position.set(x, 0, z)
      const light = new T.PointLight(0xffc477, 0, 5, 2)
      light.position.set(x, 1.15, z)
      this.add(light)
      this.lampLights.push(light)
      this.add(g)
      this.lanterns.push(box)
    })
  }

  buildTable() {
    const T = this.T
    const g = this.add(new T.Group())
    g.position.set(0, 0.26, 1.1)
    const top = this.mesh(this.G('Box', 1.9, 0.12, 0.62), STONE_LIGHT)
    top.position.y = 0.5
    ;[-0.7, 0.7].forEach((x) => {
      const leg = this.mesh(this.G('Box', 0.22, 0.46, 0.46), STONE)
      leg.position.set(x, 0.23, 0)
      g.add(leg)
    })
    g.add(top)
    // 香炉
    const burner = this.mesh(this.G('Cylinder', 0.22, 0.17, 0.22, 10), '#6f5631')
    burner.position.set(0, 0.67, 0)
    const rim = this.mesh(this.G('Cylinder', 0.25, 0.25, 0.04, 10), '#8a6d3e')
    rim.position.set(0, 0.79, 0)
    ;[-1, 1].forEach((s) => {
      const ear = this.mesh(this.G('Box', 0.05, 0.1, 0.05), '#8a6d3e')
      ear.position.set(s * 0.24, 0.84, 0)
      g.add(ear)
    })
    g.add(burner, rim)
    this.table = g
    this.burnerTop = new T.Vector3(0, 0.26 + 0.8, 1.1)
  }

  // 小人（自己/他人）：圆柱身 + 球头，可鞠躬
  makeFigure(color, scale) {
    const T = this.T
    const s = scale || 1
    const g = new T.Group()
    const legs = this.mesh(this.G('Cylinder', 0.16 * s, 0.2 * s, 0.42 * s, 8), '#2f2b26')
    legs.position.y = 0.21 * s
    const upper = new T.Group()
    upper.position.y = 0.42 * s
    const body = this.mesh(this.G('Cylinder', 0.15 * s, 0.2 * s, 0.5 * s, 8), color)
    body.position.y = 0.25 * s
    const head = this.mesh(this.G('Sphere', 0.17 * s, 10, 8), '#e8cfb2')
    head.position.y = 0.66 * s
    const hair = this.mesh(this.G('Sphere', 0.175 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), '#2a2420')
    hair.position.y = 0.67 * s
    hair.rotation.x = -0.3
    upper.add(body, head, hair)
    g.add(legs, upper)
    g.userData.upper = upper
    return g
  }

  buildAvatar() {
    this.avatar = this.add(this.makeFigure('#5d6b52', 1))
    this.avatar.position.set(0, 0.08, 3.9)
    this.avatar.rotation.y = Math.PI
  }

  buildParticles() {
    const T = this.T
    const N = 160
    const pos = new Float32Array(N * 3)
    const R = this.R
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (R() - 0.5) * 22
      pos[i * 3 + 1] = R() * 9
      pos[i * 3 + 2] = (R() - 0.5) * 22
    }
    const g = new T.BufferGeometry()
    g.addAttribute ? g.addAttribute('position', new T.BufferAttribute(pos, 3)) : g.setAttribute('position', new T.BufferAttribute(pos, 3))
    this.partGeo = g
    this.partSeeds = Array.from({ length: N }, () => R() * 6)
    this.parts = this.add(new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false })))
    // 雨丝
    const rp = new Float32Array(120 * 6)
    const rg = new T.BufferGeometry()
    rg.addAttribute ? rg.addAttribute('position', new T.BufferAttribute(rp, 3)) : rg.setAttribute('position', new T.BufferAttribute(rp, 3))
    this.rainGeo = rg
    this.rainSeeds = Array.from({ length: 120 }, () => [(R() - 0.5) * 20, R() * 10, (R() - 0.5) * 20])
    this.rain = this.add(new T.LineSegments(rg, new T.LineBasicMaterial({ color: 0xc9d6e2, transparent: true, opacity: 0.45 })))
  }

  buildSmoke() {
    const T = this.T
    // 柔边圆点贴图（DataTexture，避免依赖图片加载）
    const S = 32
    const d = new Uint8Array(S * S * 4)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2 + 0.5) / (S / 2)
        const dy = (y - S / 2 + 0.5) / (S / 2)
        const a = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1)
        const i = (y * S + x) * 4
        d[i] = d[i + 1] = d[i + 2] = 255
        d[i + 3] = Math.round(a * a * 255)
      }
    }
    this.softTex = new T.DataTexture(d, S, S, T.RGBAFormat)
    this.softTex.needsUpdate = true
    this.smokeN = 70
    const p = new Float32Array(this.smokeN * 3)
    const g = new T.BufferGeometry()
    g.addAttribute ? g.addAttribute('position', new T.BufferAttribute(p, 3)) : g.setAttribute('position', new T.BufferAttribute(p, 3))
    this.smokeGeo = g
    this.smokeState = Array.from({ length: this.smokeN }, () => ({ life: 99, x: 0, y: -9, z: 0, vx: 0, vz: 0 }))
    this.smoke = this.add(new T.Points(g, new T.PointsMaterial({ color: 0xe9e7e0, size: 0.2, map: this.softTex, transparent: true, opacity: 0.3, depthWrite: false })))
    this.parts.material.map = this.softTex
    this.parts.material.needsUpdate = true
  }

  // ---------- 外部接口 ----------
  resize(w, h, pixelRatio) {
    this.w = w; this.h = h
    if (pixelRatio) this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setEnv(env) {
    let changed = false
    ;['season', 'phase', 'weather', 'quality'].forEach((k) => { if (env[k] && env[k] !== this[k]) { this[k] = env[k]; changed = true } })
    if (changed) this.applyEnv()
  }

  applyEnv() {
    const T = this.T
    const P = PHASES[this.phase] || PHASES.noon
    const S = SEASONS[this.season] || SEASONS.autumn
    const grey = this.weather !== 'clear'
    const Pg = grey ? Object.assign({}, P, {
      skyTop: mixHex(P.skyTop, '#5f6870', 0.55), skyMid: mixHex(P.skyMid, '#8e979c', 0.6), skyBot: mixHex(P.skyBot, '#a9b0b3', 0.6),
      fog: mixHex(P.fog, '#9aa2a6', 0.5), sunI: P.sunI * 0.45, hemi: P.hemi * 0.95
    }) : P
    this.paintSky(Pg)
    this.scene.fog.color.set(Pg.fog)
    this.scene.fog.near = grey ? 8 : 14
    this.scene.fog.far = grey ? 38 : 60
    this.scene.background = new T.Color(Pg.skyBot)
    this.hemi.color.set(Pg.hemiSky)
    this.hemi.groundColor.set(Pg.hemiGround)
    this.hemi.intensity = Pg.hemi
    this.sun.color.set(Pg.sun)
    this.sun.intensity = Pg.sunI
    this.sun.position.set(Pg.sunPos[0], Pg.sunPos[1], Pg.sunPos[2])
    this.stars.material.opacity = grey ? 0 : Pg.star
    this.moon.visible = this.phase === 'night' && !grey
    this.clouds.children.forEach((c) => c.children.forEach((b) => {
      b.material.color.set(this.phase === 'night' ? '#4a5f70' : grey ? '#c9ced2' : '#fff8ee')
      b.material.opacity = grey ? 0.95 : 0.8
    }))
    this.clouds.visible = true
    // 山：远处更淡
    this.mountains.forEach((m) => {
      const base = this.phase === 'night' ? '#1d2f36' : this.season === 'winter' ? '#9fb0b6' : '#3e5a52'
      m.material = this.mat(mixHex(base, Pg.fog, 0.2 + m.userData.layer * 0.25))
    })
    this.paintGround(S)
    this.maples.forEach((t) => {
      t.userData.leaves.forEach((l) => {
        l.visible = !S.bare
        l.material = this.mat(S.leaf[l.userData.ci % S.leaf.length])
      })
      t.userData.snow.visible = S.bare
    })
    this.pines.forEach((t) => t.userData.cones.forEach((c, i) => { c.material = this.mat(S.bare && i === 2 ? '#e8eef0' : S.pine) }))
    // 灯
    const lamp = Pg.lamp
    this.lanterns.forEach((b) => { b.material.emissiveIntensity = lamp * 0.9 })
    this.lampLights.forEach((l) => { l.intensity = lamp * 0.9 })
    this.parts.material.color.set(this.phase === 'night' && this.season === 'summer' ? '#e9ff9a' : S.particle)
    this.parts.material.blending = this.phase === 'night' && this.season === 'summer' ? T.AdditiveBlending : T.NormalBlending
    this.parts.material.size = this.season === 'winter' ? 0.11 : 0.13
    this.rain.visible = this.weather === 'rain' && this.season !== 'winter'
    this.texDirty = true
  }

  setTomb(t) {
    const style = t.style || 'qingshi'
    const changed = style !== this.tomb.style
    this.tomb = { name: t.name || '', dates: t.dates || '', epitaph: t.epitaph || '', style }
    if (changed) this.buildStele()
    this.texDirty = true
  }

  setTiming(t) {
    if (t.serverOffset !== undefined) this.serverOffset = t.serverOffset
    if (t.incenseMs) this.incenseMs = t.incenseMs
    if (t.candleMs) this.candleMs = t.candleMs
  }

  now() { return Date.now() + this.serverOffset }

  setOfferings(list) {
    const now = this.now()
    const alive = (o) => o.state === 'active' && (!o.expiresAt || Date.parse(o.expiresAt) > now)
    const act = (list || []).filter(alive)
    const flowers = act.filter((o) => o.type === 'flower').sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt))
    const incense = act.filter((o) => o.type === 'incense').slice(-8)
    const candles = act.filter((o) => o.type === 'candle').slice(-6)
    const key = flowers.map((f) => f.id).join() + '|' + incense.map((f) => f.id).join() + '|' + candles.map((f) => f.id).join()
    this.incenseList = incense
    if (key === this.offerKey) return
    this.offerKey = key
    this.rebuildFlowers(flowers)
    this.rebuildIncense(incense)
    this.rebuildCandles(candles)
  }

  bundles(flowers) {
    const out = []
    for (let i = 0; i < flowers.length; i += 3) out.push(flowers.slice(i, i + 3))
    return out.slice(-7)
  }

  rebuildFlowers(flowers) {
    const T = this.T
    const g = this.flowerGroup
    while (g.children.length) g.remove(g.children[0])
    const bundles = this.bundles(flowers)
    const order = [0, -1, 1, -2, 2, -3, 3]
    const n = bundles.length
    bundles.forEach((b, i) => {
      const rank = n - 1 - i
      const o = order[rank]
      const bundle = new T.Group()
      b.forEach((st, k) => {
        const c = FLOWER[st.subtype] || FLOWER.baiju
        const kk = b.length === 1 ? 0 : k / (b.length - 1) - 0.5
        const stem = this.mesh(this.G('Cylinder', 0.012, 0.012, 0.42, 4), '#3f6a3c')
        stem.position.set(kk * 0.1, 0.21, 0)
        stem.rotation.z = -kk * 0.5
        bundle.add(stem)
        if (st.subtype === 'cuibai') {
          const c1 = this.mesh(this.G('Cone', 0.07, 0.22, 5), c.head)
          c1.position.set(kk * 0.22, 0.46, 0)
          c1.rotation.z = -kk * 0.5
          bundle.add(c1)
        } else {
          const head = this.mesh(this.G('Icosahedron', 0.075, 1), c.head)
          head.position.set(kk * 0.22, 0.44, 0)
          head.scale.y = 0.7
          const heart = this.mesh(this.G('Sphere', 0.03, 6, 4), c.heart)
          heart.position.set(kk * 0.22, 0.48, 0.03)
          bundle.add(head, heart)
        }
      })
      const wrap = this.mesh(this.G('Cone', 0.1, 0.24, 6, 1, true), '#efe4cc', { side: T.DoubleSide })
      wrap.rotation.x = Math.PI
      wrap.position.y = 0.14
      bundle.add(wrap)
      bundle.position.set(o * 0.32, 0.48, -0.2 + Math.abs(o) * -0.06)
      bundle.rotation.x = -0.25
      bundle.rotation.y = o * 0.08
      const fade = Math.min(0.3, rank * 0.05)
      if (fade > 0) bundle.traverse((m) => { if (m.material && m.material.color) m.material = this.mat(mixHex('#' + m.material.color.getHexString(), '#8f8a7c', fade)) })
      g.add(bundle)
    })
  }

  rebuildIncense(list) {
    const g = this.incenseGroup
    while (g.children.length) g.remove(g.children[0])
    const n = list.length
    this.sticks = list.map((o, i) => {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5
      const stick = this.mesh(this.G('Cylinder', 0.008, 0.008, 1, 4), '#9c3b2c')
      const ember = this.mesh(this.G('Sphere', 0.018, 6, 4), new this.T.MeshBasicMaterial({ color: 0xff8a3c }))
      g.add(stick, ember)
      return { o, stick, ember, x: this.burnerTop.x + k * 0.28, z: this.burnerTop.z + (i % 2 ? 0.04 : -0.04) }
    })
  }

  rebuildCandles(list) {
    const T = this.T
    const g = this.candleGroup
    while (g.children.length) g.remove(g.children[0])
    this.flames = []
    list.forEach((o, i) => {
      const side = i % 2 === 0 ? -1 : 1
      const step = Math.floor(i / 2)
      const x = side * (0.55 + step * 0.16)
      const body = this.mesh(this.G('Cylinder', 0.035, 0.035, 0.2, 8), '#f1ebdc')
      body.position.set(x, 0.26 + 0.66, 1.1)
      const flame = this.mesh(this.G('Cone', 0.025, 0.08, 6), new T.MeshBasicMaterial({ color: 0xffcf6a }))
      flame.position.set(x, 0.26 + 0.8, 1.1)
      g.add(body, flame)
      this.flames.push(flame)
    })
  }

  setPeers(peers) {
    const T = this.T
    const prev = {}
    this.peers.forEach((p) => { prev[p.key] = p })
    while (this.peerGroup.children.length) this.peerGroup.remove(this.peerGroup.children[0])
    const slots = [[-1.15, 3.9], [1.2, 4.0], [-1.75, 4.7], [1.8, 4.8], [-0.75, 5.3], [0.8, 5.4]]
    const colors = ['#6b4f3a', '#4a5e7a', '#7a4e4e', '#4f5d3a', '#5a4a68', '#3f5a5a']
    this.peers = (peers || []).slice(0, 6).map((p, i) => {
      const f = this.makeFigure(colors[i % colors.length], 0.95)
      f.position.set(slots[i][0], 0.06, slots[i][1])
      f.rotation.y = Math.atan2(-slots[i][0], -(slots[i][1] + 0.75))
      this.peerGroup.add(f)
      return { key: p.key, fig: f, bowAt: prev[p.key] ? prev[p.key].bowAt : 0 }
    })
  }

  peerBow(key) {
    const p = this.peers.find((x) => x.key === key)
    if (p) p.bowAt = Date.now()
  }

  // ---------- 擦碑 ----------
  initCells(dust) {
    const cols = this.tomb.style === 'wubei' ? 16 : 8
    const rows = this.tomb.style === 'wubei' ? 7 : 16
    const R = rng(this.seed ^ 0x51ed)
    this.cells = []
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const specks = []
        for (let k = 0; k < 6; k++) specks.push([R(), R(), 0.6 + R() * 1.8])
        this.cells.push({ i, j, cols, rows, d: dust, specks })
      }
    }
  }

  setWipeLevel(level) {
    this.wipeLevel = clamp(Number(level) || 0, 0, 1)
    const target = 1 - this.wipeLevel
    if (!this.cells) this.initCells(target)
    else this.cells.forEach((c) => { c.d = Math.min(c.d, target) })
    this.texDirty = true
  }

  hitFace(x, y) {
    const T = this.T
    const ndc = new T.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObject(this.face)
    return hit.length ? hit[0].uv : null
  }

  isOnStele(x, y) { return !!this.hitFace(x, y) }

  wipeAt(x, y) {
    if (this.bow || !this.cells) return 0
    const uv = this.hitFace(x, y)
    if (!uv) return 0
    const u = uv.x
    const v = uv.y
    const r = 0.16
    let removed = 0
    this.cells.forEach((c) => {
      if (c.d <= 0) return
      const cu = (c.i + 0.5) / c.cols
      const cv = (c.j + 0.5) / c.rows
      const du = (cu - u)
      const dv = (cv - v) * (this.texH / this.texW)
      const dist = Math.sqrt(du * du + dv * dv)
      if (dist > r) return
      const k = 0.34 * (1 - dist / r)
      const nd = Math.max(0, c.d - k)
      removed += c.d - nd
      c.d = nd
    })
    const frac = removed / this.cells.length
    this.wipeAcc += frac
    if (frac > 0) this.texDirty = true
    return frac
  }

  consumeWipe() { const v = this.wipeAcc; this.wipeAcc = 0; return v }
  dustAmount() {
    if (!this.cells) return 1 - this.wipeLevel
    let s = 0
    this.cells.forEach((c) => { s += c.d })
    return s / this.cells.length
  }
  sweep() { this.sweepAt = Date.now(); this.texDirty = true }

  startBow(cycles) { this.bow = { at: Date.now(), cycles: cycles || 3 } }
  stopBow() { this.bow = null }
  isBowing() { return !!this.bow }

  // ---------- 视角 ----------
  dragBy(dx, dy) {
    this.yawGoal = clamp(this.yawGoal - dx * 0.006, -0.55, 0.55)
    this.pitchGoal = clamp(this.pitchGoal + dy * 0.004, 0.12, 0.62)
  }
  zoomBy(f) { this.radiusGoal = clamp(this.radiusGoal * f, 8.5, 16) }
  resetView() { this.yawGoal = 0; this.pitchGoal = 0.24; this.radiusGoal = 13.4 }

  // ---------- 碑面贴图 ----------
  drawTexture(now) {
    const ctx = this.texCtx
    const W = this.texW
    const H = this.texH
    const t = this.tomb
    const night = this.phase === 'night'
    // 石面
    ctx.fillStyle = '#8f8b7d'
    ctx.fillRect(0, 0, W, H)
    const R = rng(this.seed ^ 0x3333)
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
      ctx.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 3)
    }
    ctx.strokeStyle = 'rgba(40,38,32,0.45)'
    ctx.lineWidth = 3
    ctx.strokeRect(8, 8, W - 16, H - 16)
    // 碑饰
    ctx.strokeStyle = 'rgba(40,38,32,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    if (t.style === 'qingshi') {
      const y = 34; const x0 = W * 0.28; const w = W * 0.44
      ctx.moveTo(x0, y); ctx.lineTo(x0 + w * 0.22, y - 12); ctx.lineTo(x0 + w * 0.38, y - 3); ctx.lineTo(x0 + w * 0.55, y - 16); ctx.lineTo(x0 + w * 0.75, y - 4); ctx.lineTo(x0 + w, y)
    } else if (t.style === 'yuanshou') {
      const cx = W / 2; const cy = 40
      for (let i = -3; i <= 3; i++) { const a = -Math.PI / 2 + i * 0.3; ctx.moveTo(cx, cy + 8); ctx.lineTo(cx + Math.cos(a) * 22, cy + 8 + Math.sin(a) * 22) }
    } else {
      ;[20, W - 38].forEach((x) => { for (let k = 0; k < 3; k++) { const y = 50 + k * 44; ctx.rect(x, y, 18, 18); ctx.moveTo(x + 5, y + 5); ctx.lineTo(x + 13, y + 5); ctx.lineTo(x + 13, y + 13) } })
    }
    ctx.stroke()
    // 刻字（金漆）
    const gold = night ? '#f1d89a' : '#e9d6a2'
    const groove = 'rgba(25,22,18,0.65)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (t.style === 'wubei') {
      const fs = Math.min(86, (W - 120) / Math.max(1.5, Array.from(t.name).length))
      ctx.font = `bold ${Math.round(fs)}px serif`
      ctx.fillStyle = groove; ctx.fillText(t.name, W / 2 + 2, 30 + 2)
      ctx.fillStyle = gold; ctx.fillText(t.name, W / 2, 30)
      ctx.font = '22px serif'
      ctx.fillStyle = '#efe7d2'
      if (t.dates) ctx.fillText(t.dates, W / 2, 30 + fs + 14)
      if (t.epitaph) ctx.fillText(Array.from(t.epitaph).slice(0, 18).join(''), W / 2, 30 + fs + 50)
    } else {
      const chars = Array.from(t.name)
      const n = Math.max(1, chars.length)
      const fs = Math.min(W * 0.4, (H * 0.68) / (n * 1.08))
      ctx.font = `bold ${Math.round(fs)}px serif`
      const y0 = 70 + (H * 0.72 - n * fs * 1.08) / 2
      chars.forEach((ch, i) => {
        ctx.fillStyle = groove; ctx.fillText(ch, W / 2 + 2, y0 + i * fs * 1.08 + 2)
        ctx.fillStyle = gold; ctx.fillText(ch, W / 2, y0 + i * fs * 1.08)
      })
      ctx.font = '19px serif'
      ctx.fillStyle = '#efe7d2'
      const vt = (text, x) => Array.from(text).slice(0, 18).forEach((ch, i) => ctx.fillText(ch, x, 70 + i * 21))
      if (t.dates) vt(t.dates, W - 34)
      if (t.epitaph) vt(t.epitaph, 34)
    }
    // 灰尘
    if (!this.cells) this.initCells(1 - this.wipeLevel)
    const cw = W / this.cells[0].cols
    const ch = H / this.cells[0].rows
    this.cells.forEach((c) => {
      if (c.d < 0.02) return
      const x = c.i * cw
      const y = c.j * ch
      ctx.fillStyle = `rgba(112,96,72,${(c.d * 0.55).toFixed(3)})`
      ctx.fillRect(x, y, cw + 1, ch + 1)
      ctx.fillStyle = `rgba(78,66,50,${(c.d * 0.7).toFixed(3)})`
      c.specks.forEach((s) => { ctx.fillRect(x + s[0] * cw, y + s[1] * ch, s[2], s[2]) })
    })
    const el = now - this.sweepAt
    if (this.sweepAt && el < 900) {
      ctx.fillStyle = 'rgba(245,240,228,0.6)'
      ctx.fillRect(0, (el / 900) * H - 18, W, 36)
    }
    const img = ctx.getImageData(0, 0, W, H)
    this.texData.set(img.data)
    this.tex.needsUpdate = true
  }

  // ---------- 帧 ----------
  render(t) {
    const now = t || Date.now()
    const dt = this.lastT ? Math.min(100, now - this.lastT) : 16
    this.lastT = now
    this.trackPerf(dt, now)
    const sweeping = this.sweepAt && now - this.sweepAt < 950
    if ((this.texDirty || sweeping) && now - this.texAt > 60) {
      this.drawTexture(now)
      this.texDirty = false
      this.texAt = now
    }
    this.animate(now, dt)
    this.updateCamera(now, dt)
    this.renderer.render(this.scene, this.camera)
  }

  trackPerf(dt, now) {
    this.frameEma = this.frameEma * 0.92 + dt * 0.08
    if (this.quality !== 'standard') return
    if (this.frameEma > 40) {
      if (!this.slowSince) this.slowSince = now
      else if (now - this.slowSince > 3000) {
        this.quality = 'smooth'
        this.slowSince = 0
        if (this.o.onQuality) this.o.onQuality('smooth')
      }
    } else this.slowSince = 0
  }

  bowAmount(at, now, cycles) {
    const period = 2800
    const el = now - at
    if (el >= period * cycles) return -1
    const p = (el % period) / period
    if (p < 0.35) return ease(p / 0.35)
    if (p < 0.6) return 1
    return 1 - ease((p - 0.6) / 0.4)
  }

  updateCamera(now, dt) {
    const k = 1 - Math.pow(0.001, dt / 1000)
    this.yaw += (this.yawGoal - this.yaw) * k
    this.pitch += (this.pitchGoal - this.pitch) * k
    this.radius += (this.radiusGoal - this.radius) * k
    let dip = 0
    if (this.bow) {
      const b = this.bowAmount(this.bow.at, now, this.bow.cycles)
      if (b < 0) {
        this.bow = null
        if (this.o.onBowEnd) this.o.onBowEnd()
      } else dip = b
    }
    this.avatar.userData.upper.rotation.x = -dip * 0.8
    const target = { x: 0, y: 1.6 - dip * 0.25, z: -0.6 }
    const r = this.radius - dip * 0.9
    const pitch = this.pitch - dip * 0.06
    this.camera.position.set(target.x + Math.sin(this.yaw) * Math.cos(pitch) * r, target.y + Math.sin(pitch) * r + 0.4, target.z + Math.cos(this.yaw) * Math.cos(pitch) * r)
    this.camera.lookAt(target.x, target.y, target.z)
    // 自己的小人随视角站在镜头前方的石板路上（第三人称，从背后看）
    const ad = Math.min(4.2, r * 0.31)
    this.avatar.position.set(Math.sin(this.yaw) * ad, 0.08, -0.6 + Math.cos(this.yaw) * ad)
    this.avatar.rotation.y = Math.PI + this.yaw
  }

  animate(now, dt) {
    const s = now / 1000
    // 树轻摆
    this.maples.forEach((t) => { t.rotation.z = Math.sin(s * 0.8 + t.userData.sway) * 0.015 })
    this.clouds.children.forEach((c) => {
      c.userData.angle += c.userData.speed * dt / 16 * 0.05
      c.position.x = Math.cos(c.userData.angle) * 55
      c.position.z = Math.sin(c.userData.angle) * 55 - 10
    })
    // 他人鞠躬
    this.peers.forEach((p) => {
      let b = 0
      if (p.bowAt) {
        b = this.bowAmount(p.bowAt, now, 3)
        if (b < 0) { p.bowAt = 0; b = 0 }
      }
      p.fig.userData.upper.rotation.x = -b * 0.8
    })
    // 香
    const nowS = this.now()
    let emitters = []
    ;(this.sticks || []).forEach((st) => {
      const frac = clamp((Date.parse(st.o.expiresAt) - nowS) / this.incenseMs, 0, 1)
      const len = 0.12 + 0.3 * frac
      st.stick.scale.y = len
      st.stick.position.set(st.x, this.burnerTop.y + len / 2, st.z)
      st.ember.position.set(st.x, this.burnerTop.y + len, st.z)
      emitters.push([st.x, this.burnerTop.y + len, st.z])
    })
    this.updateSmoke(emitters, dt)
    // 烛火
    const P = PHASES[this.phase] || PHASES.noon
    ;(this.flames || []).forEach((f, i) => {
      const fl = 1 + Math.sin(s * 11 + i * 1.7) * 0.12 + Math.sin(s * 27 + i) * 0.06
      f.scale.set(1, fl, 1)
    })
    const nc = (this.flames || []).length
    this.candleLight.intensity = nc ? (0.5 + P.lamp * 1.1) * Math.min(1.6, 0.6 + nc * 0.25) * (1 + Math.sin(s * 9) * 0.05) : 0
    // 粒子
    this.updateParticles(s, dt)
  }

  updateSmoke(emitters, dt) {
    const pos = this.smokeGeo.attributes.position
    const smooth = this.quality === 'smooth'
    this.smokeState.forEach((p, i) => {
      p.life += dt / 1000
      if (p.life > 4.2 && emitters.length && (!smooth || i % 2 === 0) && Math.random() < 0.06) {
        const e = emitters[Math.floor(Math.random() * emitters.length)]
        p.life = 0; p.x = e[0]; p.y = e[1]; p.z = e[2]; p.vx = (Math.random() - 0.5) * 0.06; p.vz = (Math.random() - 0.5) * 0.04
      }
      if (p.life <= 4.2) {
        p.y += 0.00032 * dt
        p.x += p.vx * dt / 1000 + Math.sin(p.life * 2.2 + i) * 0.00012 * dt * p.life
        p.z += p.vz * dt / 1000
        pos.setXYZ(i, p.x, p.y, p.z)
      } else pos.setXYZ(i, 0, -50, 0)
    })
    pos.needsUpdate = true
  }

  updateParticles(s, dt) {
    const kind = this.season === 'winter' ? 'snow' : this.season === 'summer' ? (this.phase === 'night' ? 'firefly' : 'none') : 'leaf'
    const pos = this.partGeo.attributes.position
    const smooth = this.quality === 'smooth'
    this.parts.visible = kind !== 'none'
    const N = pos.count
    for (let i = 0; i < N; i++) {
      if (smooth && i % 2) { pos.setXYZ(i, 0, -50, 0); continue }
      let x = pos.getX(i); let y = pos.getY(i); let z = pos.getZ(i)
      const sd = this.partSeeds[i]
      if (y < -10) y = Math.random() * 9
      if (kind === 'snow') { y -= 0.0012 * dt * (this.weather === 'rain' ? 1.6 : 1); x += Math.sin(s + sd) * 0.002 }
      else if (kind === 'leaf') { y -= 0.0008 * dt; x += Math.sin(s * 1.3 + sd) * 0.006; z += Math.cos(s + sd) * 0.003 }
      else if (kind === 'firefly') { x += Math.sin(s * 0.7 + sd) * 0.004; y = 0.6 + Math.abs(Math.sin(s * 0.5 + sd)) * 1.6; z += Math.cos(s * 0.6 + sd) * 0.004 }
      if (y < 0) { y = 8 + Math.random() * 2; x = (Math.random() - 0.5) * 22; z = (Math.random() - 0.5) * 22 }
      pos.setXYZ(i, x, y, z)
    }
    pos.needsUpdate = true
    if (this.rain.visible) {
      const rp = this.rainGeo.attributes.position
      this.rainSeeds.forEach((r, i) => {
        r[1] -= 0.012 * dt
        if (r[1] < 0) { r[1] = 10; r[0] = (Math.random() - 0.5) * 20; r[2] = (Math.random() - 0.5) * 20 }
        rp.setXYZ(i * 2, r[0], r[1], r[2])
        rp.setXYZ(i * 2 + 1, r[0] + 0.05, r[1] + 0.45, r[2])
      })
      rp.needsUpdate = true
    }
  }

  dispose() {
    try { this.renderer.dispose() } catch (e) { /* */ }
  }
}

Memorial3D.PHASES = PHASES
Memorial3D.SEASONS = SEASONS
module.exports = Memorial3D
