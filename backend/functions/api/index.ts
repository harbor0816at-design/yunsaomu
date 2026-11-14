// 云扫墓 api —— v2（V2.0 第 1 阶段）。基于线上 v1（2026-11-13 部署）修改，接口与令牌完全向后兼容。
// 相对 v1 的改动：
//   1. 自动过审默认关闭（YUNSAOMU_AUTO_APPROVE_MS 默认 0；PRD Q7 / B-07）
//   2. 生卒日期：生、卒可单独填写，支持年 / 年月 / 年月日精度（PRD 3.1）；旧的 birthYear/deathYear 仍可用
//   3. 新字段：grave_address（默认私密，只在管理令牌下返回）、scene_theme、season_mode
//   4. 墓碑样式缺省为 qingshi（建墓页只填称呼即可建立）
//   5. 称呼文案改为「逝者姓名或纪念称呼」
// 部署前先执行 backend/migrations/20261114_v2_phase1_add_columns.sql。
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const FULL_MESSAGE = "这座墓前的人已经满了，请稍后再来，或请建墓人协调。"
const INVALID_LINK_MESSAGE = "这条链接无效或已失效，无法进入纪念墓。"
const GENERIC_REJECT = "这条留言未能发布，请修改后再试。"
const GENERIC_PHOTO_REJECT = "这张照片未能使用，请更换后重试。"
const GENERIC_PHOTO_TYPE = "仅支持 JPG、PNG 或 WebP 图片，且不超过 5 MB。"
const PAPER_TIP = "此为象征性纸钱，请勿在实地不安全用火。"
const DEFAULT_DISPLAY_NAME = "来访的亲人"
const STELE_IDS = ["qingshi", "wubei", "yuanshou"]
const SCENE_THEMES = ["default"]
const SEASON_MODES = ["auto", "spring", "summer", "autumn", "winter"]
const PRECISIONS = ["year", "month", "day"]
const FLOWER_IDS = ["baiju", "huangju", "cuibai"]
const COLORS = ["#3d4f40", "#6b4f3a", "#4a5e7a", "#7a4e4e", "#4f5d3a", "#5a4a68", "#3f5a5a", "#6a5a3a"]
const MAX_PHOTO = 5 * 1024 * 1024
const BLOCK = [
  "色情", "淫秽", "裸体", "性交",
  "毒品", "冰毒", "海洛因",
  "枪支", "炸药", "爆炸物",
  "赌博网站", "代开发票", "办证中介", "加微信办理",
  "免费办理发票", "收款码广告",
  "侮辱逝者", "死有余辜", "不得好死",
  "点击领取", "推广返利", "代刷单",
]

function cfgNum(k: string, d: number) {
  const v = Deno.env.get(k)
  return v !== undefined && v !== "" ? Number(v) : d
}

function config() {
  return {
    incenseMs: cfgNum("YUNSAOMU_INCENSE_MS", 120_000),
    candleMs: cfgNum("YUNSAOMU_CANDLE_MS", 600_000),
    flowerTtlMs: cfgNum("YUNSAOMU_FLOWER_TTL_MS", 30 * 24 * 3600 * 1000),
    wipeHoldMs: cfgNum("YUNSAOMU_WIPE_HOLD_MS", 24 * 3600 * 1000),
    autoApproveMs: cfgNum("YUNSAOMU_AUTO_APPROVE_MS", 0),
    maxPresence: cfgNum("YUNSAOMU_MAX_PRESENCE", 16),
    incenseStations: cfgNum("YUNSAOMU_INCENSE_STATIONS", 2),
    maxBurningIncense: cfgNum("YUNSAOMU_MAX_BURNING_INCENSE", 8),
    sessionTtlMs: cfgNum("YUNSAOMU_SESSION_TTL_MS", 120_000),
  }
}

function publicOrigin(req: Request): string {
  const env = Deno.env.get("PUBLIC_ORIGIN") || Deno.env.get("VITE_PUBLIC_ORIGIN")
  if (env) return env.replace(/\/$/, "")
  const o = req.headers.get("origin") || req.headers.get("referer")
  if (o) {
    try { return new URL(o).origin } catch { /* */ }
  }
  return "https://yunsaomu.vercel.app"
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "*"
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-tomb-token, x-token-kind, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Vary": "Origin",
  }
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  })
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function matchesHash(token: string, hash: string): Promise<boolean> {
  return timingSafeEqualHex(await sha256(token), hash)
}

function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  let s = ""
  for (const b of a) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function newId(prefix: string, bytes = 10): string {
  return prefix + "_" + randomToken(bytes)
}

function containsContact(text: string): boolean {
  if (!text) return false
  if (/1[3-9]\d{9}/.test(text)) return true
  if (/\d{17}[\dXx]/.test(text)) return true
  if (/(电话|手机|微信|身份证|住址|门牌|宿舍号)\s*[:：]?\s*\w/.test(text)) return true
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return true
  return false
}

