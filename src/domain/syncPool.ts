/**
 * 单池分页拉取(spec 02 §5 D10–D15):在规范 API URL(link.canonicalize 产物)基础上
 * 逐页拉取单个卡池——page/end_id 游标链、响应协议校验(D11)、对照同步水位的增量
 * 提前停(D12)、全局限速(D13)与网络重试(D14)、逐页合并落库(D15)。
 * 外部依赖经 GachaApiPort/ClockPort/StoragePort 注入,本模块自身零 IO,可伪造单测。
 * uid 守卫属五池编排(T07 syncAll),本模块信任传入 uid。
 */
import {
  ApiError,
  LinkExpiredError,
  LinkInvalidError,
  NetworkError,
  ProtocolError,
} from './errors'
import { mergeRecords } from './records'
import type { WishRecord } from './records'
import type { ClockPort, GachaApiPort, StoragePort } from './ports'

/** D10:单页条数(官方接口 size 上限 20) */
export const SYNC_PAGE_SIZE = 20
/** D13:相邻请求间隔下限 */
export const SYNC_RATE_INTERVAL_MS = 500
/** D13:每完成 10 页后,下一请求前在基础间隔上额外增加的间隔 */
export const SYNC_TEN_PAGES_EXTRA_MS = 1000
/** D14:网络类失败重试次数(首次之外最多再试 3 次) */
export const SYNC_RETRY_LIMIT = 3
/** D14:相邻重试间隔 */
export const SYNC_RETRY_INTERVAL_MS = 5000

/** D10:本模块只覆写的四个分页参数(其余查询参数原样透传,不破坏 authkey) */
const OVERRIDE_KEYS: ReadonlySet<string> = new Set(['gacha_type', 'size', 'page', 'end_id'])

/**
 * D13 全局限速状态(可变):全局页计数器跨池共享,T07 syncAll 创建一个实例传给
 * 全部五池的 syncPool 调用;缺省时自建独立状态(单池调用语义不变)。
 */
export interface SyncRateState {
  /** 已成功完成的页请求数(跨池累计;0 = 尚无请求,下一请求前不等待) */
  pages: number
  /** 完成页数达到 10 的倍数后置位:下一请求前额外 +1s,清偿一次即复位 */
  extraOwed: boolean
}

/** 创建全新的全局限速状态(每次会话/编排一个) */
export function createRateState(): SyncRateState {
  return { pages: 0, extraOwed: false }
}

export interface SyncDeps {
  api: GachaApiPort
  clock: ClockPort
  storage: StoragePort
  /** D13 共享限速状态;缺省 = 本次调用独立限速 */
  rate?: SyncRateState
}

export interface SyncPoolOptions {
  /** 每页回调(已合并入库的页;终止性空页不回调):page 从 1 起,计数为本池累计 */
  onProgress?: (page: number, fetchedThisPool: number, addedThisPool: number) => void
}

export interface SyncPoolResult {
  /** 本池 gacha_type 数字(即查询传入值;条目混入的 400 等以入库条目自带值为准) */
  poolCode: number
  /** 本次拉取到的记录数(含重复行与提前停页) */
  fetched: number
  /** 合并去重后真正新增入库的记录数 */
  added: number
  /** 本次是否推进了水位(正常收尾必为 true;中断/上抛则整次不返回) */
  watermarked: boolean
}

/** 官方响应信封(字段一律按 unknown 接,形状异常按 NetworkError 语义处理) */
interface RawEnvelope {
  retcode?: unknown
  message?: unknown
  data?: unknown
}

/** 官方响应条目中本模块消费的字段(D11:全部应为字符串) */
interface RawItem {
  uid?: unknown
  gacha_type?: unknown
  time?: unknown
  name?: unknown
  lang?: unknown
  item_type?: unknown
  rank_type?: unknown
  id?: unknown
}

/** 单页校验产物条目:id 供游标/水位比较,record 供入库(响应原序,id 降序) */
interface PageEntry {
  uid: string
  id: string
  record: WishRecord
}

/**
 * 构造单池分页 URL:规范 URL 中已带的 gacha_type/size/page/end_id 一律剔除后追加
 * 本次四项,其余参数(鉴权等)按原顺序原样保留——手工拆装查询串而非 URLSearchParams,
 * 不做任何解码再编码(authkey 不可破坏,与 link.ts/probe.ts 同一纪律)。
 */
function buildSyncUrl(canonical: string, gachaType: number, page: number, endId: string): string {
  const queryAt = canonical.indexOf('?')
  const base = queryAt === -1 ? canonical : canonical.slice(0, queryAt)
  const query = queryAt === -1 ? '' : canonical.slice(queryAt + 1)
  const kept = query === ''
    ? []
    : query.split('&').filter((pair) => {
        const eq = pair.indexOf('=')
        return !OVERRIDE_KEYS.has(eq === -1 ? pair : pair.slice(0, eq))
      })
  const overrides = [
    `gacha_type=${gachaType}`,
    `size=${SYNC_PAGE_SIZE}`,
    `page=${page}`,
    `end_id=${endId}`,
  ]
  return `${base}?${[...kept, ...overrides].join('&')}`
}

