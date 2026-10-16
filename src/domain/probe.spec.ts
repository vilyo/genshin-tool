import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './errors'
import type { ClockPort, GachaApiPort } from './ports'
import {
  PROBE_RATE_INTERVAL_MS,
  PROBE_RETRY_INTERVAL_MS,
  PROBE_RETRY_LIMIT,
  probeCandidates,
} from './probe'

// 三个不同档案的规范 API URL(link.canonicalize 产物形态:域名已重建、lang=zh-cn)
const URL_A = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&sign_type=2&lang=zh-cn&region=cn_gf01' +
  '&game_biz=hk4e_cn&authkey=Ab%2Bcd'
const URL_B = 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&lang=zh-cn&region=os_usa' +
  '&game_biz=hk4e_global&authkey=Xy%2Fz'
const URL_C = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&lang=zh-cn&region=cn_gf01' +
  '&game_biz=hk4e_cn&authkey=Ef%2Fgh'
// 已带 gacha_type/page/size/end_id 的规范 URL(D6 覆写用例)
const URL_WITH_PARAMS = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&lang=zh-cn&authkey=Key%3D&gacha_type=200&page=3&size=20' +
  '&end_id=1700000000000000999'

// 探底请求期望形态:原参数原顺序保留,剔除已带的四项后追加探底四项(D6)
const PROBE_URL_A = URL_A + '&gacha_type=301&page=1&size=6&end_id=0'
const PROBE_URL_B = URL_B + '&gacha_type=301&page=1&size=6&end_id=0'
const PROBE_URL_C = URL_C + '&gacha_type=301&page=1&size=6&end_id=0'
const PROBE_URL_WITH_PARAMS = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&lang=zh-cn&authkey=Key%3D&gacha_type=301&page=1&size=6&end_id=0'

/** 探底响应(retcode 0):条目字段全为字符串,模拟官方返回 */
function okResponse(items: Array<{ uid: string; id: string; time: string }>): string {
  return JSON.stringify({
    retcode: 0,
    message: 'OK',
    data: {
      list: items.map((item) => ({
        uid: item.uid,
        gacha_type: '301',
        time: item.time,
        name: '刻晴',
        item_type: '角色',
        rank_type: '5',
        id: item.id,
        lang: 'zh-cn',
      })),
    },
  })
}
/** retcode −101:message 形态区分 timeout / error(D6 两种均淘汰) */
const expiredResponse = (message: string): string => JSON.stringify({ retcode: -101, message })
/** 其余 retcode ≠ 0(D11 归 ApiError) */
const apiErrorResponse = (retcode: number, message: string): string =>
  JSON.stringify({ retcode, message })

/**
 * 假接口:按 URL 预置一串响应(字符串 = 返回体,Error = 抛出),记录全部请求 URL。
 * 预置键为端口实际收到的探底 URL(PROBE_URL_*),不做任何键改写,
 * URL 构造契约由首个用例钉死。
 */
