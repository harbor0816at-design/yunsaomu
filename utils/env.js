// 季节 / 昼夜 / 天气（S1-05、S1-06、S1-07；Q3：季节墓级一致，昼夜与天气只在本机生效；不调用任何天气接口）

const SEASONS = [
  { id: 'spring', name: '春日花开' },
  { id: 'summer', name: '夏日林荫' },
  { id: 'autumn', name: '秋日落叶' },
  { id: 'winter', name: '冬日飘雪' }
]
const TODS = [
  { id: 'auto', name: '跟随本地时间' },
  { id: 'day', name: '白昼' },
  { id: 'night', name: '夜晚' }
]
const WEATHERS = [
  { id: 'clear', name: '晴' },
  { id: 'cloudy', name: '阴' },
  { id: 'rain', name: '细雨' }
]

function seasonByMonth(month1to12) {
  const m = month1to12
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 11) return 'autumn'
  return 'winter'
}

// 墓级 season_mode：'auto' 或固定季节；访客本机临时切换优先
function resolveSeason(tombMode, localOverride, date) {
  if (localOverride) return localOverride
  if (tombMode && tombMode !== 'auto') return tombMode
  return seasonByMonth((date || new Date()).getMonth() + 1)
}

// 四档：dawn 晨 / noon 午 / dusk 黄昏 / night 夜
function phaseByHour(h) {
  if (h >= 5 && h < 9) return 'dawn'
  if (h >= 9 && h < 16) return 'noon'
  if (h >= 16 && h < 19) return 'dusk'
  return 'night'
}

function resolvePhase(tod, date) {
  if (tod === 'day') return 'noon'
  if (tod === 'night') return 'night'
  return phaseByHour((date || new Date()).getHours())
}

module.exports = { SEASONS, TODS, WEATHERS, seasonByMonth, resolveSeason, phaseByHour, resolvePhase }