/** 解析信封:非 JSON(网关异常页等)按 NetworkError 语义处理,与请求失败同受重试保护 */
function parseEnvelope(raw: string): RawEnvelope {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') return parsed as RawEnvelope
  } catch {
    // 返回体不是 JSON,按网络类失败处理
  }
  throw new NetworkError()
}

/**
 * D11 信封判定:retcode 0 → 校验 data.list 形状后返回;−101 且 message 含
 * authkey timeout → LinkExpiredError,含 authkey error → LinkInvalidError(文案区分);
 * 其余 retcode → ApiError,均不重试。信封/列表形状异常(retcode 缺失或非整数、
 * data.list 缺失或非数组)按 NetworkError 语义处理,与 probe.ts 同口径(受重试保护)。
 */
function extractList(raw: string): unknown[] {
  const envelope = parseEnvelope(raw)
  const retcode = envelope.retcode
  if (typeof retcode !== 'number' || !Number.isInteger(retcode)) throw new NetworkError()
  if (retcode === 0) {
    const data: unknown = envelope.data
    if (data === null || typeof data !== 'object') throw new NetworkError()
    const list: unknown = (data as { list?: unknown }).list
    if (!Array.isArray(list)) throw new NetworkError()
    return list
  }
  const message = typeof envelope.message === 'string' ? envelope.message : ''
  if (retcode === -101) {
    if (message.includes('authkey timeout')) throw new LinkExpiredError()
    if (message.includes('authkey error')) throw new LinkInvalidError()
  }
  throw new ApiError(retcode, message !== '' ? message : `官方接口返回 retcode ${retcode}`)
}

const RANK_TYPE_STRINGS: ReadonlySet<string> = new Set(['3', '4', '5'])

/**
 * D11 单条校验与归一:字段全为字符串;id 缺失或非纯数字、rank_type 无法归一 3/4/5、
 * time/name 为空、gacha_type 非数字字符串等脏行 → ProtocolError(带页码行号细节),
 * 禁止静默跳过。gacha_type 归一数字后保留条目自带值(400 混在 301 响应以条目为准;
 * 未知 code 不报错,照常入库,展示落「未收录」)。
 */
function toPageEntry(item: unknown, page: number, index: number): PageEntry {
  const where = `第 ${page} 页第 ${index + 1} 条`
  if (item === null || typeof item !== 'object') {
    throw new ProtocolError(undefined, `${where}:条目不是对象`)
  }
  const row = item as RawItem
  const isString = (value: unknown): value is string => typeof value === 'string'
  const uid = row.uid
  if (!isString(uid) || uid === '') throw new ProtocolError(undefined, `${where}:uid 缺失或为空`)
  const id = row.id
  if (!isString(id) || !/^\d+$/.test(id)) {
    throw new ProtocolError(undefined, `${where}:id 缺失或非纯数字`)
  }
  const rankType = row.rank_type
  if (!isString(rankType) || !RANK_TYPE_STRINGS.has(rankType)) {
    throw new ProtocolError(undefined, `${where}:rank_type 无法归一为 3/4/5`)
  }
  const time = row.time
  if (!isString(time) || time === '') throw new ProtocolError(undefined, `${where}:time 为空`)
  const name = row.name
  if (!isString(name) || name === '') throw new ProtocolError(undefined, `${where}:name 为空`)
  const gachaTypeRaw = row.gacha_type
  if (!isString(gachaTypeRaw) || !/^\d+$/.test(gachaTypeRaw)) {
    throw new ProtocolError(undefined, `${where}:gacha_type 非数字字符串`)
  }
  if (!isString(row.item_type)) throw new ProtocolError(undefined, `${where}:item_type 非字符串`)
  if (!isString(row.lang)) throw new ProtocolError(undefined, `${where}:lang 非字符串`)
  return {
    uid,
    id,
    record: {
      gachaType: Number(gachaTypeRaw),
      time,
      name,
      rankType: Number(rankType),
      id,
    },
  }
}

/** D11 整页校验:逐条归一 + 同页 uid 一致性;返回响应原序条目(id 降序) */
function validatePage(list: unknown[], page: number): PageEntry[] {
  const entries = list.map((item, index) => toPageEntry(item, page, index))
  if (entries.length === 0) return entries
  const pageUid = entries[0].uid
  for (const entry of entries) {
    if (entry.uid !== pageUid) {
      throw new ProtocolError(undefined, `第 ${page} 页内 uid 不一致:${pageUid} / ${entry.uid}`)
    }
  }
  return entries
}

