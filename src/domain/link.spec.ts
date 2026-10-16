import { describe, expect, it } from 'vitest'
import {
  ApiError,
  ArchiveMismatchError,
  CacheLinkNotFoundError,
  EmptyHistoryError,
  LinkExpiredError,
  LinkInvalidError,
  LinkParseError,
  NetworkError,
  ProtocolError,
  UnsupportedPlatformError,
} from './errors'
import { canonicalize, extractGachaUrls, normalizeGachaUrl } from './link'

/** 按 latin1 把样本字符串转字节(样本字符均在 U+00FF 内),模拟二进制缓存/日志/粘贴文本 */
const toBytes = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

// 合成样本:国服链接 authkey 未编码(含 + / =),国际服链接 authkey 已编码(含 %)
const CN_URL =
  'https://webstatic.mihoyo.com/h5/gachaverse/?auth_appid=webview_gacha&authkey_ver=1&sign_type=2' +
  '&lang=zh-cn&region=cn_gf01&game_biz=hk4e_cn&authkey=Ab+cd=ef/gh#/log'
const GLOBAL_URL =
  'https://webstatic.hoyoverse.com/h5/gachaverse/?auth_appid=webview_gacha&authkey_ver=1&sign_type=2' +
  '&lang=en-us&region=os_usa&game_biz=hk4e_global&authkey=Xy%2Fz%3Dw'
/** 不含 auth_appid=webview_gacha 的干扰 URL */
const DECOY_URL = 'https://example.com/gacha?authkey=abc&lang=zh-cn'

const CN_CANONICAL =
  'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&sign_type=2&lang=zh-cn&region=cn_gf01' +
  '&game_biz=hk4e_cn&authkey=Ab%2Bcd%3Def%2Fgh'
const GLOBAL_CANONICAL =
  'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey_ver=1&sign_type=2&lang=zh-cn&region=os_usa' +
  '&game_biz=hk4e_global&authkey=Xy%2Fz%3Dw'

describe('extractGachaUrls(spec 02 §9 F1 提取)', () => {
  it('从合成缓存字节提取含 auth_appid=webview_gacha 的 URL:控制字符截断、逐字节去重、滤除干扰', () => {
    const sample = toBytes(
      '\u00de\u00ad\xbe\xef\x00\x01junk' +
        CN_URL + '\x00' +
        'binary\u0003noise' +
        CN_URL + '\x02' + // 逐字节相同 → 去重,保序取首个出现位
        GLOBAL_URL + '\x01' +
        DECOY_URL + '\x00' + // 不含载体标记 → 滤除
        'trailing\u0000garbage',
    )
    expect(extractGachaUrls(sample)).toEqual([CN_URL, GLOBAL_URL])
  })

  it('URL 终结于引号(粘贴文本带引号包裹)', () => {
    const quoted = toBytes(`"https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey=a=b"文末`)
    expect(extractGachaUrls(quoted)).toEqual([
      'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey=a=b',
    ])
  })

  it('空输入与无匹配返回空数组', () => {
    expect(extractGachaUrls(new Uint8Array(0))).toEqual([])
    expect(extractGachaUrls(toBytes('这里没有任何链接\x00binary'))).toEqual([])
  })
})

describe('normalizeGachaUrl(spec 02 §9 F2 authkey 编码修复)', () => {
  it('authkey 未编码(含 + / =)→ 补编码', () => {
    expect(normalizeGachaUrl(CN_URL)).toContain('authkey=Ab%2Bcd%3Def%2Fgh')
  })

  it('authkey 已编码(含 %)→ 原样保留', () => {
    expect(normalizeGachaUrl(GLOBAL_URL)).toContain('authkey=Xy%2Fz%3Dw')
  })

  it('无 authkey 参数 → LinkParseError;authkey 为空同样拒绝', () => {
    expect(() =>
      normalizeGachaUrl('https://webstatic.mihoyo.com/?auth_appid=webview_gacha&lang=zh-cn'),
    ).toThrowError(LinkParseError)
    expect(() =>
      normalizeGachaUrl('https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey='),
    ).toThrowError(/authkey/)
  })

  it('无法解析的字符串 → LinkParseError', () => {
    expect(() => normalizeGachaUrl('这不是一个链接')).toThrowError(LinkParseError)
  })
})

