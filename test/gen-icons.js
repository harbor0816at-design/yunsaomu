// 从网页版的线条图标（viewBox 24）生成小程序用 PNG：常态纸色、选中金色
const { chromium } = require('playwright')
const path = require('path')
const ICONS = {
  flower: '<circle cx="12" cy="10" r="3.2"/><path d="M12 13v7M9 19c2 1 5 1 6 0"/><path d="M12 8l3-4M12 8l-3-4M12 8l4-1M12 8l-4-1"/>',
  incense: '<path d="M8 20h8M10 20V10M14 20V10"/><path d="M10 9c0-2 1-3 1-5M14 9c.5-2-.5-3 0-5"/>',
  candle: '<path d="M9 21h6M10 21V11h4v10"/><path d="M12 11c0-2 1.5-3 1.5-4.5S12 5 12 7s-1.6 1.6-1.6 3"/>',
  wipe: '<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M8 9h8M8 13h6"/>',
  bow: '<circle cx="12" cy="6" r="2"/><path d="M12 8c-1 3 3 4 2 7M9 20c2-2 5-2 7 0M10 13h5"/>',
  message: '<path d="M5 5.5h14v10H11l-4 3.5v-3.5H5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>'
}
const VARIANTS = { '': '#f3efe4', '-on': '#e6c86e', '-ink': '#2a2a26' }
;(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const p = await b.newPage({ viewport: { width: 96, height: 96 } })
  for (const [name, body] of Object.entries(ICONS)) {
    for (const [suf, color] of Object.entries(VARIANTS)) {
      if (suf === '-ink' && !['message', 'back'].includes(name)) continue
      await p.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg></body></html>`)
      await p.screenshot({ path: path.join(__dirname, '../assets/icons', name + suf + '.png'), omitBackground: true })
    }
  }
  // 品牌标志（网页版 favicon）
  const brand = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="192" height="192"><rect width="64" height="64" rx="12" fill="#3d4f40"/><path d="M8 50 Q20 42 32 50 Q44 42 56 50 L56 58 L8 58 Z" fill="#8a9a82"/><path d="M18 40 C18 22 26 16 32 12 C38 16 46 22 46 40 L42 40 C42 28 36 22 32 20 C28 22 22 28 22 40 Z" fill="#c9c3b0"/><rect x="28" y="36" width="8" height="16" rx="1" fill="#b8b4a4"/><path d="M28 36 Q32 30 36 36" fill="#b8b4a4"/><line x1="12" y1="18" x2="10" y2="36" stroke="#9aad90" stroke-width="1.2"/><line x1="16" y1="16" x2="14" y2="38" stroke="#8a9d82" stroke-width="1"/><line x1="50" y1="16" x2="52" y2="38" stroke="#8a9d82" stroke-width="1"/></svg>'
  await p.setViewportSize({ width: 192, height: 192 })
  await p.setContent(`<html><body style="margin:0;background:transparent">${brand}</body></html>`)
  await p.screenshot({ path: path.join(__dirname, '../assets/brand.png'), omitBackground: true })
  await b.close()
  console.log('icons ok')
})()
