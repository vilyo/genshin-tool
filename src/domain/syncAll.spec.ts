import { describe, expect, it } from 'vitest'
import {
  ApiError,
  ArchiveMismatchError,
  EmptyHistoryError,
  LinkExpiredError,
  LinkInvalidError,
  NetworkError,
} from './errors'
import { poolCategory } from './pools'
import type { ClockPort, GachaApiPort, IdentityUpdate, StoragePort } from './ports'
import type { StoredRecord, WishRecord } from './records'
import { SYNC_RATE_INTERVAL_MS } from './syncPool'
import type { SyncDeps } from './syncPool'
import { SYNC_ALL_POOL_CODES, autoSyncOnStartup, syncAll } from './syncAll'
import type { SyncAllProgress } from './syncAll'

// ---- 常量与数据构造(与 syncPool.spec 同一口径,按任务单在本地重建) ----

/** 规范 API URL(link.canonicalize 产物形态:域名已重建、lang=zh-cn、authkey URL-encoded) */
const URL_CN = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&sign_type=2&lang=zh-cn&region=cn_gf01' +
  '&game_biz=hk4e_cn&authkey=Ab%2Bcd'
/** 多候选场景的候选规范 URL(仅 authkey 参数不同) */
const URL_A = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?lang=zh-cn&game_biz=hk4e_cn&authkey=AAA'
const URL_B = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?lang=zh-cn&game_biz=hk4e_cn&authkey=BBB'

const UID = '100000001'
const OTHER_UID = '200000002'
/** 假时钟固定 epoch 与对应 ISO(set_last_synced 断言基准) */
const NOW = 1760000000000
const NOW_ISO = '2025-10-09T08:53:20.000Z'

/** 19 位数字串 id(数值随 n 递增;字符串拼接避开 Number 精度) */
const idAt = (n: number): string => `170000000000000${1000 + n}`

// F10 数据集:301 池 3 条 > 302 池 3 条,全局单调
const A3 = idAt(6)
const A2 = idAt(5)
const A1 = idAt(4)
const B2 = idAt(3)
const B1 = idAt(2)
const B0 = idAt(1)

/** 官方条目(字段全为字符串) */
function rawItem(id: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    uid: UID,
    gacha_type: '301',
    time: '2026-10-01 12:00:00',
    name: `刻晴${id.slice(-3)}`,
    item_type: '角色',
    rank_type: '5',
    id,
    lang: 'zh-cn',
    ...overrides,
  }
}

/** retcode 0 的一页(list 原样,空数组 = 终止性空页) */
const okPage = (items: readonly unknown[]): string =>
  JSON.stringify({ retcode: 0, message: 'OK', data: { list: items } })

/** 按降序 id 生成指定池的一页合法响应 */
const pageOfCode = (code: number, ...ids: string[]): string =>
  okPage(ids.map((id) => rawItem(id, { gacha_type: String(code) })))

/** 其余 retcode ≠ 0(D11 归 ApiError) */
const failPage = (retcode: number, message: string): string => JSON.stringify({ retcode, message })

/** 探底响应(单条,供 probe 提取 uid/最大 id/time) */
const probeOk = (uid: string, id: string): string => okPage([rawItem(id, { uid })])

interface FakeRequest {
  url: string
  gachaType: number
  page: number
  size: number
}

/**
 * 路由式假接口:按 `${gacha_type}:${page}` 键给出依序消费的响应脚本(字符串 = 返回体,
 * Error = 抛出)。守卫页与正式拉取的第 1 页命中同一键,同键多次请求逐份消费——与
 * 「守卫确认后从 page=1 幂等重拉」的真实语义一致;同键请求次序 = 探底(如有)→ 守卫
 * → 正式逐页。
 */
