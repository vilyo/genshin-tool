/**
 * 候选链接探底验证与多 UID 整理(spec 02 §4 D6–D9)。
 * 对规范 API URL(link.canonicalize 产物)逐条发一次探底请求,以 retcode 判定链接
 * 有效性、以 list[0].uid 归属档案、以响应内最大 id(19 位数字串,BigInt 比较)排定
 * 数据新旧;全部外部依赖经 GachaApiPort/ClockPort 注入,本模块自身零 IO,可伪造单测。
 */
import { ApiError, NetworkError } from './errors'
import type { ClockPort, GachaApiPort } from './ports'

/** D14:网络类失败重试次数(首次之外最多再试 3 次) */
export const PROBE_RETRY_LIMIT = 3
/** D14:相邻重试间隔 */
export const PROBE_RETRY_INTERVAL_MS = 5000
/** D13:相邻探底请求间隔下限(首页请求前不等待) */
export const PROBE_RATE_INTERVAL_MS = 500

/** 一条有效候选(D9 输出):uid 为 null 表示探底列表为空,UI 注明「UID 拉取后确认」 */
export interface ProbeCandidate {
  /** 规范 API URL(原样回传,用户选定后据此进入五池拉取) */
  url: string
  /** 探底响应 list[0].uid(D7);列表为空时为 null */
  uid: string | null
  /** 探底响应内最大 id(D8 数据新旧信号);列表为空时为 null */
  latestId: string | null
  /** 最大 id 条目的 time(UI 展示「探底最新记录时间」);列表为空时为 null */
  latestTime: string | null
}

/** D9 探底结果:有效候选按 D8 序;全部失败时由 UI 将 error 按错误分类上抛展示 */
export interface ProbeResult {
  /** 有效候选(D8:按探底最大 id 降序,同 uid 只留最大 id 者);全部失败时为空 */
  candidates: ProbeCandidate[]
  /** 全部候选均被 retcode=-101 淘汰(S7 过期文案走此分支) */
  allExpired: boolean
  /** 全部候选失败(retcode≠0 / 网络不可达)时的最后一个错误;存在有效候选或全部 -101 时缺省 */
  error?: Error
}

/** 探底响应信封(字段一律按 unknown 接,形状异常按 NetworkError 语义处理) */
interface RawEnvelope {
  retcode?: unknown
  message?: unknown
  data?: unknown
}

/** 探底响应条目中本模块所需字段(其余字段属 D11 整页协议校验,归 syncPool,此处不碰) */
interface RawItem {
  uid?: unknown
  time?: unknown
  id?: unknown
}

/** 单候选解析载荷(空列表三项皆 null,即「uid 待拉取确认」) */
interface ProbePayload {
  uid: string | null
  latestId: string | null
  latestTime: string | null
}

/** D6 探底四项参数:在规范 URL 上一律覆写(end_id=0 为 §5 D10 首页形态) */
const PROBE_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['gacha_type', '301'],
  ['page', '1'],
  ['size', '6'],
  ['end_id', '0'],
]
const PROBE_OVERRIDE_KEYS: ReadonlySet<string> = new Set(PROBE_OVERRIDES.map(([key]) => key))

/**
 * 构造探底 URL:规范 URL 中已带的 gacha_type/page/size/end_id 一律剔除后追加探底四项,
 * 其余参数(鉴权等)按原顺序原样保留——手工拆装查询串而非 URLSearchParams,
 * 不做任何解码再编码(authkey 不可破坏,与 link.ts 同一纪律)。
 */