function fakeApi() {
  const requestedUrls: string[] = []
  const scripts = new Map<string, Array<string | Error>>()
  const api: GachaApiPort = {
    async get(url) {
      requestedUrls.push(url)
      const next = scripts.get(url)?.shift()
      if (next === undefined) throw new Error(`假接口未预置该 URL 的响应:${url}`)
      if (next instanceof Error) throw next
      return next
    },
  }
  return {
    api,
    requestedUrls,
    script(url: string, ...outcomes: Array<string | Error>) {
      scripts.set(url, outcomes)
    },
  }
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

describe('probeCandidates(spec 02 §9 F4 探底验证与多 UID)', () => {
  it('D6 探底请求:剔除已带的四项分页参数后追加 gacha_type=301&page=1&size=6&end_id=0,其余参数原样保留', async () => {
    const fake = fakeApi()
    fake.script(
      PROBE_URL_WITH_PARAMS,
      okResponse([{ uid: '100000001', id: '17000000000000000001', time: '2026-10-01 12:00:00' }]),
    )
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_WITH_PARAMS])

    expect(fake.requestedUrls).toEqual([PROBE_URL_WITH_PARAMS])
    expect(result.candidates).toHaveLength(1)
  })

  it('D7/D8:retcode=0 候选有效,uid 取 list[0].uid;最新 id/time 取响应内数值最大 id 条目(BigInt 比较而非字典序)', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, okResponse([
      { uid: '100000001', id: '1700000000000000000', time: '2026-10-01 12:00:00' },
      { uid: '100000001', id: '999', time: '2020-01-01 00:00:00' }, // 字典序最大、数值最小
      { uid: '100000001', id: '17000000000000001234', time: '2026-10-10 08:30:00' }, // 数值最大
    ]))
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A])

    expect(result.candidates).toEqual([
      {
        url: URL_A,
        uid: '100000001',
        latestId: '17000000000000001234',
        latestTime: '2026-10-10 08:30:00',
      },
    ])
    expect(result.allExpired).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('D7:探底列表为空(纯新号)→ uid/latestId/latestTime 记 null,候选保留「UID 拉取后确认」', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, okResponse([]))
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A])

    expect(result.candidates).toEqual([
      { url: URL_A, uid: null, latestId: null, latestTime: null },
    ])
    expect(result.allExpired).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('D6:retcode=-101 两种 message 形态(authkey timeout / authkey error)均淘汰候选不报错;全部 -101 → allExpired', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, expiredResponse('authkey timeout'))
    fake.script(PROBE_URL_B, expiredResponse('authkey error'))
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B])

    expect(result.candidates).toEqual([])
    expect(result.allExpired).toBe(true)
    expect(result.error).toBeUndefined()
    // -101 不重试:每候选恰一次请求;候选间一次 0.5s 限速,无 5s 重试间隔
    expect(fake.requestedUrls).toEqual([PROBE_URL_A, PROBE_URL_B])
    expect(sleeps).toEqual([PROBE_RATE_INTERVAL_MS])
  })

  it('D6 裁决:其余 retcode 按 ApiError 淘汰该候选并继续下一候选,不影响后续有效候选;retcode≠0 零重试', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, apiErrorResponse(-5, '系统繁忙'))
    fake.script(PROBE_URL_B, okResponse([
      { uid: '100000002', id: '17000000000000000001', time: '2026-10-01 12:00:00' },
    ]))
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B])

    expect(result.candidates).toEqual([
      { url: URL_B, uid: '100000002', latestId: '17000000000000000001', latestTime: '2026-10-01 12:00:00' },
    ])
    expect(result.allExpired).toBe(false)
    expect(result.error).toBeUndefined()
    // ApiError 不重试:A 一次、B 一次
    expect(fake.requestedUrls).toEqual([PROBE_URL_A, PROBE_URL_B])
    expect(sleeps).toEqual([PROBE_RATE_INTERVAL_MS])
  })

  it('D9:全部候选 retcode 失败 → 携带最后一个 ApiError;-101 与其他失败混合时 allExpired 仍为假', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, expiredResponse('authkey timeout'))
    fake.script(PROBE_URL_B, apiErrorResponse(-5, '错误甲'))
    fake.script(PROBE_URL_C, apiErrorResponse(-106, '错误乙'))
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B, URL_C])

    expect(result.candidates).toEqual([])
    expect(result.allExpired).toBe(false)
    expect(result.error).toBeInstanceOf(ApiError)
    expect((result.error as ApiError).retcode).toBe(-106)
    expect((result.error as ApiError).message).toBe('错误乙')
  })

  it('D14:NetworkError 重试 3 次×5s 后候选标记不可达,继续下一候选;间隔序列符合 D13/D14', async () => {
    const fake = fakeApi()
    fake.script(
      PROBE_URL_A,
      new NetworkError('超时'),
      new NetworkError('超时'),
      new NetworkError('超时'),
      new NetworkError('超时'),
    )
    fake.script(PROBE_URL_B, okResponse([
      { uid: '100000002', id: '17000000000000000001', time: '2026-10-01 12:00:00' },
    ]))
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B])

    expect(result.candidates).toEqual([
      { url: URL_B, uid: '100000002', latestId: '17000000000000000001', latestTime: '2026-10-01 12:00:00' },
    ])
    expect(result.error).toBeUndefined()
    // A 首次 + 3 次重试共 4 个请求;随后 B 的首个请求前补一次 0.5s 限速
    expect(fake.requestedUrls.filter((url) => url === PROBE_URL_A)).toHaveLength(1 + PROBE_RETRY_LIMIT)
    expect(fake.requestedUrls[PROBE_RETRY_LIMIT + 1]).toBe(PROBE_URL_B)
    expect(sleeps).toEqual([
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RATE_INTERVAL_MS,
    ])
  })

  it('D6:全部候选网络不可达(各自重试耗尽)→ 携带 NetworkError', async () => {
    const fake = fakeApi()
    const networkFailures = (): Array<string | Error> => [
      new NetworkError('超时'),
      new NetworkError('超时'),
      new NetworkError('超时'),
      new NetworkError('超时'),
    ]
    fake.script(PROBE_URL_A, ...networkFailures())
    fake.script(PROBE_URL_B, ...networkFailures())
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B])

    expect(result.candidates).toEqual([])
    expect(result.allExpired).toBe(false)
    expect(result.error).toBeInstanceOf(NetworkError)
    expect(fake.requestedUrls.filter((url) => url === PROBE_URL_A)).toHaveLength(1 + PROBE_RETRY_LIMIT)
    expect(fake.requestedUrls.filter((url) => url === PROBE_URL_B)).toHaveLength(1 + PROBE_RETRY_LIMIT)
    // A 重试耗尽后 B 首请求前补 0.5s;B 内部 3 次 5s 重试
    expect(sleeps).toEqual([
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RATE_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
      PROBE_RETRY_INTERVAL_MS,
    ])
  })

  it('解析失败(非 JSON)按 NetworkError 语义:同受 D14 重试保护,可恢复;持续失败则候选不可达', async () => {
    // 一次坏返回体后重试成功
    const recover = fakeApi()
    recover.script(
      PROBE_URL_A,
      '<html>Bad Gateway</html>',
      okResponse([{ uid: '100000001', id: '17000000000000000001', time: '2026-10-01 12:00:00' }]),
    )
    const recovered = await probeCandidates(recover.api, fakeClock().clock, [URL_A])
    expect(recovered.candidates).toHaveLength(1)
    expect(recover.requestedUrls).toHaveLength(2)

    // 持续返回非 JSON:重试耗尽 → 携带 NetworkError
    const dead = fakeApi()
    dead.script(PROBE_URL_A, 'not-json', 'not-json', 'not-json', 'not-json')
    const result = await probeCandidates(dead.api, fakeClock().clock, [URL_A])
    expect(result.candidates).toEqual([])
    expect(result.error).toBeInstanceOf(NetworkError)
    expect(dead.requestedUrls).toHaveLength(1 + PROBE_RETRY_LIMIT)
  })

  it('retcode=0 但缺 data.list:形状异常同按 NetworkError 语义处理(候选不可达)', async () => {
    const fake = fakeApi()
    fake.script(
      PROBE_URL_A,
      JSON.stringify({ retcode: 0, message: 'OK' }),
      JSON.stringify({ retcode: 0, message: 'OK' }),
      JSON.stringify({ retcode: 0, message: 'OK' }),
      JSON.stringify({ retcode: 0, message: 'OK' }),
    )
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A])

    expect(result.candidates).toEqual([])
    expect(result.error).toBeInstanceOf(NetworkError)
    expect(fake.requestedUrls).toHaveLength(1 + PROBE_RETRY_LIMIT)
  })

  it('D8:多候选按探底最大 id 降序;同 uid 只留最大 id 者', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, okResponse([
      { uid: '100000001', id: '17000000000000000001', time: '2026-09-01 10:00:00' }, // uid X 旧
    ]))
    fake.script(PROBE_URL_B, okResponse([
      { uid: '100000002', id: '17000000000000090000', time: '2026-10-15 21:00:00' }, // uid Y 最新
    ]))
    fake.script(PROBE_URL_C, okResponse([
      { uid: '100000001', id: '17000000000000050000', time: '2026-10-01 10:00:00' }, // uid X 新
    ]))
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B, URL_C])

    expect(result.candidates.map((candidate) => candidate.url)).toEqual([URL_B, URL_C])
    expect(result.candidates.map((candidate) => candidate.uid)).toEqual(['100000002', '100000001'])
  })

  it('D8:uid=null(空列表)候选不参与同 uid 去重,全部保留且排在没有最新 id 的候选之后', async () => {
    const fake = fakeApi()
    fake.script(PROBE_URL_A, okResponse([]))
    fake.script(PROBE_URL_B, okResponse([]))
    const { clock } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B])

    expect(result.candidates).toEqual([
      { url: URL_A, uid: null, latestId: null, latestTime: null },
      { url: URL_B, uid: null, latestId: null, latestTime: null },
    ])
  })

  it('D13:相邻候选请求间隔 0.5s,首个请求前不等待', async () => {
    const fake = fakeApi()
    const okByIndex = [
      { uid: '100000001', id: '17000000000000000001', time: '2026-10-01 12:00:00' },
      { uid: '100000002', id: '17000000000000020000', time: '2026-10-02 12:00:00' },
      { uid: '100000003', id: '17000000000000030000', time: '2026-10-03 12:00:00' },
    ]
    for (const [index, url] of [PROBE_URL_A, PROBE_URL_B, PROBE_URL_C].entries()) {
      fake.script(url, okResponse([okByIndex[index]]))
    }
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [URL_A, URL_B, URL_C])

    expect(result.candidates).toHaveLength(3)
    expect(fake.requestedUrls).toEqual([PROBE_URL_A, PROBE_URL_B, PROBE_URL_C])
    expect(sleeps).toEqual([PROBE_RATE_INTERVAL_MS, PROBE_RATE_INTERVAL_MS])
  })

  it('空候选列表直接返回空结果,不发请求不限速', async () => {
    const fake = fakeApi()
    const { clock, sleeps } = fakeClock()

    const result = await probeCandidates(fake.api, clock, [])

    expect(result).toEqual({ candidates: [], allExpired: false })
    expect(fake.requestedUrls).toEqual([])
    expect(sleeps).toEqual([])
  })
})