function fakeApi(script: Record<string, Array<string | Error>>) {
  const queues = new Map<string, Array<string | Error>>(Object.entries(script))
  const requests: FakeRequest[] = []
  const api: GachaApiPort = {
    async get(url) {
      const params = new Map<string, string>()
      const query = url.slice(url.indexOf('?') + 1)
      for (const pair of query.split('&')) {
        const eq = pair.indexOf('=')
        params.set(eq === -1 ? pair : pair.slice(0, eq), eq === -1 ? '' : pair.slice(eq + 1))
      }
      const req: FakeRequest = {
        url,
        gachaType: Number(params.get('gacha_type')),
        page: Number(params.get('page')),
        size: Number(params.get('size')),
      }
      requests.push(req)
      const outcome = queues.get(`${req.gachaType}:${req.page}`)?.shift()
      if (outcome === undefined) {
        throw new Error(
          `假接口脚本已耗尽:gacha_type=${req.gachaType} 第 ${req.page} 页(第 ${requests.length} 次请求)`,
        )
      }
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
  return { api, requests }
}

/** 假时钟:sleep 只记录不等待;now 固定 */
function fakeClock() {
  const sleeps: number[] = []
  const clock: ClockPort = {
    now: () => NOW,
    async sleep(ms) {
      sleeps.push(ms)
    },
  }
  return { clock, sleeps }
}

/** 假存储:内存单 uid 库,记录全部写入调用(守卫失败路径的「零写入」断言用) */
function fakeStorage(seed: WishRecord[] = []) {
  const db: StoredRecord[] = []
  const watermarks = new Map<string, string>()
  const lastSynced: Array<{ uid: string; iso: string }> = []
  const ensuredUids: string[] = []
  const insertedBatches: Array<{ uid: string; rows: WishRecord[] }> = []
  const identityUpdates: IdentityUpdate[] = []
  const setWatermarkCalls: Array<{ uid: string; gachaType: number; id: string }> = []
  let nextRowid = 1
  const push = (record: WishRecord): StoredRecord => {
    const key = [
      poolCategory(record.gachaType),
      record.time,
      record.name,
      record.rankType,
    ].join('|')
    const seq = (mult.get(key) ?? 0)
    mult.set(key, seq + 1)
    const row: StoredRecord = { ...record, seq, rowid: nextRowid }
    nextRowid += 1
    db.push(row)
    return row
  }
  const mult = new Map<string, number>()
  for (const record of seed) push(record)
  const storage: StoragePort = {
    async loadRecords() {
      return db
    },
    async insertRecords(uid, rows) {
      insertedBatches.push({ uid, rows: [...rows] })
      for (const row of rows) push(row)
      return rows.length
    },
    async updateIdentity(updates) {
      identityUpdates.push(...updates)
      for (const update of updates) {
        const row = db.find((candidate) => candidate.rowid === update.rowid)
        if (!row) continue
        row.id = update.id
        if (update.gachaType !== undefined) row.gachaType = update.gachaType
      }
      return updates.length
    },
    async getWatermark(uid, gachaType) {
      return watermarks.get(`${uid}:${gachaType}`) ?? null
    },
    async setWatermark(uid, gachaType, id) {
      setWatermarkCalls.push({ uid, gachaType, id })
      watermarks.set(`${uid}:${gachaType}`, id)
    },
    async setLastSynced(uid, iso) {
      lastSynced.push({ uid, iso })
    },
    // 单 uid 假库:整库清空即该档案清空(spec 01 E16:记录+水位+last_synced 同清)
    async clearArchive() {
      const removed = db.length
      db.length = 0
      watermarks.clear()
      lastSynced.length = 0
      return removed
    },
    async listArchives() {
      throw new Error('syncAll 测试未用到 listArchives')
    },
    async ensureArchive(uid) {
      ensuredUids.push(uid)
    },
    async migrateArchive() {
      throw new Error('syncAll 测试未用到 migrateArchive')
    },
  }
  return { storage, db, watermarks, lastSynced, ensuredUids, insertedBatches, identityUpdates, setWatermarkCalls }
}

function makeDeps(api: GachaApiPort, store: ReturnType<typeof fakeStorage>, clock: ClockPort): SyncDeps {
  return { api, clock, storage: store.storage }
}

/** 标准五池脚本:每池第 1 页 1 条(id 全局递增)、第 2 页空页;首池键含守卫+重拉两份 */
function standardFivePoolsScript(): Record<string, Array<string | Error>> {
  const script: Record<string, Array<string | Error>> = {}
  let n = 0
  for (const code of SYNC_ALL_POOL_CODES) {
    n += 1
    const page1: Array<string | Error> = [pageOfCode(code, idAt(n))]
    script[`${code}:1`] = code === SYNC_ALL_POOL_CODES[0] ? [...page1, ...page1] : page1
    script[`${code}:2`] = [okPage([])]
  }
  return script
}

/** 完整五池 F10 脚本(301 三条/302 三条/其余空池),301 键含守卫+重拉两份 */
function fullF10Script(): Record<string, Array<string | Error>> {
  return {
    '301:1': [pageOfCode(301, A3, A2), pageOfCode(301, A3, A2)],
    '301:2': [pageOfCode(301, A1)],
    '301:3': [okPage([])],
    '302:1': [pageOfCode(302, B2, B1)],
    '302:2': [pageOfCode(302, B0)],
    '302:3': [okPage([])],
    '500:1': [okPage([])],
    '200:1': [okPage([])],
    '100:1': [okPage([])],
  }
}

describe('syncAll(五池编排,spec 02 §6/§9 F8/F9/F13)', () => {
  it('F8:五池固定顺序 [301,302,500,200,100] 串行;守卫页后正式拉取从 301 page=1 重开', async () => {
    const fake = fakeApi(standardFivePoolsScript())
    const store = fakeStorage()
    const { clock } = fakeClock()

    const result = await syncAll(makeDeps(fake.api, store, clock), URL_CN, null)

    expect(fake.requests.map((req) => [req.gachaType, req.page, req.size])).toEqual([
      [301, 1, 20], // 守卫页(仅此一次:301 非空即确认 uid)
      [301, 1, 20], // 正式拉取从 page=1 幂等重开
      [301, 2, 20],
      [302, 1, 20],
      [302, 2, 20],
      [500, 1, 20],
      [500, 2, 20],
      [200, 1, 20],
      [200, 2, 20],
      [100, 1, 20],
      [100, 2, 20],
    ])
    expect(result.pools.map((pool) => pool.poolCode)).toEqual([301, 302, 500, 200, 100])
    expect(result.pools.map((pool) => [pool.fetched, pool.added])).toEqual(
      SYNC_ALL_POOL_CODES.map(() => [1, 1]),
    )
    expect(result.fetched).toBe(5)
    expect(result.added).toBe(5)
    expect(result.uid).toBe(UID)
  })

  it('F8:进度回调按 poolIndex/poolCode 递进,逐页透传 syncPool 计数(终止性空页不回调)', async () => {
    const fake = fakeApi(standardFivePoolsScript())
    const store = fakeStorage()
    const { clock } = fakeClock()
    const events: SyncAllProgress[] = []

    await syncAll(makeDeps(fake.api, store, clock), URL_CN, null, {
      onProgress: (event) => events.push({ ...event }),
    })

    expect(events).toEqual([
      { poolIndex: 0, poolCode: 301, page: 1, fetchedThisPool: 1, addedThisPool: 1 },
      { poolIndex: 1, poolCode: 302, page: 1, fetchedThisPool: 1, addedThisPool: 1 },
      { poolIndex: 2, poolCode: 500, page: 1, fetchedThisPool: 1, addedThisPool: 1 },
      { poolIndex: 3, poolCode: 200, page: 1, fetchedThisPool: 1, addedThisPool: 1 },
      { poolIndex: 4, poolCode: 100, page: 1, fetchedThisPool: 1, addedThisPool: 1 },
    ])
  })

  it('F8/收尾:成功后 ensureArchive(uid) 且 set_last_synced(uid, 时钟注入 now 的 ISO);任一池失败不写', async () => {
    const ok = fakeApi(standardFivePoolsScript())
    const okStore = fakeStorage()
    const okResult = await syncAll(makeDeps(ok.api, okStore, fakeClock().clock), URL_CN, UID)
    expect(okStore.ensuredUids).toEqual([UID])
    expect(okStore.lastSynced).toEqual([{ uid: UID, iso: NOW_ISO }])
    expect(okResult.uid).toBe(UID)

    const boom = fakeApi({
      '301:1': [pageOfCode(301, A3), pageOfCode(301, A3)],
      '301:2': [okPage([])],
      '302:1': [failPage(-5, '系统繁忙')],
    })
    const boomStore = fakeStorage()
    const error = await syncAll(makeDeps(boom.api, boomStore, fakeClock().clock), URL_CN, UID)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(boomStore.lastSynced).toEqual([])
    // 已完成池(301)数据保留、水位已推进;失败池(302)零落库零水位
    expect(boomStore.db.map((row) => row.id)).toEqual([A3])
    expect(boomStore.watermarks.get(`${UID}:301`)).toBe(A3)
    expect(boomStore.watermarks.get(`${UID}:302`)).toBeUndefined()
  })

  it('F8:中途 LinkExpiredError 即止 —— 后续池不再请求,已完成池保留且水位已推进、中断池零水位', async () => {
    const fake = fakeApi({
      '301:1': [pageOfCode(301, A3, A2), pageOfCode(301, A3, A2)],
      '301:2': [pageOfCode(301, A1)],
      '301:3': [okPage([])],
      '302:1': [pageOfCode(302, B2)],
      '302:2': [failPage(-101, 'authkey timeout')], // 过期不重试,即止
    })
    const store = fakeStorage()
    const { clock } = fakeClock()

    const error = await syncAll(makeDeps(fake.api, store, clock), URL_CN, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(LinkExpiredError)
    // 守卫 1 页 + 301 正式 3 页 + 302 第 1 页;500/200/100 未发任何请求
    expect(fake.requests.map((req) => req.gachaType)).toEqual([301, 301, 301, 301, 302, 302])
    // 逐页落库的既得利益:301 全部两页 + 302 第 1 页保留
    expect(store.db.map((row) => row.id).sort()).toEqual([A1, A2, A3, B2].sort())
    // 完成池水位已推进、中断池水位未推进(下次同步该池全量重拉)
    expect(store.watermarks.get(`${UID}:301`)).toBe(A3)
    expect(store.watermarks.get(`${UID}:302`)).toBeUndefined()
    expect(store.lastSynced).toEqual([])
  })

  it('F9:同一档案二次同步 added=0,每池仅重拉第 1 页即水位提前停', async () => {
    const store = fakeStorage()
    await syncAll(makeDeps(fakeApi(standardFivePoolsScript()).api, store, fakeClock().clock), URL_CN, UID)

    const second = fakeApi(standardFivePoolsScript())
    const result = await syncAll(makeDeps(second.api, store, fakeClock().clock), URL_CN, UID)

    expect(result.added).toBe(0)
    expect(result.fetched).toBe(5)
    expect(second.requests).toHaveLength(1 + SYNC_ALL_POOL_CODES.length) // 守卫 + 每池 1 页
    expect(store.db).toHaveLength(5)
  })

  it('F13 编排级:清空档案后 syncAll 无水位全量拉齐、档案重建完整;不清空时增量仅拉新页', async () => {
    const store = fakeStorage()
    await syncAll(makeDeps(fakeApi(standardFivePoolsScript()).api, store, fakeClock().clock), URL_CN, UID)
    const idsBefore = store.db.map((row) => row.id).sort()
    expect(store.db).toHaveLength(5)
    expect(store.watermarks.size).toBe(5)

    // 不清空:增量同步每池仅第 1 页(对照水位提前停)
    const incremental = fakeApi(standardFivePoolsScript())
    const incResult = await syncAll(makeDeps(incremental.api, store, fakeClock().clock), URL_CN, UID)
    expect(incResult.added).toBe(0)
    expect(incremental.requests).toHaveLength(1 + SYNC_ALL_POOL_CODES.length)

    // 清空档案(记录+水位+last_synced 同清)→ 无水位、全量拉齐
    expect(await store.storage.clearArchive(UID)).toBe(5)
    expect(store.db).toHaveLength(0)
    expect(store.watermarks.size).toBe(0)
    const rebuilt = fakeApi(standardFivePoolsScript())
    const rebuildResult = await syncAll(makeDeps(rebuilt.api, store, fakeClock().clock), URL_CN, UID)
    expect(rebuildResult.added).toBe(5)
    expect(rebuildResult.fetched).toBe(5)
    expect(store.db.map((row) => row.id).sort()).toEqual(idsBefore)
    expect(store.watermarks.size).toBe(5)
    // 无水位 → 每池拉到空页(守卫 1 + 每池 2 页)
    expect(rebuilt.requests).toHaveLength(1 + SYNC_ALL_POOL_CODES.length * 2)
  })
})

describe('syncAll(uid 守卫,spec 02 §6)', () => {
  it('expectedUid 不一致 → ArchiveMismatchError(resolvedUid)且零落库、不建档(记录随确认动作落库)', async () => {
    const fake = fakeApi({ '301:1': [pageOfCode(301, A3)] })
    const store = fakeStorage()

    const error = await syncAll(makeDeps(fake.api, store, fakeClock().clock), URL_CN, OTHER_UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ArchiveMismatchError)
    expect((error as ArchiveMismatchError).resolvedUid).toBe(UID)
    expect(fake.requests).toHaveLength(1) // 守卫即判,不进入正式拉取
    expect(store.insertedBatches).toEqual([]) // insertRecords 零调用
    expect(store.ensuredUids).toEqual([])
    expect(store.setWatermarkCalls).toEqual([])
    expect(store.lastSynced).toEqual([])
  })

  it('expectedUid=null → 以守卫确认的 uid 自动建档并完成五池拉取', async () => {
    const fake = fakeApi(standardFivePoolsScript())
    const store = fakeStorage()

    const result = await syncAll(makeDeps(fake.api, store, fakeClock().clock), URL_CN, null)

    expect(store.ensuredUids).toEqual([UID])
    expect(result.uid).toBe(UID)
    expect(result.added).toBe(5)
  })

  it('守卫页逐池探底(301→302→500 命中即止),正式拉取仍从 301 page=1 重开', async () => {
    const fake = fakeApi({
      '301:1': [okPage([]), okPage([])], // 守卫空 + 正式空
      '302:1': [okPage([]), okPage([])], // 守卫空 + 正式空
      '500:1': [pageOfCode(500, idAt(9)), pageOfCode(500, idAt(9))], // 守卫命中 + 正式重拉
      '500:2': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const store = fakeStorage()

    const result = await syncAll(makeDeps(fake.api, store, fakeClock().clock), URL_CN, null)

    expect(fake.requests.map((req) => [req.gachaType, req.page])).toEqual([
      [301, 1], // 守卫:301 空
      [302, 1], // 守卫:302 空
      [500, 1], // 守卫:500 非空,uid 确认
      [301, 1], // 正式拉取按五池顺序从 301 重开
      [302, 1],
      [500, 1],
      [500, 2],
      [200, 1],
      [100, 1],
    ])
    expect(result.uid).toBe(UID)
    expect(result.pools.map((pool) => pool.poolCode)).toEqual([301, 302, 500, 200, 100])
  })

  it('五池守卫页全空 → EmptyHistoryError,零落库零建档', async () => {
    const fake = fakeApi({
      '301:1': [okPage([])],
      '302:1': [okPage([])],
      '500:1': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const store = fakeStorage()

    const error = await syncAll(makeDeps(fake.api, store, fakeClock().clock), URL_CN, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(EmptyHistoryError)
    expect(fake.requests).toHaveLength(5) // 五池各一次守卫
    expect(store.insertedBatches).toEqual([])
    expect(store.ensuredUids).toEqual([])
    expect(store.lastSynced).toEqual([])
  })

  it('守卫页 retcode −101 在守卫即可判定(timeout → 过期 / error → 无效),其余 retcode → ApiError,均零落库', async () => {
    const expired = fakeApi({ '301:1': [failPage(-101, 'authkey timeout')] })
    const expiredStore = fakeStorage()
    const expiredError = await syncAll(
      makeDeps(expired.api, expiredStore, fakeClock().clock), URL_CN, UID,
    ).catch((caught: unknown) => caught)
    expect(expiredError).toBeInstanceOf(LinkExpiredError)
    expect(expired.requests).toHaveLength(1) // retcode 类错误不重试
    expect(expiredStore.insertedBatches).toEqual([])

    const invalid = fakeApi({ '301:1': [failPage(-101, 'authkey error')] })
    const invalidError = await syncAll(
      makeDeps(invalid.api, fakeStorage(), fakeClock().clock), URL_CN, UID,
    ).catch((caught: unknown) => caught)
    expect(invalidError).toBeInstanceOf(LinkInvalidError)

    const other = fakeApi({ '301:1': [failPage(-5, '系统繁忙')] })
    const otherError = await syncAll(
      makeDeps(other.api, fakeStorage(), fakeClock().clock), URL_CN, UID,
    ).catch((caught: unknown) => caught)
    expect(otherError).toBeInstanceOf(ApiError)
    expect((otherError as ApiError).retcode).toBe(-5)
  })

  it('D13:守卫页计入全局限速状态 —— 正式拉取首个请求前照常等待 0.5s', async () => {
    const fake = fakeApi({
      '301:1': [pageOfCode(301, A3), pageOfCode(301, A3)],
      '301:2': [okPage([])],
      '302:1': [okPage([])],
      '500:1': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    await syncAll(makeDeps(fake.api, store, clock), URL_CN, UID)

    // 7 次请求(守卫 1 + 301 两页 + 其余四池各 1 空页);守卫页不等待,
    // 其后每请求前 0.5s —— 若守卫页未计入全局计数器,正式首页前将无等待
    expect(fake.requests).toHaveLength(7)
    expect(sleeps).toEqual(Array.from({ length: 6 }, () => SYNC_RATE_INTERVAL_MS))
  })
})

describe('syncAll(F10 中断恢复回归 BLOCKER)', () => {
  it('首次同步 302 第 2 页断网耗尽 → 已入库页保留、该池无水位;二次同步该池全量拉齐与一次完整拉取一致;完整后再同步仅拉新页', async () => {
    // 对照组:一次性完整拉取
    const controlApi = fakeApi(fullF10Script())
    const controlStore = fakeStorage()
    const control = await syncAll(
      makeDeps(controlApi.api, controlStore, fakeClock().clock), URL_CN, UID,
    )
    expect(control.added).toBe(6)
    const controlIds = controlStore.db.map((row) => row.id).sort()

    // 首次同步:301 完整收尾,302 第 2 页断网(1 + 3 次重试耗尽)
    const first = fakeApi({
      '301:1': [pageOfCode(301, A3, A2), pageOfCode(301, A3, A2)],
      '301:2': [pageOfCode(301, A1)],
      '301:3': [okPage([])],
      '302:1': [pageOfCode(302, B2, B1)],
      '302:2': [new NetworkError('断网'), new NetworkError('断网'), new NetworkError('断网'), new NetworkError('断网')],
    })
    const store = fakeStorage()
    const firstError = await syncAll(
      makeDeps(first.api, store, fakeClock().clock), URL_CN, UID,
    ).catch((caught: unknown) => caught)
    expect(firstError).toBeInstanceOf(NetworkError)
    expect(first.requests.filter((req) => req.gachaType === 302)).toHaveLength(5) // 第 1 页 + 第 2 页 ×4
    // 已入库页保留(301 全部 + 302 第 1 页),B0 丢失;302 无水位
    expect(store.db.map((row) => row.id).sort()).toEqual([A1, A2, A3, B1, B2].sort())
    expect(store.watermarks.get(`${UID}:301`)).toBe(A3)
    expect(store.watermarks.get(`${UID}:302`)).toBeUndefined()
    expect(store.lastSynced).toEqual([])

    // 二次同步:302 无水位 → 全量拉齐(补回 B0);301 对照水位提前停
    const second = fakeApi({
      '301:1': [pageOfCode(301, A3, A2), pageOfCode(301, A3, A2)],
      '302:1': [pageOfCode(302, B2, B1)],
      '302:2': [pageOfCode(302, B0)],
      '302:3': [okPage([])],
      '500:1': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const secondResult = await syncAll(makeDeps(second.api, store, fakeClock().clock), URL_CN, UID)
    expect(secondResult.added).toBe(1) // 仅补回 B0
    expect(secondResult.fetched).toBe(2 + 3) // 301 提前停 1 页 2 条;302 全量 3 条
    expect(store.db.map((row) => row.id).sort()).toEqual(controlIds) // 总行数与一次性完整拉取一致
    expect(store.watermarks.get(`${UID}:302`)).toBe(B2)
    expect(store.lastSynced).toEqual([{ uid: UID, iso: NOW_ISO }])

    // 完整同步后再次同步:每池仅拉第 1 页(提前停),added=0
    const third = fakeApi({
      '301:1': [pageOfCode(301, A3, A2), pageOfCode(301, A3, A2)],
      '302:1': [pageOfCode(302, B2, B1)],
      '500:1': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const thirdResult = await syncAll(makeDeps(third.api, store, fakeClock().clock), URL_CN, UID)
    expect(thirdResult.added).toBe(0)
    expect(thirdResult.fetched).toBe(4) // 301 2 条 + 302 2 条,各 1 页提前停
    expect(third.requests).toHaveLength(6) // 守卫 + 每池 1 页
  })
})

describe('autoSyncOnStartup(D16 启动自动同步静默语义,spec §9 F11)', () => {
  it('urls 为空 → 静默跳过 false,零请求零写入', async () => {
    const fake = fakeApi({})
    const store = fakeStorage()

    const outcome = await autoSyncOnStartup(makeDeps(fake.api, store, fakeClock().clock), [], UID)

    expect(outcome).toBe(false)
    expect(fake.requests).toHaveLength(0)
    expect(store.insertedBatches).toEqual([])
    expect(store.ensuredUids).toEqual([])
  })

  it('全部候选过期(allExpired)→ false 零写入', async () => {
    const fake = fakeApi({ '301:1': [failPage(-101, 'authkey timeout')] })
    const store = fakeStorage()

    const outcome = await autoSyncOnStartup(
      makeDeps(fake.api, store, fakeClock().clock), [URL_CN], UID,
    )

    expect(outcome).toBe(false)
    expect(store.insertedBatches).toEqual([])
    expect(store.ensuredUids).toEqual([])
  })

  it('探底网络失败(重试耗尽)→ false 零写入', async () => {
    const fake = fakeApi({
      '301:1': [new NetworkError(), new NetworkError(), new NetworkError(), new NetworkError()],
    })
    const store = fakeStorage()

    const outcome = await autoSyncOnStartup(
      makeDeps(fake.api, store, fakeClock().clock), [URL_CN], UID,
    )

    expect(outcome).toBe(false)
    expect(fake.requests).toHaveLength(4) // 首次 + 3 次重试,全部在探底层
    expect(store.insertedBatches).toEqual([])
  })

  it('多候选不同 uid 需用户选择(含 uid=null 候选)→ false 零写入', async () => {
    // 两个具名 uid 候选
    const twoNamed = fakeApi({ '301:1': [probeOk(UID, idAt(2)), probeOk(OTHER_UID, idAt(5))] })
    const namedStore = fakeStorage()
    expect(await autoSyncOnStartup(
      makeDeps(twoNamed.api, namedStore, fakeClock().clock), [URL_A, URL_B], UID,
    )).toBe(false)
    expect(namedStore.insertedBatches).toEqual([])
    expect(namedStore.ensuredUids).toEqual([])

    // 具名 uid + 匿名(uid=null)候选:null 亦计为不同 uid,需用户选择
    const namedAndNull = fakeApi({ '301:1': [probeOk(UID, idAt(2)), okPage([])] })
    const nullStore = fakeStorage()
    expect(await autoSyncOnStartup(
      makeDeps(namedAndNull.api, nullStore, fakeClock().clock), [URL_A, URL_B], UID,
    )).toBe(false)
    expect(nullStore.ensuredUids).toEqual([])
  })

  it('候选 uid 与当前档案不一致 → false,insertRecords 零调用', async () => {
    const fake = fakeApi({ '301:1': [probeOk(UID, idAt(2)), pageOfCode(301, A3)] })
    const store = fakeStorage()

    const outcome = await autoSyncOnStartup(
      makeDeps(fake.api, store, fakeClock().clock), [URL_CN], OTHER_UID,
    )

    expect(outcome).toBe(false)
    expect(store.insertedBatches).toEqual([])
    expect(store.ensuredUids).toEqual([])
  })

  it('空历史(守卫五池全空)→ false 零写入', async () => {
    const fake = fakeApi({
      // 探底空列表(uid=null 候选)+ 守卫五池各一空页
      '301:1': [okPage([]), okPage([])],
      '302:1': [okPage([])],
      '500:1': [okPage([])],
      '200:1': [okPage([])],
      '100:1': [okPage([])],
    })
    const store = fakeStorage()

    const outcome = await autoSyncOnStartup(
      makeDeps(fake.api, store, fakeClock().clock), [URL_CN], null,
    )

    expect(outcome).toBe(false)
    expect(store.insertedBatches).toEqual([])
    expect(store.ensuredUids).toEqual([])
    expect(store.lastSynced).toEqual([])
  })

  it('成功 → true:增量入库 + last_synced 更新;当前无档案时自动建档', async () => {
    // 有当前档案:uid 一致直接入库
    const matched = fakeApi({
      '301:1': [probeOk(UID, idAt(9)), pageOfCode(301, idAt(1)), pageOfCode(301, idAt(1))],
      '301:2': [okPage([])],
      '302:1': [pageOfCode(302, idAt(2))],
      '302:2': [okPage([])],
      '500:1': [pageOfCode(500, idAt(3))],
      '500:2': [okPage([])],
      '200:1': [pageOfCode(200, idAt(4))],
      '200:2': [okPage([])],
      '100:1': [pageOfCode(100, idAt(5))],
      '100:2': [okPage([])],
    })
    const matchedStore = fakeStorage()
    expect(await autoSyncOnStartup(
      makeDeps(matched.api, matchedStore, fakeClock().clock), [URL_CN], UID,
    )).toBe(true)
    expect(matchedStore.db).toHaveLength(5)
    expect(matchedStore.lastSynced).toEqual([{ uid: UID, iso: NOW_ISO }])

    // 当前无档案(null):守卫确认 uid 后自动建档
    const fresh = fakeApi({
      '301:1': [probeOk(UID, idAt(9)), pageOfCode(301, idAt(1)), pageOfCode(301, idAt(1))],
      '301:2': [okPage([])],
      '302:1': [pageOfCode(302, idAt(2))],
      '302:2': [okPage([])],
      '500:1': [pageOfCode(500, idAt(3))],
      '500:2': [okPage([])],
      '200:1': [pageOfCode(200, idAt(4))],
      '200:2': [okPage([])],
      '100:1': [pageOfCode(100, idAt(5))],
      '100:2': [okPage([])],
    })
    const freshStore = fakeStorage()
    expect(await autoSyncOnStartup(
      makeDeps(fresh.api, freshStore, fakeClock().clock), [URL_CN], null,
    )).toBe(true)
    expect(freshStore.ensuredUids).toEqual([UID])
    expect(freshStore.lastSynced).toEqual([{ uid: UID, iso: NOW_ISO }])
  })
})