function charLen(s: string): number { return Array.from(s ?? "").length }

function validateDeceasedName(name: string): string | null {
  const n = (name ?? "").trim()
  if (!n) return "请填写逝者姓名或纪念称呼"
  if (charLen(n) > 40) return "称呼请不超过 40 个字"
  if (containsContact(n)) return "称呼中请不要填写联系方式或证件号码"
  return null
}

function validateDisplayName(name: string): string | null {
  const n = (name ?? "").trim()
  if (charLen(n) > 20) return "显示名请不超过 20 个字"
  if (containsContact(n)) return "显示名请不要填写证件号码、电话或详细住址"
  return null
}

type DatePart = { date: string; precision: string; lo: number; hi: number; year: number } | null

// 接受 { birthDate: 'YYYY-MM-DD', birthPrecision } 或旧字段 birthYear
function parseDatePart(dateRaw: unknown, precRaw: unknown, yearRaw: unknown, label: string): { v: DatePart; err?: string } {
  const has = (x: unknown) => x !== null && x !== undefined && String(x) !== ""
  let y: number, m = 1, d = 1, precision = "year"
  if (has(dateRaw)) {
    const mm = String(dateRaw).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!mm) return { v: null, err: `${label}日期格式不正确` }
    y = Number(mm[1]); m = Number(mm[2]); d = Number(mm[3])
    precision = PRECISIONS.includes(String(precRaw)) ? String(precRaw) : "day"
    if (precision === "year") { m = 1; d = 1 }
    if (precision === "month") d = 1
  } else if (has(yearRaw)) {
    y = Number(yearRaw)
    if (!Number.isInteger(y)) return { v: null, err: "年份请填写整数" }
  } else {
    return { v: null }
  }
  if (!Number.isInteger(y) || y < 1800) return { v: null, err: `${label}年份不在合理范围内` }
  if (m < 1 || m > 12) return { v: null, err: `${label}月份不正确` }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d < 1 || d > last) return { v: null, err: `${label}日期不正确` }
  const lo = Date.UTC(y, m - 1, d)
  const hi = precision === "day" ? lo : precision === "month" ? Date.UTC(y, m, 0) : Date.UTC(y, 11, 31)
  // 以 UTC+14 作为「今天」上限，避免跨时区的用户被误判为填了未来日期
  if (lo > Date.now() + 14 * 3600 * 1000) return { v: null, err: `${label}不能晚于今天` }
  const pad = (n: number) => String(n).padStart(2, "0")
  return { v: { date: `${y}-${pad(m)}-${pad(d)}`, precision, lo, hi, year: y } }
}

function validateEpitaph(text: string): string | null {
  if (charLen(text ?? "") > 80) return "墓志铭请不超过 80 个字"
  return null
}

function validateAddress(text: string): string | null {
  if (charLen(text ?? "") > 120) return "地址请不超过 120 个字"
  if (/1[3-9]\d{9}/.test(text ?? "") || /\d{3,4}-?\d{7,8}/.test(text ?? "")) return "地址中请不要填写电话号码"
  return null
}

function moderateText(text: string): { status: "ok" } | { status: "reject"; code: "policy" } {
  const raw = (text ?? "").trim()
  if (!raw) return { status: "reject", code: "policy" }
  const compact = raw.toLowerCase().replace(/\s+/g, "")
  for (const w of BLOCK) {
    if (compact.includes(w.toLowerCase().replace(/\s+/g, ""))) return { status: "reject", code: "policy" }
  }
  if (containsContact(raw)) return { status: "reject", code: "policy" }
  if (/(https?:\/\/|www\.)/i.test(raw) && /(优惠|代理|加微|买|售|广告)/.test(raw)) {
    return { status: "reject", code: "policy" }
  }
  return { status: "ok" }
}

function isAllowedImageType(mime: string, name = ""): boolean {
  const m = (mime || "").toLowerCase()
  const n = name.toLowerCase()
  if (["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(m)) return true
  if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp")) return true
  return false
}

function sb(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function broadcast(tombId: string, msg: unknown) {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{
          topic: `memorial:${tombId}`,
          event: "server",
          payload: msg,
          private: false,
        }],
      }),
    })
  } catch {
    /* 广播失败不阻断主路径 */
  }
}

type TombRow = Record<string, unknown>

async function getTomb(client: SupabaseClient, id: string): Promise<TombRow | null> {
  const { data, error } = await client.from("tombs").select("*").eq("id", id).maybeSingle()
  if (error || !data || data.status === "deleted") return null
  return data as TombRow
}

async function resolveRole(tomb: TombRow, token: string, kind?: "inv" | "adm"): Promise<"creator" | "guest" | null> {
  if (kind === "adm" || !kind) {
    if (await matchesHash(token, String(tomb.admin_token_hash))) return "creator"
  }
  if (kind === "inv" || !kind) {
    if (await matchesHash(token, String(tomb.invite_token_hash))) return "guest"
  }
  return null
}

