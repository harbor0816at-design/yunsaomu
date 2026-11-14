// 环境配置。正式发布前，apiBase / realtimeUrl 必须换成已 ICP 备案的自有域名
// （反向代理到 Supabase，或迁到微信云开发），并在小程序后台配置为 request / socket 合法域名。
// *.supabase.co 只能在开发者工具里勾选「不校验合法域名」时使用。
const SUPABASE_REF = 'rvjyfimcimipqxvtagjp'

module.exports = {
  env: 'preview',
  apiBase: `https://${SUPABASE_REF}.supabase.co/functions/v1/api`,
  realtimeUrl: `wss://${SUPABASE_REF}.supabase.co/realtime/v1/websocket`,
  // 公开的 anon key（只用于实时频道握手；所有写操作都经过 Edge Function 校验令牌）
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2anlmaW1jaW1pcHF4dnRhZ2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1Njg1MDQsImV4cCI6MjExMDE0NDUwNH0.0Hn982Vk0ABKUPfTyhNC_BUsDa_Bz_eD5pvdg-MSc6s',
  // 网页版域名：用于解析用户粘贴的邀请链接、以及「复制网页链接」
  webOrigin: 'https://yunsaomu.vercel.app',
  slogan: '想念的时候，来看看。',
  heartbeatMs: 30000
}
