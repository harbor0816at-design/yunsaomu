// 极简 Supabase Realtime 客户端（Phoenix 协议 vsn 1.0.0），基于 wx.connectSocket。
// 只用到：broadcast（收服务端事件 'server'、收发小程序端事件 'mp'）和 presence（在线人数）。
const config = require('../config')

class Realtime {
  constructor(tombId, presenceKey, handlers) {
    this.topic = `realtime:memorial:${tombId}`
    this.key = presenceKey
    this.h = handlers || {}
    this.ref = 0
    this.task = null
    this.joined = false
    this.closed = false
    this.retry = 0
    this.presence = {}
    this.meta = {}
    this.hbTimer = null
    this.reTimer = null
  }

  nextRef() { this.ref += 1; return String(this.ref) }

  connect() {
    if (this.closed) return
    const url = `${config.realtimeUrl}?apikey=${encodeURIComponent(config.anonKey)}&vsn=1.0.0`
    const task = wx.connectSocket({ url, timeout: 10000 })
    this.task = task
    task.onOpen(() => {
      this.retry = 0
      this.send({
        topic: this.topic,
        event: 'phx_join',
        payload: {
          config: { broadcast: { self: false, ack: false }, presence: { key: this.key }, private: false },
          access_token: config.anonKey
        },
        ref: this.nextRef()
      })
      this.hbTimer = setInterval(() => {
        this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() })
      }, 25000)
    })
    task.onMessage((m) => {
      let msg
      try { msg = JSON.parse(m.data) } catch (e) { return }
      this.handle(msg)
    })
    const drop = () => {
      clearInterval(this.hbTimer)
      this.joined = false
      if (this.task === task) this.task = null
      if (this.closed) return
      this.h.onStatus && this.h.onStatus('offline')
      const wait = Math.min(15000, 1000 * Math.pow(2, this.retry++))
      this.reTimer = setTimeout(() => this.connect(), wait)
    }
    task.onClose(drop)
    task.onError(() => { try { task.close({}) } catch (e) { drop() } })
  }

  handle(msg) {
    if (msg.topic !== this.topic) return
    if (msg.event === 'phx_reply' && msg.payload && msg.payload.status === 'ok' && !this.joined) {
      this.joined = true
      this.h.onStatus && this.h.onStatus('online')
      if (this.meta) this.track(this.meta)
      return
    }
    if (msg.event === 'broadcast' && msg.payload) {
      const p = msg.payload
      if (p.event === 'server' && this.h.onServer) this.h.onServer(p.payload || {})
      if (p.event === 'mp' && this.h.onPeer) this.h.onPeer(p.payload || {})
      return
    }
    if (msg.event === 'presence_state') {
      this.presence = msg.payload || {}
      this.emitPresence()
      return
    }
    if (msg.event === 'presence_diff') {
      const { joins = {}, leaves = {} } = msg.payload || {}
      Object.keys(leaves).forEach((k) => { delete this.presence[k] })
      Object.keys(joins).forEach((k) => { this.presence[k] = joins[k] })
      this.emitPresence()
    }
  }

  emitPresence() {
    if (!this.h.onPresence) return
    const list = Object.keys(this.presence).map((k) => {
      const metas = (this.presence[k] && this.presence[k].metas) || []
      return Object.assign({ key: k }, metas[metas.length - 1] || {})
    })
    this.h.onPresence(list)
  }

  send(obj) {
    if (!this.task) return
    try { this.task.send({ data: JSON.stringify(obj) }) } catch (e) { /* 断线时忽略，重连后恢复 */ }
  }

  track(meta) {
    this.meta = meta
    if (!this.joined) return
    this.send({
      topic: this.topic, event: 'presence',
      payload: { type: 'presence', event: 'track', payload: meta },
      ref: this.nextRef()
    })
  }

  broadcast(payload) {
    if (!this.joined) return
    this.send({
      topic: this.topic, event: 'broadcast',
      payload: { type: 'broadcast', event: 'mp', payload },
      ref: this.nextRef()
    })
  }

  close() {
    this.closed = true
    clearInterval(this.hbTimer)
    clearTimeout(this.reTimer)
    if (this.task) {
      this.send({ topic: this.topic, event: 'phx_leave', payload: {}, ref: this.nextRef() })
      try { this.task.close({}) } catch (e) { /* */ }
    }
    this.task = null
  }
}

module.exports = Realtime