function wipeLevel(tomb: TombRow, now: number, wipeHoldMs: number): number {
  let wipe = Number(tomb.wipe_level ?? 0)
  const cleared = tomb.wipe_cleared_at ? Date.parse(String(tomb.wipe_cleared_at)) : 0
  if (wipe >= 1 && cleared) {
    const elapsed = now - cleared
    if (elapsed > wipeHoldMs) wipe = Math.max(0, 1 - (elapsed - wipeHoldMs) / wipeHoldMs)
  }
  return wipe
}

async function photoUrl(client: SupabaseClient, tomb: TombRow): Promise<string | null> {
  if (!tomb.photo_id) return null
  const { data } = await client.from("media").select("*").eq("id", tomb.photo_id).maybeSingle()
  if (!data || data.moderation_status !== "approved") return null
  const { data: signed } = await client.storage.from("memorial-photos").createSignedUrl(String(data.storage_key), 3600)
  return signed?.signedUrl ?? null
}

// 访客可见的墓信息：永远不含 grave_address（PRD Q6 / A1-04）
async function tombPublic(client: SupabaseClient, tomb: TombRow, cfg: ReturnType<typeof config>, now: number) {
  return {
    id: tomb.id,
    deceasedName: tomb.deceased_name,
    photoUrl: await photoUrl(client, tomb),
    birthYear: tomb.birth_year,
    deathYear: tomb.death_year,
    birthDate: tomb.birth_date ?? null,
    birthPrecision: tomb.birth_precision ?? (tomb.birth_year ? "year" : null),
    deathDate: tomb.death_date ?? null,
    deathPrecision: tomb.death_precision ?? (tomb.death_year ? "year" : null),
    epitaph: tomb.epitaph || "",
    steleStyleId: tomb.stele_style_id,
    sceneTheme: tomb.scene_theme || "default",
    seasonMode: tomb.season_mode || "auto",
    createdAt: tomb.created_at,
    status: tomb.status,
    visibility: "link_only",
    showNameInShare: tomb.show_name_in_share,
    wipeLevel: wipeLevel(tomb, now, cfg.wipeHoldMs),
    wipeClearedAt: tomb.wipe_cleared_at,
  }
}

// 仅管理令牌可见
function tombPrivate(tomb: TombRow) {
  return {
    graveAddress: tomb.grave_address ?? null,
    addressVisibility: tomb.address_visibility || "private",
  }
}

function toOffering(o: Record<string, unknown>) {
  return {
    id: o.id,
    tombId: o.tomb_id,
    sessionId: o.session_id,
    actorName: o.actor_name,
    type: o.type,
    subtype: o.subtype,
    placedAt: o.placed_at,
    expiresAt: o.expires_at,
    state: o.state,
    visualParams: o.visual_params || {},
    queuePosition: o.queue_position,
  }
}

async function expireOfferings(client: SupabaseClient, tombId: string, now: number) {
  const { data } = await client.from("offerings")
    .select("*")
    .eq("tomb_id", tombId)
    .eq("state", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", new Date(now).toISOString())
  if (!data?.length) return
  for (const o of data) {
    await client.from("offerings").update({ state: "expired" }).eq("id", o.id)
    await broadcast(tombId, {
      type: "event",
      serverTime: now,
      event: { kind: "offering-update", offering: toOffering({ ...o, state: "expired" }) },
    })
  }
}

async function promoteIncense(client: SupabaseClient, tombId: string, cfg: ReturnType<typeof config>, now: number) {
  const since = new Date(now - 2500).toISOString()
  const { data: recent } = await client.from("offerings")
    .select("id")
    .eq("tomb_id", tombId)
    .eq("type", "incense")
    .eq("state", "active")
    .gte("placed_at", since)
  const busy = recent?.length ?? 0
  if (busy >= cfg.incenseStations) return
  const { data: queued } = await client.from("offerings")
    .select("*")
    .eq("tomb_id", tombId)
    .eq("type", "incense")
    .eq("state", "queued")
    .order("placed_at", { ascending: true })
    .limit(cfg.incenseStations - busy)
  if (!queued?.length) return
  for (const q of queued) {
    const expires = new Date(now + cfg.incenseMs).toISOString()
    const placed = new Date(now).toISOString()
    await client.from("offerings").update({
      state: "active",
      placed_at: placed,
      expires_at: expires,
      queue_position: null,
    }).eq("id", q.id)
    const offering = toOffering({ ...q, state: "active", placed_at: placed, expires_at: expires, queue_position: null })
    await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "offering", offering } })
  }
}

