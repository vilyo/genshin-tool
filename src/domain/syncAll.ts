/**
 * 五池编排与启动自动同步(spec 02 §6 D16):uid 守卫(守卫拉取先行确认链接归属
 * uid)→ 五池固定顺序串行拉取(共享 D13 全局限速,已覆盖池间间隔,不另设池间
 * sleep)→ 成功收尾 set_last_synced。D16 启动自动同步在编排之上包「探底 → 编排」
 * 的静默语义——任何无法静默完成的结局一律返回 false 跳过,不抛错不弹窗。
 * 外部依赖经端口注入,本模块自身零 IO,可伪造单测。
 */
import {
  ApiError,
  ArchiveMismatchError,
  EmptyHistoryError,
  LinkExpiredError,
  LinkInvalidError,
  NetworkError,
  ProtocolError,
} from './errors'
import { probeCandidates } from './probe'
import {
  SYNC_PAGE_SIZE,
  SYNC_RATE_INTERVAL_MS,
  SYNC_RETRY_INTERVAL_MS,
  SYNC_RETRY_LIMIT,
  SYNC_TEN_PAGES_EXTRA_MS,
  createRateState,
  syncPool,
} from './syncPool'
import type { SyncDeps, SyncRateState } from './syncPool'

/** §6:五池固定顺序(不单独查 400——查 301 即返回 301+400 混合记录) */
export const SYNC_ALL_POOL_CODES: readonly number[] = [301, 302, 500, 200, 100]

/** 五池编排进度(透传 syncPool 逐页回调并附池上下文;终止性空页不回调) */
export interface SyncAllProgress {
  /** 正在拉取的池在 SYNC_ALL_POOL_CODES 中的下标(0 起) */
  poolIndex: number
  /** 正在拉取的池 gacha_type */
  poolCode: number
  /** 本池页码(1 起) */
  page: number
  /** 本池累计拉取记录数 */
  fetchedThisPool: number
  /** 本池累计新增入库数 */
  addedThisPool: number
}

export interface SyncAllOptions {
  onProgress?: (progress: SyncAllProgress) => void
}

/** 单池编排明细(spec §6 返回形态;水位语义由 syncPool 保证,此处不透出水位标志) */
export interface SyncAllPoolResult {
  poolCode: number
  fetched: number
  added: number
}

export interface SyncAllResult {
  /** 各池明细(按五池顺序;任一池失败则整次不返回,错误上抛) */
  pools: SyncAllPoolResult[]
  fetched: number
  added: number
  /** 守卫确认出的链接归属 uid */
  uid: string
}

/** 守卫拉取覆写四项(与 syncPool 同一纪律:其余参数原样保留,不做解码再编码) */
const GUARD_OVERRIDE_KEYS: ReadonlySet<string> = new Set(['gacha_type', 'size', 'page', 'end_id'])

/**
 * 构造守卫拉取 URL(gacha_type=池 code,size/page/end_id 取正式拉取首页形态):
 * 规范 URL 中已带的四项剔除后追加,手工拆装查询串,不破坏 authkey。
 */
function buildGuardUrl(canonical: string, gachaType: number): string {
  const queryAt = canonical.indexOf('?')
  const base = queryAt === -1 ? canonical : canonical.slice(0, queryAt)
  const query = queryAt === -1 ? '' : canonical.slice(queryAt + 1)
  const kept = query === ''
    ? []
    : query.split('&').filter((pair) => {
        const eq = pair.indexOf('=')
        return !GUARD_OVERRIDE_KEYS.has(eq === -1 ? pair : pair.slice(0, eq))
      })
  return `${base}?${[...kept, `gacha_type=${gachaType}`, `size=${SYNC_PAGE_SIZE}`, 'page=1', 'end_id=0'].join('&')}`
}

/** 守卫响应信封(字段一律按 unknown 接,形状异常按 NetworkError 语义处理) */
interface RawEnvelope {
  retcode?: unknown
  message?: unknown
  data?: unknown
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
 * 守卫页最小信封判定(D11 同口径;syncPool 未导出 extractList,按任务单在本文件内
 * 重写最小版):retcode 0 → 返回 data.list;−101 authkey timeout → LinkExpiredError、
 * authkey error → LinkInvalidError(文案区分);其余 retcode → ApiError,均不重试;
 * 形状异常(retcode/data.list 缺失或形状不符)按 NetworkError 处理(受重试保护)。
 * 整页协议校验(D11)不在此做——正式拉取会幂等重拉同页,由 syncPool 全量校验落库。
 */
function extractGuardList(raw: string): unknown[] {
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

/**
 * 守卫单页获取:与 syncPool.fetchPage 同一限速/重试口径——请求前按共享状态限速
 * (全局首请求不等待,完成页数每达 10 的倍数下一请求前额外 +1s),守卫成功页计入
 * 全局页计数器(与正式拉取页同权);仅 NetworkError 重试最多 3 次×5s,retcode≠0
 * 类错误发生在响应判定层,不经此重试。
 */
async function guardFetchPage(
  deps: SyncDeps,
  rate: SyncRateState,
  url: string,
  gachaType: number,
): Promise<unknown[]> {
  if (rate.pages > 0) {
    const extra = rate.extraOwed ? SYNC_TEN_PAGES_EXTRA_MS : 0
    rate.extraOwed = false
    await deps.clock.sleep(SYNC_RATE_INTERVAL_MS + extra)
  }
  const requestUrl = buildGuardUrl(url, gachaType)
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await deps.api.get(requestUrl)
      const list = extractGuardList(raw)
      rate.pages += 1
      rate.extraOwed = rate.pages % 10 === 0
      return list
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      if (attempt >= SYNC_RETRY_LIMIT) throw error
      await deps.clock.sleep(SYNC_RETRY_INTERVAL_MS)
    }
  }
}