/**
 * D13/D14 单页获取与校验:请求前按共享状态限速——全局首请求不等待,此后相邻请求
 * ≥0.5s,完成页数每达 10 的倍数,下一请求前额外 +1s;仅 NetworkError(含非 JSON、
 * 信封形状异常)重试最多 3 次×5s,重试间隔已满足限速下限不叠加(与 probe.ts 同口径),
 * 同一页重试成功只计一次完成页;retcode≠0 类错误发生在响应判定层,不经此重试。
 */
async function fetchPage(
  deps: SyncDeps,
  rate: SyncRateState,
  url: string,
  gachaType: number,
  page: number,
  endId: string,
): Promise<PageEntry[]> {
  if (rate.pages > 0) {
    const extra = rate.extraOwed ? SYNC_TEN_PAGES_EXTRA_MS : 0
    rate.extraOwed = false
    await deps.clock.sleep(SYNC_RATE_INTERVAL_MS + extra)
  }
  const requestUrl = buildSyncUrl(url, gachaType, page, endId)
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await deps.api.get(requestUrl)
      const entries = validatePage(extractList(raw), page) // 校验通过才算完成一页
      rate.pages += 1
      rate.extraOwed = rate.pages % 10 === 0
      return entries
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      if (attempt >= SYNC_RETRY_LIMIT) throw error
      await deps.clock.sleep(SYNC_RETRY_INTERVAL_MS)
    }
  }
}

/** BigInt 比较两个数字串 id(19 位超 Number 精度,禁用 Number 比较) */
function compareId(a: string, b: string): number {
  const left = BigInt(a)
  const right = BigInt(b)
  return left > right ? 1 : left < right ? -1 : 0
}

/**
 * D10–D15 单池拉取主流程:按 page/end_id 游标链自新向旧逐页拉取,直至空页(完整
 * 拉取)或页内命中水位(增量提前停,合并本页后停);无水位时必须拉到空页——首次
 * 同步或上次中断的池不允许提前停,否则更旧的历史会被永久挡在提前停之外(D12)。
 * 每页立即翻转升序 → loadRecords 全量既有 → mergeRecords → insertRecords +
 * updateIdentity 逐页落库,中断不丢任何已确认页。两种正常收尾(空页/提前停)都推进
 * 水位为 max(本次拉取最大 id, 既有水位),空池置 '0';中断/上抛走不到推进处,
 * 水位绝不前移。
 */
export async function syncPool(
  deps: SyncDeps,
  url: string,
  gachaType: number,
  uid: string,
  opts: SyncPoolOptions = {},
): Promise<SyncPoolResult> {
  const rate = deps.rate ?? createRateState()
  // D12:增量提前停对照「完整同步水位」;null = 该池从未正常收尾,必须拉到空页
  const watermark = await deps.storage.getWatermark(uid, gachaType)

  let page = 1
  let endId = '0'
  let maxIdSeen: string | null = null
  let fetched = 0
  let added = 0

  for (;;) {
    const entries = await fetchPage(deps, rate, url, gachaType, page, endId)
    if (entries.length === 0) break // 空页:完整拉取正常收尾

    // D12 提前停判定:页内 id 降序,任一条 ≤ 水位即本页为最后一段(等价于末条 ≤ 水位)
    const hitWatermark =
      watermark !== null && entries.some((entry) => BigInt(entry.id) <= BigInt(watermark))

    // D15 逐页落库:翻转升序 → 全量既有 → merge → insert + 身份回填
    const ascending = [...entries].reverse().map((entry) => entry.record)
    const existing = await deps.storage.loadRecords(uid)
    const merged = mergeRecords(existing, ascending)
    await deps.storage.insertRecords(uid, merged.added)
    await deps.storage.updateIdentity(merged.upgrades)

    fetched += entries.length
    added += merged.added.length
    for (const entry of entries) {
      if (maxIdSeen === null || compareId(entry.id, maxIdSeen) > 0) maxIdSeen = entry.id
    }
    opts.onProgress?.(page, fetched, added)

    if (hitWatermark) break
    endId = entries[entries.length - 1].id // 降序页末条 = 本页最小 id,作下一页游标
    page += 1
  }

  // D12:两种正常收尾都推进水位;本次最大 id 即第一页首条(降序),与既有水位取大
  let finalWatermark = maxIdSeen
  if (watermark !== null && (finalWatermark === null || compareId(watermark, finalWatermark) > 0)) {
    finalWatermark = watermark
  }
  await deps.storage.setWatermark(uid, gachaType, finalWatermark ?? '0')

  return { poolCode: gachaType, fetched, added, watermarked: true }
}
