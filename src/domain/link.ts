/**
 * 祈愿链接提取与规范化(spec 02 §3 D1–D5):全部纯函数,一键获取/手动粘贴/文件导入
 * 三入口共用(spec 02 §4)。输出为「规范 API URL」——域名按 game_biz 重建为官方
 * getGachaLog 接口,后续探底(probe)与分页拉取只在此基础上覆写
 * gacha_type/size/page/end_id 四项(D10)。判定参数只认数值,禁止按中文池名匹配(D5)。
 */
import { LinkParseError } from './errors'

/** 规范 API 域名:game_biz=hk4e_cn → 国服(D2) */
const CN_API_BASE = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog'
/** 规范 API 域名:game_biz=hk4e_global 或缺省 → 国际服(客户端内嵌页自用域名,研究票 §1.2) */
const GLOBAL_API_BASE = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog'

/** D1:URL 终结于首个控制字符(\x00–\x1f)或引号(缓存是二进制,粘贴文本可能带引号包裹) */
// eslint-disable-next-line no-control-regex -- 控制字符正是本正则的终结边界,属刻意使用
const URL_PATTERN = /https:\/\/[^\x00-\x1f"']+/g

/** D1:有效祈愿 URL 载体标记(内嵌页 URL 与 webview 发出的 API 请求 URL 均带全套鉴权参数) */
const AUTH_MARKER = 'auth_appid=webview_gacha'

/**
 * D1 提取:字节按 latin1 解码(URL 段全为 ASCII,二进制按 UTF-8 解码会丢字节),
 * 提取全部含 auth_appid=webview_gacha 的 URL;逐字节相同去重(保序,取首个出现位)。
 * 输入为空/无匹配返回 []。
 */
export function extractGachaUrls(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes)
  const urls: string[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0]
    if (!url.includes(AUTH_MARKER)) continue
    if (!urls.includes(url)) urls.push(url)
  }
  return urls
}

/**
 * D2+D3+D4 规范化:解析原始 URL 查询参数后重建规范 API URL。
 * 域名按 game_biz 选择(hk4e_cn → 国服,其余或缺省 → 国际服),原参数全部保留,
 * fragment(如 #/log)随重建丢弃;authkey 未编码时补编码(D3),lang 一律强制 zh-cn(D4)。
 * 查询参数手工拆装而非 URLSearchParams:'+' 会被表单解码误读成空格,authkey 会被破坏。
 */
export function normalizeGachaUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new LinkParseError('祈愿链接格式不正确,请重新复制完整链接')
  }

  const query = url.search.replace(/^\?/, '')
  const pairs = query === '' ? [] : query.split('&')
  let authkey: string | null = null
  let gameBiz: string | null = null
  let hasLang = false
  const rebuilt = pairs.map((pair) => {
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    if (key === 'authkey') {
      authkey = value
      return `authkey=${fixAuthkeyEncoding(value)}`
    }
    if (key === 'game_biz') gameBiz = value
    if (key === 'lang') {
      hasLang = true
      return 'lang=zh-cn' // D4:一律强制覆写,不论原值
    }
    return pair
  })

  if (authkey === null || authkey === '') {
    throw new LinkParseError('祈愿链接缺少 authkey 鉴权参数,请重新复制完整链接')
  }
  if (!hasLang) rebuilt.push('lang=zh-cn')

  const base = gameBiz === 'hk4e_cn' ? CN_API_BASE : GLOBAL_API_BASE
  return `${base}?${rebuilt.join('&')}`
}

/**
 * D3 authkey 编码修复(biuuu fixAuthkey 规则):值不含 % 且含 =、/、+ 之一
 * → 判定未 URL-encode,对该值补 encodeURIComponent;已含 %(已编码)或本就
 * 无需编码的值原样保留。处理的是查询串里的原始值,不做任何解码。
 */
function fixAuthkeyEncoding(raw: string): string {
  if (raw.includes('%')) return raw
  if (/[=/+]/.test(raw)) return encodeURIComponent(raw)
  return raw
}

/**
 * 组合入口(三入口共用):提取 → 原始去重(D1)→ 逐条规范化 → 规范形态再去重
 * (不同原始串规范化后可能相同,如仅差 #/log fragment);结果保序。
 * 逐候选容错(与 §4 D6 探底同哲学):单条候选规范化失败(LinkParseError)直接跳过,
 * 缓存写入中被覆盖出的半截条目不影响其余好链接;提取到候选但**全部**失败 →
 * 上抛最后一个 LinkParseError(保留「链接无效」的精确反馈);原始提取 0 条 →
 * 返回 [](「无链接/链接坏」由入口层区分,前者走 CacheLinkNotFoundError 引导)。
 */
export function canonicalize(bytes: Uint8Array): string[] {
  const raws = extractGachaUrls(bytes)
  if (raws.length === 0) return []
  const seen = new Set<string>()
  const urls: string[] = []
  let lastError: LinkParseError | null = null
  for (const raw of raws) {
    let canonical: string
    try {
      canonical = normalizeGachaUrl(raw)
    } catch (error) {
      if (!(error instanceof LinkParseError)) throw error
      lastError = error
      continue
    }
    if (!seen.has(canonical)) {
      seen.add(canonical)
      urls.push(canonical)
    }
  }
  if (urls.length === 0 && lastError !== null) throw lastError
  return urls
}