/**
 * uid 守卫(spec §6):按五池顺序发守卫页(该池第 1 页),首个非空页的 list[0].uid
 * 即链接真实 uid(一条链接恒对应一个 UID);全部为空 → EmptyHistoryError(该账号
 * 无任何记录)。守卫只取 uid、不落任何数据——正式拉取从 page=1 幂等重拉并由
 * syncPool 全量校验落库。list[0] 形状异常按 ProtocolError(确定性数据缺陷,重试
 * 无益;正式拉取同页的 D11 校验会给出同样结论)。
 */
async function resolveUid(deps: SyncDeps, rate: SyncRateState, url: string): Promise<string> {
  for (const poolCode of SYNC_ALL_POOL_CODES) {
    const list = await guardFetchPage(deps, rate, url, poolCode)
    if (list.length === 0) continue
    const first: unknown = list[0]
    if (first === null || typeof first !== 'object') {
      throw new ProtocolError(undefined, `守卫页(gacha_type=${poolCode} 第 1 页)list[0] 不是对象`)
    }
    const uid: unknown = (first as { uid?: unknown }).uid
    if (typeof uid !== 'string' || uid === '') {
      throw new ProtocolError(undefined, `守卫页(gacha_type=${poolCode} 第 1 页)list[0].uid 缺失或为空`)
    }
    return uid
  }
  throw new EmptyHistoryError()
}

/**
 * 五池编排主流程(spec §6):守卫确认 uid → 与 expectedUid 比对(不一致抛
 * ArchiveMismatchError 且不落任何数据,由 UI 确认切换档案后重入;null = 当前无
 * 档案,自动建档)→ ensureArchive 后按固定顺序串行 syncPool(五池共享同一限速
 * 状态;进度逐页透传)。任一池抛错即中止:已完成池的数据与水位语义由 syncPool
 * 保证(逐页落库、中断池水位不推进),last_synced 不写,错误上抛;五池全部正常
 * 结束才 set_last_synced(uid, 时钟注入 now 的 ISO)。
 */
export async function syncAll(
  deps: SyncDeps,
  url: string,
  expectedUid: string | null,
  opts: SyncAllOptions = {},
): Promise<SyncAllResult> {
  const rate = deps.rate ?? createRateState()
  const poolDeps: SyncDeps = { ...deps, rate } // 五池 syncPool 共享同一限速状态

  const resolvedUid = await resolveUid(poolDeps, rate, url)
  if (expectedUid !== null && expectedUid !== resolvedUid) {
    throw new ArchiveMismatchError(resolvedUid)
  }
  await deps.storage.ensureArchive(resolvedUid)

  const pools: SyncAllPoolResult[] = []
  for (const [poolIndex, poolCode] of SYNC_ALL_POOL_CODES.entries()) {
    const result = await syncPool(poolDeps, url, poolCode, resolvedUid, {
      onProgress: (page, fetchedThisPool, addedThisPool) => {
        opts.onProgress?.({ poolIndex, poolCode, page, fetchedThisPool, addedThisPool })
      },
    })
    pools.push({ poolCode: result.poolCode, fetched: result.fetched, added: result.added })
  }

  // 成功收尾(任一池失败走不到此处,last_synced 不写)
  await deps.storage.setLastSynced(resolvedUid, new Date(deps.clock.now()).toISOString())

  return {
    pools,
    fetched: pools.reduce((sum, pool) => sum + pool.fetched, 0),
    added: pools.reduce((sum, pool) => sum + pool.added, 0),
    uid: resolvedUid,
  }
}

/**
 * D16 启动时自动同步(PRD F5):对调用方传入的候选规范 URL(缓存提取与
 * canonicalize 由 UI 层完成,本函数不接触缓存文件;不存储、不复用任何 authkey)
 * 先探底验证,再对最优候选(D8 最新)走五池增量编排。任何无法静默完成的结局一律
 * 静默跳过返回 false,不抛错不打扰:无有效候选/全部过期/探底失败、多候选不同 uid
 * 需用户选择(uid=null 亦计为一方)、uid 与当前档案不一致、空历史、网络失败——
 * 这些都需要交互或报错,静默场景下无权替用户决定,留待手动一键获取处理。成功完成
 * → 增量入库 + last_synced 更新,返回 true。
 */
export async function autoSyncOnStartup(
  deps: SyncDeps,
  urls: readonly string[],
  currentUid: string | null,
): Promise<boolean> {
  try {
    const probe = await probeCandidates(deps.api, deps.clock, [...urls])
    // 无有效候选(含全部过期/全部不可达)→ 静默跳过
    if (probe.candidates.length === 0) return false
    // 多候选不同 uid 需用户选择 → 静默跳过(D8 已按 uid 去重,此处数 distinct 即可)
    if (new Set(probe.candidates.map((candidate) => candidate.uid)).size >= 2) return false
    await syncAll(deps, probe.candidates[0].url, currentUid)
    return true
  } catch {
    // ArchiveMismatch/EmptyHistory/网络失败等一切错误:静默场景一律跳过(D16)
    return false
  }
}
