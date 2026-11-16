const store = require('../../utils/store')
const { parseInvite } = require('../../utils/link')
const config = require('../../config')

Page({
  data: {
    slogan: config.slogan,
    tombs: [],
    showMine: false,
    showJoin: false,
    joinText: '',
    joinErr: ''
  },

  onShow() {
    const tombs = store.listTombs()
    this.setData({ tombs, showMine: this.data.showMine || tombs.length > 0 })
  },

  goCreate() { wx.navigateTo({ url: '/pages/create/create' }) },

  openTomb(e) {
    const id = e.currentTarget.dataset.id
    const t = store.getTomb(id)
    if (!t) return
    const q = t.adm ? `adm=${encodeURIComponent(t.adm)}` : `inv=${encodeURIComponent(t.inv)}`
    wx.navigateTo({ url: `/pages/tomb/tomb?id=${encodeURIComponent(id)}&${q}` })
  },

  removeTomb(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '从本机移除',
      content: '只是从这台手机的列表里移除，纪念墓本身不会被删除。若你是建墓人，请确认已另存管理链接。',
      confirmText: '移除',
      success: (r) => {
        if (!r.confirm) return
        store.removeTomb(id)
        this.setData({ tombs: store.listTombs() })
      }
    })
  },

  toggleJoin() { this.setData({ showJoin: !this.data.showJoin, showMine: false, joinErr: '' }) },
  toggleMine() { this.setData({ showMine: !this.data.showMine, showJoin: false, tombs: store.listTombs() }) },

  onJoinInput(e) { this.setData({ joinText: e.detail.value, joinErr: '' }) },

  pasteJoin() {
    wx.getClipboardData({
      success: (r) => this.setData({ joinText: r.data || '', joinErr: '' })
    })
  },

  submitJoin() {
    const inv = parseInvite(this.data.joinText)
    if (!inv) {
      this.setData({ joinErr: '没有识别出有效的邀请链接，请粘贴完整链接' })
      return
    }
    wx.navigateTo({
      url: `/pages/tomb/tomb?id=${encodeURIComponent(inv.id)}&${inv.kind}=${encodeURIComponent(inv.token)}`
    })
    this.setData({ showJoin: false, joinText: '' })
  },

  goLegal(e) { wx.navigateTo({ url: `/pages/legal/legal?doc=${e.currentTarget.dataset.doc}` }) },

  onShareAppMessage() {
    return { title: '云扫墓 · ' + config.slogan, path: '/pages/index/index' }
  }
})