async function visibleOfferings(client: SupabaseClient, tombId: string, sessionId: string | undefined, cfg: ReturnType<typeof config>, now: number) {
  await expireOfferings(client, tombId, now)
  await promoteIncense(client, tombId, cfg, now)
  const { data } = await client.from("offerings").select("*").eq("tomb_id", tombId)
  const all = data || []
  const result: Record<string, unknown>[] = []
  let burning = all.filter((o) => o.type === "incense" && o.state === "active")
  for (const o of all) {
    if (o.type === "incense" && o.state === "active") continue
    if (o.state === "expired") {
      if (o.type === "paper" && now - Date.parse(String(o.placed_at)) <= 5 * 60 * 1000) result.push(o)
      continue
    }
    if (o.state === "queued") continue
    result.push(o)
  }
  if (burning.length > cfg.maxBurningIncense) {
    const own = burning.filter((o) => o.session_id === sessionId)
    const others = burning.filter((o) => o.session_id !== sessionId)
    burning = [...own, ...others].slice(0, cfg.maxBurningIncense)
  }
  result.push(...burning)
  result.sort((a, b) => String(a.placed_at).localeCompare(String(b.placed_at)))
  return result.map(toOffering)
}

async function autoApproveDue(client: SupabaseClient, tombId: string, cfg: ReturnType<typeof config>, now: number) {
  if (cfg.autoApproveMs <= 0) return
  const cutoff = new Date(now - cfg.autoApproveMs).toISOString()
  const { data } = await client.from("inscriptions")
    .select("*")
    .eq("tomb_id", tombId)
    .eq("status", "pending")
    .lte("created_at", cutoff)
  for (const row of data || []) {
    const ts = new Date(now).toISOString()
    await client.from("inscriptions").update({ status: "approved", moderated_at: ts }).eq("id", row.id)
    await client.from("audit_log").insert({
      tomb_id: tombId, actor_role: "system", action: "auto-approve",
      target_type: "inscription", target_id: row.id,
    })
    const inscription = {
      id: row.id, tombId, sessionId: row.session_id, body: row.body,
      displayName: row.display_name, status: "approved", createdAt: row.created_at,
    }
    await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "inscription-update", inscription } })
  }
}

async function visibleInscriptions(
  client: SupabaseClient, tombId: string, sessionId: string | undefined, isAdmin: boolean,
  cfg: ReturnType<typeof config>, now: number,
) {
  await autoApproveDue(client, tombId, cfg, now)
  const { data } = await client.from("inscriptions").select("*").eq("tomb_id", tombId).order("created_at")
  return (data || []).filter((r) => {
    if (r.status === "approved") return true
    if (r.status === "removed" || r.status === "rejected") return isAdmin
    if (r.status === "pending") return isAdmin || r.session_id === sessionId
    return false
  }).map((r) => ({
    id: r.id,
    tombId: r.tomb_id,
    sessionId: r.session_id,
    body: r.body,
    displayName: r.display_name,
    status: r.status,
    createdAt: r.created_at,
    mine: r.session_id === sessionId,
  }))
}

async function activePresence(client: SupabaseClient, tombId: string, ttlMs: number) {
  const since = new Date(Date.now() - ttlMs).toISOString()
  const { data } = await client.from("visit_sessions")
    .select("*")
    .eq("tomb_id", tombId)
    .gt("last_heartbeat_at", since)
  return (data || []).map((s) => ({
    sessionId: s.id,
    displayName: s.display_name,
    color: s.color,
    role: s.role,
    x: 0, z: 4, yaw: Math.PI,
    pose: "stand" as const,
    walking: false,
    away: false,
    bowStartedAt: null as number | null,
    joinedAt: Date.parse(String(s.created_at)) || Date.now(),
  }))
}

function pickColor(used: string[]): string {
  return COLORS.find((c) => !used.includes(c)) || COLORS[Math.floor(Math.random() * COLORS.length)]
}

function pathOf(req: Request): { path: string; url: URL } {
  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf("/api")
  if (idx >= 0) path = path.slice(idx + 4) || "/"
  if (!path.startsWith("/")) path = "/" + path
  return { path, url }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}

