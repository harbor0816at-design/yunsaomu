// 动作短提示（S1-15）：只描述动作，不显示可点开的个人资料，不形成消息流；5 秒内的连续提示合并。
const VERB = {
  flower: '献上了一束花',
  incense: '上了一炷香',
  candle: '点亮了一支烛',
  wipe: '擦拭了墓碑',
  bow: '在墓前鞠躬',
  inscription: '留下了几句话'
}
const SHORT = { flower: '献花', incense: '上香', candle: '点烛', wipe: '擦碑', bow: '鞠躬', inscription: '留言' }

class Hints {
  constructor(opts) {
    this.windowMs = (opts && opts.windowMs) || 5000
    this.showMs = (opts && opts.showMs) || 3000
    this.events = []
    this.until = 0
  }

  // 返回当前应显示的文本（或 null 表示不变）
  push(kind, now) {
    if (!VERB[kind]) return null
    const t = now || Date.now()
    this.events = this.events.filter((e) => t - e.t <= this.windowMs)
    this.events.push({ kind, t })
    this.until = t + this.showMs
    return this.text()
  }

  text() {
    if (!this.events.length) return ''
    if (this.events.length === 1) return '有人刚刚' + VERB[this.events[0].kind]
    const kinds = []
    this.events.forEach((e) => { if (kinds.indexOf(e.kind) < 0) kinds.push(e.kind) })
    if (kinds.length === 1) return '亲友们刚刚' + VERB[kinds[0]]
    return '亲友们刚刚' + kinds.map((k) => SHORT[k]).join('、')
  }

  visible(now) { return (now || Date.now()) < this.until }
}

module.exports = Hints