function buildProbeUrl(canonical: string): string {
  const queryAt = canonical.indexOf('?')
  const base = queryAt === -1 ? canonical : canonical.slice(0, queryAt)
  const query = queryAt === -1 ? '' : canonical.slice(queryAt + 1)
  const kept = query === ''
    ? []
    : query.split('&').filter((pair) => {
        const eq = pair.indexOf('=')
        return !PROBE_OVERRIDE_KEYS.has(eq === -1 ? pair : pair.slice(0, eq))
      })
  const overrides = PROBE_OVERRIDES.map(([key, value]) => `${key}=${value}`)
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
 * D6/D7 单次响应判定:retcode 0 → 校验并解析 data.list;−101 → 过期候选淘汰
 * (authkey timeout / authkey error 两种 message 形态同判,不报错);其余 retcode →
 * ApiError(retcode≠0 永不重试,D11/D14)。形状异常(retcode/data.list 缺失、条目 id
 * 缺失或非纯数字、list[0].uid 或最新条目 time 为空)一律按 NetworkError 语义处理
 * (该候选不可达,受重试保护)——探底只做自身所需字段的最小校验,D11 的整页协议
 * 校验属 syncPool 职责。
 */
function classifyResponse(raw: string): ProbePayload | 'expired' {
  const envelope = parseEnvelope(raw)
  const retcode = envelope.retcode
  if (typeof retcode !== 'number' || !Number.isInteger(retcode)) throw new NetworkError()
  if (retcode === -101) return 'expired'
  if (retcode !== 0) {
    throw new ApiError(
      retcode,
      typeof envelope.message === 'string' && envelope.message !== ''
        ? envelope.message
        : `官方接口返回 retcode ${retcode}`,
    )
  }

  const data: unknown = envelope.data
  if (data === null || typeof data !== 'object') throw new NetworkError()
  const list: unknown = (data as { list?: unknown }).list
  if (!Array.isArray(list)) throw new NetworkError()

  // D8 基准:探底响应内最大 id(id 为 19 位数字串,超出安全整数,一律 BigInt 比较)
  let maxItem: RawItem | null = null
  let maxId: string | null = null
  for (const item of list) {
    if (item === null || typeof item !== 'object') throw new NetworkError()
    const record = item as RawItem
    const id = record.id
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new NetworkError()
    if (maxId === null || BigInt(id) > BigInt(maxId)) {
      maxId = id
      maxItem = record
    }
  }
  if (maxItem === null || maxId === null) {
    return { uid: null, latestId: null, latestTime: null } // 探底列表为空(纯新号等)
  }

  // D7:list[0].uid 即该链接归属 UID(一条链接恒对应一个 UID)
  const uid = (list[0] as RawItem).uid
  if (typeof uid !== 'string' || uid === '') throw new NetworkError()
  const time = maxItem.time
  if (typeof time !== 'string' || time === '') throw new NetworkError()
  return { uid, latestId: maxId, latestTime: time }
}

/** 探底最大 id 降序比较(null = 空列表,殿后);id 为数字串,一律 BigInt 比较 */
function compareLatestId(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const left = BigInt(a)
  const right = BigInt(b)
  return left > right ? 1 : left < right ? -1 : 0
}

/** D8 整理:同 uid 只留探底最大 id 者(uid=null 不参与去重),再按最大 id 降序 */
function rankCandidates(valid: ProbeCandidate[]): ProbeCandidate[] {
  const byUid = new Map<string, ProbeCandidate>()
  const anonymous: ProbeCandidate[] = []
  for (const candidate of valid) {
    if (candidate.uid === null) {
      anonymous.push(candidate)
      continue
    }
    const kept = byUid.get(candidate.uid)
    if (kept === undefined || compareLatestId(candidate.latestId, kept.latestId) > 0) {
      byUid.set(candidate.uid, candidate)
    }
  }
  return [...byUid.values(), ...anonymous].sort((a, b) => compareLatestId(b.latestId, a.latestId))
}

/**
 * D6–D9 探底主流程:逐候选发一次探底请求,整理有效候选。候选分流(含探底语义裁决):
 * - retcode==0 → 有效候选;
 * - retcode==-101(authkey timeout / authkey error 两种形态)→ 候选淘汰,不报错;
 * - 其余 retcode → ApiError。spec D6 原文只对网络错误明确了「继续下一候选」语义;
 *   探底场景将 ApiError 同样按「候选淘汰、继续下一候选」处理(探底是挑选可用链接,
 *   单个候选的确定性失败不应中止其余候选的验证),全部候选失败才把最后一个错误放进
 *   ProbeResult.error 交 UI 上抛;
 * - 网络错误(含解析失败,按 NetworkError 语义)按 D14 重试最多 3 次×5s,仍败 →
 *   该候选标记不可达,继续下一候选;全部不可达才把最后的 NetworkError 交出去。
 * 存在任一有效候选时,失败候选的错误一律丢弃(D6:继续下一候选)。
 *
 * D13 限速:相邻请求间隔 ≥0.5s(首个请求前不等待;5s 重试间隔已满足下限,不叠加)。
 * urls 为空直接返回空结果,不发任何请求。
 */
export async function probeCandidates(
  api: GachaApiPort,
  clock: ClockPort,
  urls: string[],
): Promise<ProbeResult> {
  if (urls.length === 0) return { candidates: [], allExpired: false }

  const valid: ProbeCandidate[] = []
  let expiredCount = 0
  let lastError: Error | null = null
  /** D13 欠账:上一请求之后尚未拉开 ≥0.5s 间隔(任何一次 sleep 都满足下限,故清欠) */
  let gapOwed = false

  /** 单候选探底:有效返回解析载荷;-101 返回 'expired';候选级失败上抛最后错误 */
  const probeOnce = async (url: string): Promise<ProbePayload | 'expired'> => {
    for (let attempt = 0; ; attempt++) {
      if (gapOwed) {
        await clock.sleep(PROBE_RATE_INTERVAL_MS)
        gapOwed = false
      }
      try {
        const raw = await api.get(buildProbeUrl(url))
        gapOwed = true
        return classifyResponse(raw)
      } catch (error) {
        gapOwed = true
        // ApiError 等 retcode 类错误不重试(D11/D14),上抛交外层记为该候选失败
        if (!(error instanceof NetworkError)) throw error
        if (attempt >= PROBE_RETRY_LIMIT) throw error
        await clock.sleep(PROBE_RETRY_INTERVAL_MS) // D14 重试间隔,同时满足 D13 下限
        gapOwed = false
      }
    }
  }

  for (const url of urls) {
    try {
      const outcome = await probeOnce(url)
      if (outcome === 'expired') {
        expiredCount++
        continue
      }
      valid.push({
        url,
        uid: outcome.uid,
        latestId: outcome.latestId,
        latestTime: outcome.latestTime,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (valid.length > 0) return { candidates: rankCandidates(valid), allExpired: false }
  if (expiredCount === urls.length) return { candidates: [], allExpired: true }
  return { candidates: [], allExpired: false, error: lastError ?? new NetworkError() }
}
