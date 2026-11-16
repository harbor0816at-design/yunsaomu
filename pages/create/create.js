const api = require('../../utils/api')
const store = require('../../utils/store')
const v = require('../../utils/validate')

const STYLES = [
  { id: 'qingshi', name: '青石立碑', desc: '直立青石，顶沿微收，中央一道几何远山纹。' },
  { id: 'wubei', name: '卧碑', desc: '横向卧石，低矮开阔，两侧浅刻回纹。' },
  { id: 'yuanshou', name: '圆首碑', desc: '圆拱碑首，碑额一枚简化松针纹。' }
]
const SCENES = [{ id: 'default', name: '青山小院' }]
const PRECISIONS = [
  { id: 'year', name: '年' },
  { id: 'month', name: '年月' },
  { id: 'day', name: '年月日' }
]

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function pickerToParts(val) {
  if (!val) return null
  const [y, m, d] = String(val).split('-').map(Number)
  return { y, m: m || null, d: d || null }
}

Page({
  data: {
    step: 1,
    consent: false,
    name: '',
    nameErr: '',
    birthPrec: 'year', birth: '',
    deathPrec: 'year', death: '',
    epitaph: '',
    address: '',
    sceneTheme: 'default',
    stele: 'qingshi',
    showNameInShare: true,
    showMore: false,
    err: '',
    submitting: false,
    today: today(),
    styles: STYLES,
    scenes: SCENES,
    precisions: PRECISIONS,
    created: null
  },

  onLoad() {
    const d = store.getDraft()
    if (d && typeof d === 'object') this.setData(Object.assign({}, d, { step: 1, err: '', created: null, submitting: false }))
  },

  saveDraft() {
    const { name, birthPrec, birth, deathPrec, death, epitaph, address, stele, showNameInShare } = this.data
    store.setDraft({ name, birthPrec, birth, deathPrec, death, epitaph, address, stele, showNameInShare })
  },

  toggleConsent() { this.setData({ consent: !this.data.consent }) },
  onName(e) { this.setData({ name: e.detail.value, nameErr: '' }); this.saveDraft() },
  onEpitaph(e) { this.setData({ epitaph: e.detail.value, err: '' }); this.saveDraft() },
  onAddress(e) { this.setData({ address: e.detail.value, err: '' }); this.saveDraft() },
  setStele(e) { this.setData({ stele: e.currentTarget.dataset.id }); this.saveDraft() },
  setScene(e) { this.setData({ sceneTheme: e.currentTarget.dataset.id }) },
  toggleShareName() { this.setData({ showNameInShare: !this.data.showNameInShare }); this.saveDraft() },
  toggleMore() { this.setData({ showMore: !this.data.showMore }) },

  setBirthPrec(e) { this.setData({ birthPrec: e.currentTarget.dataset.id, birth: '', err: '' }); this.saveDraft() },
  setDeathPrec(e) { this.setData({ deathPrec: e.currentTarget.dataset.id, death: '', err: '' }); this.saveDraft() },
  onBirth(e) { this.setData({ birth: e.detail.value, err: '' }); this.saveDraft() },
  onDeath(e) { this.setData({ death: e.detail.value, err: '' }); this.saveDraft() },
  clearBirth() { this.setData({ birth: '' }); this.saveDraft() },
  clearDeath() { this.setData({ death: '' }); this.saveDraft() },

  goLegal(e) { wx.navigateTo({ url: `/pages/legal/legal?doc=${e.currentTarget.dataset.doc}` }) },

  next() {
    if (!this.data.consent) { this.setData({ nameErr: '请先阅读并勾选上方确认' }); return }
    const err = v.validateName(this.data.name)
    if (err) { this.setData({ nameErr: err }); return }
    this.setData({ step: 2 })
  },
  back() { this.setData({ step: 1, err: '' }) },

  validateAll() {
    const d = this.data
    return v.validateName(d.name) ||
      v.validateDates(pickerToParts(d.birth), pickerToParts(d.death)) ||
      v.validateEpitaph(d.epitaph) ||
      v.validateAddress(d.address)
  },

  async submit() {
    if (this.data.submitting) return
    const err = this.validateAll()
    if (err) { this.setData({ err }); return }
    const d = this.data
    const b = v.toApiDate(pickerToParts(d.birth))
    const dd = v.toApiDate(pickerToParts(d.death))
    const payload = {
      consent: true,
      deceasedName: d.name.trim(),
      // 旧字段：兼容未升级的后端（只填一侧时旧后端会要求一并填写，见 backend/README）
      birthYear: b.year, deathYear: dd.year,
      // V2 字段（后端 v2 读取；旧后端忽略）
      birthDate: b.date, birthPrecision: b.precision,
      deathDate: dd.date, deathPrecision: dd.precision,
      epitaph: d.epitaph.trim(),
      graveAddress: d.address.trim() || null,
      addressVisibility: 'private',
      sceneTheme: d.sceneTheme,
      seasonMode: 'auto',
      steleStyleId: d.stele,
      showNameInShare: d.showNameInShare
    }
    this.setData({ submitting: true, err: '' })
    try {
      const res = await api.createTomb(payload)
      store.upsertTomb({ id: res.tomb.id, name: res.tomb.deceasedName, inv: res.inviteToken, adm: res.adminToken })
      store.clearDraft()
      this.setData({ created: { id: res.tomb.id, name: res.tomb.deceasedName, inv: res.inviteToken, adm: res.adminToken, adminUrl: res.adminUrl, inviteUrl: res.inviteUrl } })
    } catch (e) {
      this.setData({ err: e.message || '暂时无法建立，请稍后再试' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  copyAdmin() {
    const c = this.data.created
    if (!c) return
    wx.setClipboardData({ data: c.adminUrl, success: () => wx.showToast({ title: '已复制，请妥善保存', icon: 'none' }) })
  },

  enterTomb() {
    const c = this.data.created
    if (!c) return
    wx.redirectTo({ url: `/pages/tomb/tomb?id=${encodeURIComponent(c.id)}&adm=${encodeURIComponent(c.adm)}` })
  }
})
