import { describe, expect, it } from 'vitest'
import {
  ApiError,
  LinkExpiredError,
  LinkInvalidError,
  NetworkError,
  ProtocolError,
} from './errors'
import { poolCategory } from './pools'
import type { ClockPort, GachaApiPort, IdentityUpdate, StoragePort } from './ports'
import type { StoredRecord, WishRecord } from './records'
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

// 规范 API URL(link.canonicalize 产物形态:域名已重建、lang=zh-cn、authkey 保持 URL-encoded)
const URL_301 = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&sign_type=2&lang=zh-cn&region=cn_gf01' +
  '&game_biz=hk4e_cn&authkey=Ab%2Bcd'
// 已带旧分页参数的规范 URL(D10 覆写用例:四项剔除重写,其余保留)
const URL_WITH_PARAMS = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&lang=zh-cn&authkey=Key%3D&gacha_type=200&page=3&size=6' +
  '&end_id=1700000000000000999'

const UID = '100000001'

/** 19 位数字串 id(字符串拼接,避开 Number 精度);idAt(3) > idAt(2) > … */
const idAt = (n: number): string => `170000000000000${1000 + n}`

/** 分页请求期望形态:原参数原顺序保留,剔除已带四项后追加 gacha_type/size/page/end_id(D10) */
const requestUrl = (page: number, endId: string, gachaType = 301): string =>
  `${URL_301}&gacha_type=${gachaType}&size=${SYNC_PAGE_SIZE}&page=${page}&end_id=${endId}`

/** 官方条目(字段全为字符串;响应按 id 降序由调用方排列) */
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

/** retcode 0 的一页(list 原样,可为空数组 = 终止性空页) */
const okPage = (items: readonly unknown[]): string =>
  JSON.stringify({ retcode: 0, message: 'OK', data: { list: items } })

/** 按降序 id 生成一页合法响应 */
const pageOf = (...ids: string[]): string => okPage(ids.map((id) => rawItem(id)))

/** 其余 retcode ≠ 0(D11 归 ApiError) */
const failPage = (retcode: number, message: string): string => JSON.stringify({ retcode, message })

/** 与 rawItem 同默认值的入库形态种子(既有档案行用) */
const wishOf = (id: string, gachaType = 301): WishRecord => ({
  gachaType,
  time: '2026-10-01 12:00:00',
  name: `刻晴${id.slice(-3)}`,
  rankType: 5,
  id,
})

/** 假接口:按调用序消费一串结果(字符串 = 返回体,Error = 抛出),记录全部请求 URL */
function fakeApi(...outcomes: Array<string | Error>) {
  const requestedUrls: string[] = []
  let cursor = 0
  const api: GachaApiPort = {
    async get(url) {
      requestedUrls.push(url)
      const next = outcomes.at(cursor)
      cursor += 1
      if (next === undefined) throw new Error(`假接口响应脚本已耗尽(第 ${cursor} 次请求):${url}`)
      if (next instanceof Error) throw next
      return next
    },
  }
  return { api, requestedUrls }
}

/** 假时钟:sleep 只记录不等待 */
function fakeClock() {
  const sleeps: number[] = []
  const clock: ClockPort = {
    now: () => 0,
    async sleep(ms) {
      sleeps.push(ms)
    },
  }
  return { clock, sleeps }
}