function tokenFrom(req: Request, url: URL, raw?: Record<string, unknown>): { token: string; kind: "inv" | "adm" } {
  if (url.searchParams.get("adm")) return { token: url.searchParams.get("adm") || "", kind: "adm" }
  if (url.searchParams.get("inv")) return { token: url.searchParams.get("inv") || "", kind: "inv" }
  if (req.headers.get("x-token-kind") === "adm" || raw?.tokenKind === "adm") {
    return { token: String(raw?.token || req.headers.get("x-tomb-token") || ""), kind: "adm" }
  }
  return { token: String(raw?.token || req.headers.get("x-tomb-token") || ""), kind: "inv" }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) })
  const cfg = config()
  const now = Date.now()
  try {
    const { path, url } = pathOf(req)
    const method = req.method.toUpperCase()
    const client = sb()

    if (path === "/health" || path === "/health/") {
      return json(req, 200, { ok: true, adapter: "supabase", version: 2, time: now, maxPresence: cfg.maxPresence, incenseMs: cfg.incenseMs, candleMs: cfg.candleMs })
    }
    if (path === "/config" && method === "GET") {
      return json(req, 200, {
        incenseMs: cfg.incenseMs, candleMs: cfg.candleMs, maxPresence: cfg.maxPresence,
        posHz: 5, wechatJssdk: false, paperTip: PAPER_TIP, publicOrigin: publicOrigin(req),
      })
    }
    if (path === "/tombs" && method === "GET") {
      return json(req, 404, { error: INVALID_LINK_MESSAGE })
    }

    if (path === "/tombs" && method === "POST") {
      const raw = await readJson(req)
      if (!raw.consent) return json(req, 400, { error: "请先阅读并同意说明" })
      const nameErr = validateDeceasedName(String(raw.deceasedName || ""))
      if (nameErr) return json(req, 400, { error: nameErr })
      const b = parseDatePart(raw.birthDate, raw.birthPrecision, raw.birthYear, "出生")
      if (b.err) return json(req, 400, { error: b.err })
      const d = parseDatePart(raw.deathDate, raw.deathPrecision, raw.deathYear, "离世")
      if (d.err) return json(req, 400, { error: d.err })
      if (b.v && d.v && d.v.hi < b.v.lo) return json(req, 400, { error: "离世日期不能早于出生日期" })
      const epiErr = validateEpitaph(String(raw.epitaph || ""))
      if (epiErr) return json(req, 400, { error: epiErr })
      const address = String(raw.graveAddress || "").trim()
      const addrErr = validateAddress(address)
      if (addrErr) return json(req, 400, { error: addrErr })
      const style = String(raw.steleStyleId || "qingshi")
      if (!STELE_IDS.includes(style)) return json(req, 400, { error: "请选择一种墓碑样式" })
      const scene = String(raw.sceneTheme || "default")
      if (!SCENE_THEMES.includes(scene)) return json(req, 400, { error: "请选择墓园场景" })
      const season = String(raw.seasonMode || "auto")
      if (!SEASON_MODES.includes(season)) return json(req, 400, { error: "季节设置不正确" })

      const inviteToken = randomToken(24)
      const adminToken = randomToken(24)
      const id = newId("tmb", 12)
      const ts = new Date(now).toISOString()
      let photoId: string | null = null
      const photo = raw.photo as { dataBase64?: string; mime?: string; name?: string } | undefined
      if (photo?.dataBase64) {
        const mime = photo.mime || "image/jpeg"
        const name = photo.name || "photo.jpg"
        if (!isAllowedImageType(mime, name)) return json(req, 400, { error: GENERIC_PHOTO_TYPE })
        let bytes: Uint8Array
        try {
          const bin = atob(photo.dataBase64)
          bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        } catch {
          return json(req, 400, { error: GENERIC_PHOTO_TYPE })
        }
        if (bytes.length > MAX_PHOTO) return json(req, 400, { error: GENERIC_PHOTO_TYPE })
        const mid = newId("med")
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg"
        const key = `${id}/${mid}.${ext}`
        const up = await client.storage.from("memorial-photos").upload(key, bytes, { contentType: mime, upsert: false })
        if (up.error) return json(req, 400, { error: GENERIC_PHOTO_TYPE })
        await client.from("media").insert({
          id: mid, tomb_id: id, storage_key: key, content_type: mime,
          byte_size: bytes.length, moderation_status: "pending", exif_stripped: true,
        })
        photoId = mid
      }

      const { error } = await client.from("tombs").insert({
        id,
        deceased_name: String(raw.deceasedName).trim(),
        photo_id: photoId,
        birth_year: b.v?.year ?? null,
        death_year: d.v?.year ?? null,
        birth_date: b.v?.date ?? null,
        birth_precision: b.v?.precision ?? null,
        death_date: d.v?.date ?? null,
        death_precision: d.v?.precision ?? null,
        grave_address: address || null,
        address_visibility: "private",
        scene_theme: scene,
        season_mode: season,
        epitaph: String(raw.epitaph || "").trim(),
        stele_style_id: style,
        created_at: ts, updated_at: ts, status: "active",
        invite_token_hash: await sha256(inviteToken),
        admin_token_hash: await sha256(adminToken),
        visibility: "link_only",
        show_name_in_share: raw.showNameInShare !== false,
        wipe_level: 0,
      })
      if (error) return json(req, 400, { error: "无法建立纪念墓" })
      if (photoId) {
        await client.from("audit_log").insert({
          tomb_id: id, actor_role: "system", action: "photo-pending",
          target_type: "media", target_id: photoId,
        })
      }
      const tomb = await getTomb(client, id)
      const origin = publicOrigin(req)
      return json(req, 201, {
        tomb: await tombPublic(client, tomb!, cfg, now),
        admin: tombPrivate(tomb!),
        inviteUrl: `${origin}/t/${id}?inv=${encodeURIComponent(inviteToken)}`,
        adminUrl: `${origin}/t/${id}?adm=${encodeURIComponent(adminToken)}`,
        inviteToken, adminToken,
      })
    }

    const shareM = path.match(/^\/share\/([^/]+)$/)
    if (shareM && method === "GET") {
      const tombId = decodeURIComponent(shareM[1])
      const inv = url.searchParams.get("inv") || ""
      const tomb = await getTomb(client, tombId)
      if (!tomb || !inv || !(await resolveRole(tomb, inv, "inv"))) {
        return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      }
      const title = tomb.show_name_in_share ? `来为${tomb.deceased_name}扫扫墓` : "一座家人的纪念墓"
      return json(req, 200, {
        title,
        description: "想念的时候，来看看。一座仅持有链接的亲友可见的纪念墓。",
        image: `${publicOrigin(req)}/og-cover.png`,
      })
    }

    const tombM = path.match(/^\/tombs\/([^/]+)(?:\/(.*))?$/)
    if (!tombM) return json(req, 404, { error: "not found" })
    const tombId = decodeURIComponent(tombM[1])
    const rest = tombM[2] || ""
    const tomb = await getTomb(client, tombId)

    if (!rest && method === "GET") {
      const kind = url.searchParams.get("adm") ? "adm" as const : "inv" as const
      const tok = url.searchParams.get("adm") || url.searchParams.get("inv") || ""
      if (!tomb) return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      const role = await resolveRole(tomb, tok, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      return json(req, 200, {
        tomb: await tombPublic(client, tomb, cfg, now),
        ...(role === "creator" ? { admin: tombPrivate(tomb) } : {}),
        role,
        offerings: await visibleOfferings(client, tombId, undefined, cfg, now),
        inscriptions: await visibleInscriptions(client, tombId, undefined, role === "creator", cfg, now),
        serverTime: now,
      })
    }

    if (rest === "enter" && method === "POST") {
      const raw = await readJson(req)
      if (!tomb || tomb.status !== "active") return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      const kind: "inv" | "adm" = raw.tokenKind === "adm" ? "adm" : "inv"
      const role = await resolveRole(tomb, String(raw.token || ""), kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      if (kind === "adm" && role !== "creator") return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      const name = String(raw.displayName || DEFAULT_DISPLAY_NAME)
      const nameErr = validateDisplayName(name)
      if (nameErr) return json(req, 400, { error: nameErr })
      const sessionId = String(raw.sessionId || newId("ses"))
      const existing = await activePresence(client, tombId, cfg.sessionTtlMs)
      const color = existing.find((m) => m.sessionId === sessionId)?.color || pickColor(existing.map((m) => m.color))
      const { data, error } = await client.rpc("enter_visit", {
        p_id: sessionId,
        p_tomb_id: tombId,
        p_role: role,
        p_display_name: name.trim() || DEFAULT_DISPLAY_NAME,
        p_color: color,
        p_max: cfg.maxPresence,
        p_ttl_seconds: Math.round(cfg.sessionTtlMs / 1000),
      })
      if (error) return json(req, 500, { error: "服务暂时不可用" })
      const result = data as { ok?: boolean; code?: string; rejoin?: boolean }
      if (!result?.ok) {
        if (result?.code === "full") return json(req, 409, { error: FULL_MESSAGE, code: "full" })
        return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      }
      const presence = await activePresence(client, tombId, cfg.sessionTtlMs)
      const pub = await tombPublic(client, tomb, cfg, now)
      return json(req, 200, {
        session: { id: sessionId, tombId, role, displayName: name.trim() || DEFAULT_DISPLAY_NAME, color },
        tomb: pub,
        ...(role === "creator" ? { admin: tombPrivate(tomb) } : {}),
        presence,
        offerings: await visibleOfferings(client, tombId, sessionId, cfg, now),
        inscriptions: await visibleInscriptions(client, tombId, sessionId, role === "creator", cfg, now),
        serverTime: now,
        wipeLevel: pub.wipeLevel,
      })
    }

    if (!tomb) return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })

    if ((rest === "heartbeat" || rest === "leave") && method === "POST") {
      const raw = await readJson(req)
      const { token, kind } = tokenFrom(req, url, raw)
      const role = await resolveRole(tomb, token, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE, code: "invalid" })
      const sid = String(raw.sessionId || "")
      if (!sid) return json(req, 400, { error: "缺少会话" })
      if (rest === "leave") {
        await client.from("visit_sessions").delete().eq("id", sid).eq("tomb_id", tombId)
        return json(req, 200, { ok: true })
      }
      await client.from("visit_sessions").update({ last_heartbeat_at: new Date().toISOString() })
        .eq("id", sid).eq("tomb_id", tombId)
      return json(req, 200, { ok: true, serverTime: now })
    }

    if (rest === "offerings" && method === "POST") {
      const raw = await readJson(req)
      const { token, kind } = tokenFrom(req, url, raw)
      const role = await resolveRole(tomb, token, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE })
      const sid = String(raw.sessionId || "")
      const { data: sess } = await client.from("visit_sessions").select("*").eq("id", sid).eq("tomb_id", tombId).maybeSingle()
      if (!sess) return json(req, 400, { error: "请先进入纪念墓" })
      const type = String(raw.type)
      if (!["flower", "incense", "candle", "paper", "wipe", "bow"].includes(type)) {
        return json(req, 400, { error: "未知的祭扫方式" })
      }
      if (type === "flower" && raw.subtype && !FLOWER_IDS.includes(String(raw.subtype))) {
        return json(req, 400, { error: "请选择一种花" })
      }
      await expireOfferings(client, tombId, now)
      if (type === "incense") {
        const since = new Date(now - 2500).toISOString()
        const { data: recent } = await client.from("offerings")
          .select("id").eq("tomb_id", tombId).eq("type", "incense").eq("state", "active").gte("placed_at", since)
        if ((recent?.length ?? 0) >= cfg.incenseStations) {
          const { data: qn } = await client.from("offerings").select("id").eq("tomb_id", tombId).eq("type", "incense").eq("state", "queued")
          const position = (qn?.length ?? 0) + 1
          await client.from("offerings").insert({
            id: newId("off"), tomb_id: tombId, session_id: sid, actor_name: sess.display_name,
            type: "incense", state: "queued", queue_position: position, visual_params: {},
          })
          const message = `前面还有 ${position} 位`
          await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "queue", sessionId: sid, position, message } })
          return json(req, 200, { queued: { position, message } })
        }
      }
      let expiresAt: string | null = null
      if (type === "incense") expiresAt = new Date(now + cfg.incenseMs).toISOString()
      if (type === "candle") expiresAt = new Date(now + cfg.candleMs).toISOString()
      if (type === "flower") expiresAt = new Date(now + cfg.flowerTtlMs).toISOString()
      if (type === "paper") expiresAt = new Date(now + 30_000).toISOString()
      // 鞠躬只作记录与提示，不在场景中常驻
      if (type === "bow") expiresAt = new Date(now + 10_000).toISOString()
      const row = {
        id: newId("off"),
        tomb_id: tombId,
        session_id: sid,
        actor_name: sess.display_name,
        type,
        subtype: raw.subtype ? String(raw.subtype) : null,
        placed_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        state: "active",
        visual_params: raw.visualParams || {},
        queue_position: null,
      }
      const { error } = await client.from("offerings").insert(row)
      if (error) return json(req, 400, { error: "未能完成祭扫" })
      const offering = toOffering(row)
      await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "offering", offering } })
      return json(req, 200, { offering })
    }

    const extM = rest.match(/^offerings\/([^/]+)\/extinguish$/)
    if (extM && method === "POST") {
      const raw = await readJson(req)
      const { token, kind } = tokenFrom(req, url, raw)
      const role = await resolveRole(tomb, token, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE })
      const { data: o } = await client.from("offerings").select("*").eq("id", extM[1]).maybeSingle()
      if (!o || o.tomb_id !== tombId) return json(req, 404, { error: "未找到这支蜡烛" })
      if (o.type !== "candle") return json(req, 400, { error: "只能熄灭蜡烛" })
      await client.from("offerings").update({ state: "extinguished" }).eq("id", o.id)
      const offering = toOffering({ ...o, state: "extinguished" })
      await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "offering-update", offering } })
      return json(req, 200, { offering })
    }

    if (rest === "wipe" && method === "POST") {
      const raw = await readJson(req)
      const { token, kind } = tokenFrom(req, url, raw)
      const role = await resolveRole(tomb, token, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE })
      const inc = Math.max(0, Math.min(1, Number(raw.progress ?? 0.35)))
      const pub0 = await tombPublic(client, tomb, cfg, now)
      let level = Math.min(1, pub0.wipeLevel + inc)
      const patch: Record<string, unknown> = { wipe_level: level }
      if (level >= 1) { level = 1; patch.wipe_level = 1; patch.wipe_cleared_at = new Date(now).toISOString() }
      await client.from("tombs").update(patch).eq("id", tombId)
      const sid = String(raw.sessionId || "")
      await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "wipe", level, sessionId: sid } })
      return json(req, 200, { wipeLevel: level })
    }

    if (rest === "inscriptions" && method === "POST") {
      const raw = await readJson(req)
      const { token, kind } = tokenFrom(req, url, raw)
      const role = await resolveRole(tomb, token, kind)
      if (!role) return json(req, 404, { error: INVALID_LINK_MESSAGE })
      const body = String(raw.body || "").trim()
      if (!body) return json(req, 400, { error: "请写下想说的话" })
      if (charLen(body) > 140) return json(req, 400, { error: "留言请不超过 140 个字" })
      const name = String(raw.displayName || DEFAULT_DISPLAY_NAME).trim() || DEFAULT_DISPLAY_NAME
      const nameErr = validateDisplayName(name)
      if (nameErr) return json(req, 400, { error: nameErr })
      const verdict = moderateText(body)
      const ts = new Date(now).toISOString()
      const row = {
        id: newId("ins"),
        tomb_id: tombId,
        session_id: raw.sessionId ? String(raw.sessionId) : null,
        body,
        display_name: name,
        status: verdict.status === "reject" ? "rejected" : "pending",
        created_at: ts,
        moderated_at: verdict.status === "reject" ? ts : null,
        reject_code: verdict.status === "reject" ? "policy" : null,
      }
      await client.from("inscriptions").insert(row)
      if (row.status === "rejected") {
        return json(req, 200, { inscription: { ...toInscription(row, true) }, rejected: true, message: GENERIC_REJECT })
      }
      const inscription = toInscription(row, true)
      if (cfg.autoApproveMs > 0) {
        const delay = cfg.autoApproveMs
        const id = row.id
        const EdgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
        const work = (async () => {
          await new Promise((r) => setTimeout(r, delay))
          const t2 = Date.now()
          const { data: cur } = await client.from("inscriptions").select("*").eq("id", id).maybeSingle()
          if (!cur || cur.status !== "pending") return
          await client.from("inscriptions").update({ status: "approved", moderated_at: new Date(t2).toISOString() }).eq("id", id)
          await client.from("audit_log").insert({
            tomb_id: tombId, actor_role: "system", action: "auto-approve",
            target_type: "inscription", target_id: id,
          })
          await broadcast(tombId, {
            type: "event", serverTime: t2,
            event: { kind: "inscription-update", inscription: { ...toInscription({ ...cur, status: "approved" }, false) } },
          })
        })()
        if (EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work)
        else { void work }
      }
      return json(req, 201, { inscription })
    }

    const modM = rest.match(/^inscriptions\/([^/]+)\/moderate$/)
    if (modM && method === "POST") {
      const raw = await readJson(req)
      const tok = String(raw.token || url.searchParams.get("adm") || "")
      const role = await resolveRole(tomb, tok, "adm")
      if (role !== "creator") return json(req, 403, { error: "需要管理链接才能审核" })
      const { data: row } = await client.from("inscriptions").select("*").eq("id", modM[1]).maybeSingle()
      if (!row || row.tomb_id !== tombId) return json(req, 404, { error: "未找到这条留言" })
      const action = String(raw.action)
      if (!["approve", "reject", "remove"].includes(action)) return json(req, 400, { error: "未知的审核操作" })
      const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "removed"
      const ts = new Date(now).toISOString()
      await client.from("inscriptions").update({ status, moderated_at: ts }).eq("id", row.id)
      await client.from("audit_log").insert({
        tomb_id: tombId, actor_role: "admin", action, target_type: "inscription", target_id: row.id,
      })
      const inscription = toInscription({ ...row, status, moderated_at: ts }, false)
      await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "inscription-update", inscription } })
      return json(req, 200, { inscription })
    }

    if (rest === "photo/moderate" && method === "POST") {
      const raw = await readJson(req)
      const tok = String(raw.token || url.searchParams.get("adm") || "")
      const role = await resolveRole(tomb, tok, "adm")
      if (role !== "creator") return json(req, 403, { error: "需要管理链接才能审核" })
      const photoId = String(raw.photoId || tomb.photo_id || "")
      const { data: m } = await client.from("media").select("*").eq("id", photoId).maybeSingle()
      if (!m || m.tomb_id !== tombId) return json(req, 404, { error: GENERIC_PHOTO_REJECT })
      const action = String(raw.action)
      if (!["approve", "reject"].includes(action)) return json(req, 400, { error: "未知的审核操作" })
      await client.from("media").update({ moderation_status: action === "approve" ? "approved" : "rejected" }).eq("id", m.id)
      await client.from("audit_log").insert({
        tomb_id: tombId, actor_role: "admin", action: "photo-" + action, target_type: "media", target_id: m.id,
      })
      const fresh = await getTomb(client, tombId)
      const pub = await tombPublic(client, fresh!, cfg, now)
      await broadcast(tombId, { type: "event", serverTime: now, event: { kind: "tomb-update", tomb: pub } })
      return json(req, 200, { tomb: pub })
    }

    return json(req, 404, { error: "not found" })
  } catch (e) {
    console.error(e)
    return json(req, 500, { error: "服务暂时不可用" })
  }
})

function toInscription(r: Record<string, unknown>, mine: boolean) {
  return {
    id: r.id,
    tombId: r.tomb_id,
    sessionId: r.session_id,
    body: r.body,
    displayName: r.display_name,
    status: r.status,
    createdAt: r.created_at,
    mine,
  }
}