describe('normalizeGachaUrl(spec 02 §9 F3 域名重建/fragment/lang)', () => {
  it('game_biz=hk4e_cn → 国服 getGachaLog 域名', () => {
    expect(normalizeGachaUrl(CN_URL)).toBe(CN_CANONICAL)
  })

  it('game_biz=hk4e_global 或缺省 → 国际服域名', () => {
    expect(normalizeGachaUrl(GLOBAL_URL)).toBe(GLOBAL_CANONICAL)
    expect(
      normalizeGachaUrl('https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey=a'),
    ).toBe(
      'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog' +
        '?auth_appid=webview_gacha&authkey=a&lang=zh-cn',
    )
  })

  it('fragment(#/log)去除,其余查询参数全部保留', () => {
    const out = normalizeGachaUrl(CN_URL)
    expect(out).not.toContain('#')
    expect(out).not.toContain('/log')
    expect(out).toContain('auth_appid=webview_gacha')
    expect(out).toContain('authkey_ver=1')
    expect(out).toContain('sign_type=2')
    expect(out).toContain('region=cn_gf01')
  })

  it('lang 一律强制 zh-cn(原 zh-tw / en / 缺省都覆写)', () => {
    const tw = normalizeGachaUrl(
      'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&game_biz=hk4e_cn&lang=zh-tw&authkey=a',
    )
    expect(tw).toContain('lang=zh-cn')
    expect(tw).not.toContain('lang=zh-tw')
    const en = normalizeGachaUrl(
      'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&game_biz=hk4e_global&lang=en-us&authkey=a',
    )
    expect(en).toContain('lang=zh-cn')
    expect(
      normalizeGachaUrl('https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey=a'),
    ).toContain('lang=zh-cn')
  })
})

describe('canonicalize(提取+规范化+规范形态再去重,三入口共用)', () => {
  it('原始不同但规范化相同的候选只留一条,结果保序', () => {
    const cnUrlNoHash = CN_URL.replace('#/log', '')
    const bytes = toBytes(CN_URL + '\x00' + cnUrlNoHash + '\x01' + GLOBAL_URL + '\x00')
    expect(canonicalize(bytes)).toEqual([CN_CANONICAL, GLOBAL_CANONICAL])
  })

  it('坏候选(缺 authkey)逐条容错跳过,好候选照常返回', () => {
    const badUrl = 'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&lang=zh-cn'
    const bytes = toBytes(badUrl + '\x00' + CN_URL + '\x00')
    expect(canonicalize(bytes)).toEqual([CN_CANONICAL])
  })

  it('提取到候选但全部规范化失败 → 抛 LinkParseError(保留精确反馈)', () => {
    const badNoKey = 'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&lang=zh-cn'
    const badEmptyKey = 'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey='
    expect(() =>
      canonicalize(toBytes(badNoKey + '\x00' + badEmptyKey + '\x00')),
    ).toThrowError(LinkParseError)
  })

  it('原始提取 0 条 → 返回空数组(不抛)', () => {
    expect(canonicalize(toBytes(DECOY_URL + '\x00'))).toEqual([])
    expect(canonicalize(toBytes('只有垃圾字节\x00'))).toEqual([])
    expect(canonicalize(new Uint8Array(0))).toEqual([])
  })
})

describe('errors(spec 02 §7 错误分类)', () => {
  it('name 置类名且均为 Error 实例', () => {
    const samples = [
      new CacheLinkNotFoundError(),
      new UnsupportedPlatformError(),
      new LinkParseError(),
      new LinkExpiredError(),
      new LinkInvalidError(),
      new NetworkError(),
      new ProtocolError(),
      new EmptyHistoryError(),
    ]
    for (const err of samples) {
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe(err.constructor.name)
    }
    expect(new ApiError(-1, 'x').name).toBe('ApiError')
    expect(new ArchiveMismatchError('1').name).toBe('ArchiveMismatchError')
  })

  it('LinkExpiredError.message 为 S7 定稿文案', () => {
    expect(new LinkExpiredError().message).toBe('祈愿链接已过期,请在游戏内重新打开祈愿记录页')
  })

  it('ApiError 携带 retcode 与官方 message', () => {
    const err = new ApiError(-105, '系统繁忙')
    expect(err.retcode).toBe(-105)
    expect(err.message).toBe('系统繁忙')
  })

  it('ProtocolError 可携带 detail', () => {
    expect(new ProtocolError().detail).toBeUndefined()
    expect(new ProtocolError('官方返回数据异常,已中止本次同步', 'rank_type=2').detail).toBe('rank_type=2')
  })

  it('ArchiveMismatchError 携带 resolvedUid', () => {
    const err = new ArchiveMismatchError('100000002')
    expect(err.resolvedUid).toBe('100000002')
    expect(err.message).toContain('100000002')
  })
})