/** 假存储:内存数组实现 StoragePort,记录全部写入与水位调用 */
function fakeStorage(seed: WishRecord[] = []) {
  const watermarks = new Map<string, string>()
  const db: StoredRecord[] = []
  const mult = new Map<string, number>()
  let nextRowid = 1
  const push = (record: WishRecord): StoredRecord => {
    const key = [
      poolCategory(record.gachaType),
      record.time,
      record.name,
      record.rankType,
    ].join('|')
    const seq = mult.get(key) ?? 0
    mult.set(key, seq + 1)
    const row: StoredRecord = { ...record, seq, rowid: nextRowid }
    nextRowid += 1
    db.push(row)
    return row
  }
  for (const record of seed) push(record)
  const insertedBatches: WishRecord[][] = []
  const identityUpdates: IdentityUpdate[] = []
  const setWatermarkCalls: Array<{ uid: string; gachaType: number; id: string }> = []
  const storage: StoragePort = {
    async loadRecords() {
      return db
    },
    async insertRecords(_uid, rows) {
      insertedBatches.push([...rows])
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
    async setLastSynced() {
      throw new Error('syncPool 不应调用 setLastSynced(T07 编排职责)')
    },
    async clearArchive() {
      throw new Error('syncPool 不应调用 clearArchive')
    },
    async listArchives() {
      throw new Error('syncPool 不应调用 listArchives')
    },
    async ensureArchive() {
      throw new Error('syncPool 不应调用 ensureArchive')
    },
    async migrateArchive() {
      throw new Error('syncPool 不应调用 migrateArchive')
    },
  }
  return { storage, db, watermarks, insertedBatches, identityUpdates, setWatermarkCalls }
}

function makeDeps(
  api: GachaApiPort,
  store: ReturnType<typeof fakeStorage>,
  clock: ClockPort,
  rate?: SyncRateState,
): SyncDeps {
  return { api, clock, storage: store.storage, rate }
}

describe('syncPool(spec 02 §9 F5/F6/F7/F12 + F10/F13 单池部分)', () => {
  it('F5/D10 游标链:end_id 首页 0、之后取上一页末条 id,空页即停;每页翻转升序落库', async () => {
    const fake = fakeApi(pageOf(idAt(3), idAt(2)), pageOf(idAt(1), idAt(0)), okPage([]))
    const store = fakeStorage()
    const { clock } = fakeClock()
    const progress: Array<[number, number, number]> = []

    const result = await syncPool(
      makeDeps(fake.api, store, clock),
      URL_301,
      301,
      UID,
      { onProgress: (page, fetched, added) => progress.push([page, fetched, added]) },
    )

    // 请求 URL 序列钉死游标链与 D10 参数形态(authkey 等原参数原样保留)
    expect(fake.requestedUrls).toEqual([
      requestUrl(1, '0'),
      requestUrl(2, idAt(2)), // 第 1 页末条(降序页最小 id)
      requestUrl(3, idAt(0)), // 第 2 页末条
    ])
    // 每页独立翻转升序入库(页内降序 → 升序)
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(2), idAt(3)],
      [idAt(0), idAt(1)],
    ])
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: idAt(3) }])
    expect(result).toEqual({ poolCode: 301, fetched: 4, added: 4, watermarked: true })
    // 进度按已入库页回调(终止性空页不回调),计数为本池累计
    expect(progress).toEqual([[1, 2, 2], [2, 4, 4]])
  })

  it('D10:规范 URL 已带旧分页参数时四项剔除重写、其余参数原样透传', async () => {
    const fake = fakeApi(okPage([]))
    const store = fakeStorage()
    const { clock } = fakeClock()

    await syncPool(makeDeps(fake.api, store, clock), URL_WITH_PARAMS, 301, UID)

    expect(fake.requestedUrls).toEqual([
      'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
        '?auth_appid=webview_gacha&lang=zh-cn&authkey=Key%3D' +
        `&gacha_type=301&size=${SYNC_PAGE_SIZE}&page=1&end_id=0`,
    ])
  })

  it('F5:无水位(含本地已有重复记录)不得提前停,必须拉到空页', async () => {
    const fake = fakeApi(pageOf(idAt(3), idAt(2)), pageOf(idAt(1)), okPage([]))
    // 本地已有 idAt(2)(与响应重复),但该池从未正常收尾 → 无水位,不允许提前停
    const store = fakeStorage([wishOf(idAt(2))])
    const { clock } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(fake.requestedUrls).toHaveLength(3) // 拉到空页为止
    expect(result).toEqual({ poolCode: 301, fetched: 3, added: 2, watermarked: true })
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(3)],
      [idAt(1)],
    ])
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: idAt(3) }])
  })

  it('F5:页内命中水位即停,且该页先合并入库;收尾水位推进为本次最大 id(无界重拉回归)', async () => {
    const fake = fakeApi(pageOf(idAt(5), idAt(4), idAt(3), idAt(2)))
    const store = fakeStorage()
    store.watermarks.set(`${UID}:301`, idAt(2)) // 水位 = 上次正常收尾的最大 id
    const { clock } = fakeClock()
    const progress: Array<[number, number, number]> = []

    const result = await syncPool(
      makeDeps(fake.api, store, clock),
      URL_301,
      301,
      UID,
      { onProgress: (page, fetched, added) => progress.push([page, fetched, added]) },
    )

    // 页内第 4 条(idAt(2))≤ 水位 → 本页(4 条)全部合并后停,不再发第 2 页
    expect(fake.requestedUrls).toEqual([requestUrl(1, '0')])
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(2), idAt(3), idAt(4), idAt(5)],
    ])
    // 新水位 = 本次拉取最大 id(第一页首条),而非既有水位 —— 否则增量重拉范围无界增长
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: idAt(5) }])
    expect(result).toEqual({ poolCode: 301, fetched: 4, added: 4, watermarked: true })
    expect(progress).toEqual([[1, 4, 4]])
  })

  it('F13:有水位时增量同步仅拉自水位以来的新页(请求次数断言),重复页合并零新增', async () => {
    const fake = fakeApi(pageOf(idAt(4), idAt(3)), pageOf(idAt(2), idAt(1)))
    const store = fakeStorage([wishOf(idAt(2)), wishOf(idAt(1))])
    store.watermarks.set(`${UID}:301`, idAt(2))
    const { clock } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    // 第 1 页全部 > 水位(继续);第 2 页首条命中水位(合并后停):恰 2 页请求
    expect(fake.requestedUrls).toEqual([requestUrl(1, '0'), requestUrl(2, idAt(3))])
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(3), idAt(4)],
      [], // 命中水位的页照常走逐页落库,但零新增
    ])
    expect(result).toEqual({ poolCode: 301, fetched: 4, added: 2, watermarked: true })
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: idAt(4) }])
  })

  it('F5:空池(第一页即空)→ 水位置 \'0\',零落库', async () => {
    const fake = fakeApi(okPage([]))
    const store = fakeStorage()
    const { clock } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(fake.requestedUrls).toEqual([requestUrl(1, '0')])
    expect(result).toEqual({ poolCode: 301, fetched: 0, added: 0, watermarked: true })
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: '0' }])
    expect(store.insertedBatches).toEqual([])
  })

  it('F6:相邻请求间隔 0.5s、首页请求前不等待', async () => {
    const fake = fakeApi(pageOf(idAt(1), idAt(0)), okPage([]))
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(fake.requestedUrls).toHaveLength(2)
    expect(sleeps).toEqual([SYNC_RATE_INTERVAL_MS]) // 第 2 页(空页终止)前一次
  })

  it('F6:每完成 10 页,下一请求前额外 +1s', async () => {
    const outcomes: Array<string | Error> = []
    for (let k = 9; k >= 0; k--) outcomes.push(pageOf(idAt(k))) // 10 页各 1 条
    outcomes.push(okPage([])) // 第 11 页空页终止
    const fake = fakeApi(...outcomes)
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(fake.requestedUrls).toHaveLength(11)
    // 第 1 页前不等待;第 2~10 页前各 0.5s;完成第 10 页后,空页请求前 0.5s+1s
    expect(sleeps).toEqual([
      ...Array.from({ length: 9 }, () => SYNC_RATE_INTERVAL_MS),
      SYNC_RATE_INTERVAL_MS + SYNC_TEN_PAGES_EXTRA_MS,
    ])
    expect(result.fetched).toBe(10)
  })

  it('F6:限速状态跨池共享(同一 SyncRateState),第二池首页请求前照常限速', async () => {
    const fakeA = fakeApi(pageOf(idAt(1)), okPage([]))
    const fakeB = fakeApi(pageOf(idAt(1)), okPage([]))
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()
    const rate = createRateState()

    await syncPool(makeDeps(fakeA.api, store, clock, rate), URL_301, 301, UID)
    await syncPool(makeDeps(fakeB.api, store, clock, rate), URL_301, 302, UID)

    // 池 A:首请求不等待、空页前 0.5s;池 B:首请求前 0.5s(A 已完成 2 页)、空页前 0.5s
    expect(sleeps).toEqual([
      SYNC_RATE_INTERVAL_MS,
      SYNC_RATE_INTERVAL_MS,
      SYNC_RATE_INTERVAL_MS,
    ])
    expect(fakeA.requestedUrls[0]).toContain('gacha_type=301')
    expect(fakeB.requestedUrls[0]).toContain('gacha_type=302')
  })

  it('F6:NetworkError 重试 3 次×5s 后成功,重试期间游标不变', async () => {
    const fake = fakeApi(
      new NetworkError('超时'),
      new NetworkError('超时'),
      new NetworkError('超时'),
      pageOf(idAt(1)),
      okPage([]),
    )
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(fake.requestedUrls.filter((url) => url === requestUrl(1, '0'))).toHaveLength(
      1 + SYNC_RETRY_LIMIT,
    )
    expect(fake.requestedUrls[SYNC_RETRY_LIMIT + 1]).toBe(requestUrl(2, idAt(1)))
    expect(sleeps).toEqual([
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RATE_INTERVAL_MS, // 第 2 页(空页)前的限速
    ])
    expect(result).toEqual({ poolCode: 301, fetched: 1, added: 1, watermarked: true })
  })

  it('F6:NetworkError 重试耗尽(3 次×5s)→ 上抛,已入库页保留、水位未推进', async () => {
    const fake = fakeApi(new NetworkError(), new NetworkError(), new NetworkError(), new NetworkError())
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NetworkError)
    expect(fake.requestedUrls).toEqual([
      requestUrl(1, '0'),
      requestUrl(1, '0'),
      requestUrl(1, '0'),
      requestUrl(1, '0'),
    ])
    expect(sleeps).toEqual([
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
    ])
    expect(store.insertedBatches).toEqual([])
    expect(store.setWatermarkCalls).toEqual([])
  })

  it('F6:retcode≠0(ApiError)零重试、不落库、不推进水位', async () => {
    const fake = fakeApi(failPage(-5, '系统繁忙'))
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).retcode).toBe(-5)
    expect((error as ApiError).message).toBe('系统繁忙')
    expect(fake.requestedUrls).toEqual([requestUrl(1, '0')])
    expect(sleeps).toEqual([])
    expect(store.insertedBatches).toEqual([])
    expect(store.setWatermarkCalls).toEqual([])
  })

  it('D11:retcode −101 按 message 分流 —— authkey timeout → 过期、authkey error → 无效,均零重试', async () => {
    const expired = fakeApi(failPage(-101, 'authkey timeout'))
    const expiredError = await syncPool(
      makeDeps(expired.api, fakeStorage(), fakeClock().clock),
      URL_301,
      301,
      UID,
    ).catch((caught: unknown) => caught)
    expect(expiredError).toBeInstanceOf(LinkExpiredError)
    expect(expired.requestedUrls).toHaveLength(1)

    const invalid = fakeApi(failPage(-101, 'authkey error'))
    const invalidError = await syncPool(
      makeDeps(invalid.api, fakeStorage(), fakeClock().clock),
      URL_301,
      301,
      UID,
    ).catch((caught: unknown) => caught)
    expect(invalidError).toBeInstanceOf(LinkInvalidError)
    expect(invalid.requestedUrls).toHaveLength(1)
  })

  it('F7:第 2 页 id 缺失 → ProtocolError 立即中止(不重试);已入库第 1 页保留、水位未推进', async () => {
    const missingId: Record<string, string> = {
      uid: UID,
      gacha_type: '301',
      time: '2026-10-01 12:00:00',
      name: '刻晴',
      item_type: '角色',
      rank_type: '5',
      lang: 'zh-cn',
    }
    const fake = fakeApi(pageOf(idAt(3), idAt(2)), okPage([missingId]))
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProtocolError)
    expect((error as ProtocolError).detail).toContain('id')
    // 协议错误不重试:第 2 页恰一次请求
    expect(fake.requestedUrls).toEqual([requestUrl(1, '0'), requestUrl(2, idAt(2))])
    expect(sleeps).toEqual([SYNC_RATE_INTERVAL_MS])
    // 逐页落库的既得利益:第 1 页已保留
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(2), idAt(3)],
    ])
    expect(store.setWatermarkCalls).toEqual([])
  })

  it('F7:rank_type 无法归一 3/4/5 → ProtocolError,零落库、零水位', async () => {
    const fake = fakeApi(okPage([rawItem(idAt(1), { rank_type: '6' })]))
    const store = fakeStorage()
    const { clock } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProtocolError)
    expect((error as ProtocolError).detail).toContain('rank_type')
    expect(store.insertedBatches).toEqual([])
    expect(store.setWatermarkCalls).toEqual([])
  })

  it('F7:同页 uid 混杂 → ProtocolError(脏行禁止静默跳过)', async () => {
    const fake = fakeApi(okPage([rawItem(idAt(2)), rawItem(idAt(1), { uid: '999999999' })]))
    const store = fakeStorage()
    const { clock } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProtocolError)
    expect((error as ProtocolError).detail).toContain('uid 不一致')
    expect(store.insertedBatches).toEqual([])
    expect(store.setWatermarkCalls).toEqual([])
  })

  it('F7:time 或 name 为空 → ProtocolError', async () => {
    const emptyTime = fakeApi(okPage([rawItem(idAt(1), { time: '' })]))
    const emptyTimeError = await syncPool(
      makeDeps(emptyTime.api, fakeStorage(), fakeClock().clock),
      URL_301,
      301,
      UID,
    ).catch((caught: unknown) => caught)
    expect(emptyTimeError).toBeInstanceOf(ProtocolError)
    expect((emptyTimeError as ProtocolError).detail).toContain('time')

    const emptyName = fakeApi(okPage([rawItem(idAt(1), { name: '' })]))
    const emptyNameError = await syncPool(
      makeDeps(emptyName.api, fakeStorage(), fakeClock().clock),
      URL_301,
      301,
      UID,
    ).catch((caught: unknown) => caught)
    expect(emptyNameError).toBeInstanceOf(ProtocolError)
    expect((emptyNameError as ProtocolError).detail).toContain('name')
  })

  it('F12:400 混入 301 响应按条目自带 gacha_type 入库;未知 code(1000)照常入库不报错', async () => {
    const fake = fakeApi(
      okPage([
        rawItem(idAt(3), { gacha_type: '400' }),
        rawItem(idAt(2), { gacha_type: '301' }),
        rawItem(idAt(1), { gacha_type: '1000' }),
      ]),
      okPage([]),
    )
    const store = fakeStorage()
    const { clock } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(result.fetched).toBe(3)
    expect(store.insertedBatches.flat().map((row) => [row.id, row.gachaType])).toEqual([
      [idAt(1), 1000], // 未知 code 容错入库(展示落「未收录」)
      [idAt(2), 301],
      [idAt(3), 400], // 400 混入:不信查询参数,以条目为准
    ])
    expect(store.setWatermarkCalls).toEqual([{ uid: UID, gachaType: 301, id: idAt(3) }])
  })

  it('F10 单池:首次同步中途断网(第 2 页重试耗尽)→ 第 1 页保留、无水位;水位推进仅发生在正常收尾', async () => {
    const fake = fakeApi(
      pageOf(idAt(3), idAt(2)),
      new NetworkError('断网'),
      new NetworkError('断网'),
      new NetworkError('断网'),
      new NetworkError('断网'),
    )
    const store = fakeStorage()
    const { clock, sleeps } = fakeClock()

    const error = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NetworkError)
    // 第 1 页一次成功,第 2 页 1 + 3 次重试全部失败
    expect(fake.requestedUrls.filter((url) => url === requestUrl(1, '0'))).toHaveLength(1)
    expect(fake.requestedUrls.filter((url) => url === requestUrl(2, idAt(2)))).toHaveLength(
      1 + SYNC_RETRY_LIMIT,
    )
    // 中断不丢已确认页:第 1 页已落库
    expect(store.insertedBatches.map((batch) => batch.map((row) => row.id))).toEqual([
      [idAt(2), idAt(3)],
    ])
    // 中断绝不推进水位(下次同步将全量重拉该池,不产生静默缺口)
    expect(store.setWatermarkCalls).toEqual([])
    // 间隔序列:第 2 页前限速 0.5s + 3 次 5s 重试
    expect(sleeps).toEqual([
      SYNC_RATE_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
      SYNC_RETRY_INTERVAL_MS,
    ])
  })

  it('D15:逐页落库接线 —— 既有无 id 行与接口行配对时经 updateIdentity 回填,不产生新增', async () => {
    const fake = fakeApi(pageOf(idAt(1)), okPage([]))
    const store = fakeStorage([{ ...wishOf(idAt(1)), id: null }]) // 迁入的无 id 行
    const { clock } = fakeClock()

    const result = await syncPool(makeDeps(fake.api, store, clock), URL_301, 301, UID)

    expect(result).toEqual({ poolCode: 301, fetched: 1, added: 0, watermarked: true })
    expect(store.identityUpdates).toEqual([{ rowid: 1, id: idAt(1) }])
    expect(store.insertedBatches).toEqual([[]])
    expect(store.db[0].id).toBe(idAt(1))
  })
})
