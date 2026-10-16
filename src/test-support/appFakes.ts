/**
 * 编排测试共用假实现(stores/app.spec 与 App.spec 共用):
 * 只依赖 domain 端口类型,经 setAppDeps 注入;不进应用代码路径。
 */
import { vi } from 'vitest'
import { NetworkError } from '@/domain/errors'
import type { ExcelCell, WorkbookData } from '@/domain/excelImport'
import type { ClockPort, GachaApiPort, StoragePort } from '@/domain/ports'
import type { WishRecord, StoredRecord } from '@/domain/records'

/** 测试用原始祈愿链接(含载体标记与鉴权;authkey 已编码) */
export const RAW_URL =
  'https://webstatic.mihoyo.com/?auth_appid=webview_gacha&authkey=Ab%2Bcd%3Def&game_biz=hk4e_cn&lang=zh-cn'

/** RAW_URL 规范化产物(game_biz=hk4e_cn → 国服 getGachaLog,lang 强制 zh-cn) */
export const CN_CANONICAL =
  'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog' +
  '?auth_appid=webview_gacha&authkey=Ab%2Bcd%3Def&game_biz=hk4e_cn&lang=zh-cn'

/** 国际服形态(第二候选用;authkey 不同以区分候选) */
export const GLOBAL_URL =
  'https://webstatic.hoyoverse.com/?auth_appid=webview_gacha&authkey=Xy%2Fz%3Dw&game_biz=hk4e_global&lang=zh-cn'

export const SYNCED_UID = '777'

/** 文本 → 缓存字节(ASCII 样本,latin1/UTF-8 同形;前后带控制字符噪声) */
export function cacheBytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(`\x00junk${text}\x01tail`)
}

/** 假时钟:sleep 立即兑现,限速/重试零等待 */
export const fakeClock: ClockPort = {
  now: () => 0,
  sleep: async () => {},
}

export interface ApiOptions {
  /** 探底/守卫页返回的 uid;可按 authkey 区分候选(默认恒 '777') */
  uid?: string | ((authkey: string | null) => string)
  /** 每池第 1 页条数(默认 3);返回 0 即空页/匿名候选 */
  countFor?: (poolCode: number, authkey: string | null) => number
  /** 完全接管响应(如全部过期);返回 null 走默认信封 */
  respond?: (poolCode: number, page: number, authkey: string | null) => string | null
  /** 指定池/页请求直接拒绝(网络失败,受 D14 重试保护) */
  reject?: (poolCode: number, page: number) => boolean
}

/** 官方信封(D11 合法形态:字段全字符串、id 19 位数字串、页内 id 降序;id 跨池全局唯一) */
export function envelopeOf(
  uid: string,
  poolCode: number,
  page: number,
  count: number,
): string {
  const list = Array.from({ length: count }, (_, i) => ({
    uid,
    gacha_type: String(poolCode),
    time: `2026-01-01 ${String(i % 24).padStart(2, '0')}:00:00`,
    name: `物品${poolCode}-${i}`,
    lang: 'zh-cn',
    item_type: '武器',
    rank_type: '3',
    id: (1900000000000000000n - BigInt(poolCode) * 100000n - BigInt(page) * 1000n - BigInt(i)).toString(),
  }))
  return JSON.stringify({ retcode: 0, message: 'OK', data: { list } })
}

/** 拉取/探底两用的假 API:第 1 页给 countFor 条,第 2 页起空页(拉到空页停) */
export function makeFakeApi(options: ApiOptions = {}): GachaApiPort {
  const uidFor = options.uid ?? SYNCED_UID
  const countFor = options.countFor ?? (() => 3)
  return {
    get: vi.fn(async (url: string) => {
      const parsed = new URL(url)
      const poolCode = Number(parsed.searchParams.get('gacha_type'))
      const page = Number(parsed.searchParams.get('page'))
      const authkey = parsed.searchParams.get('authkey')
      if (options.reject?.(poolCode, page)) throw new NetworkError()
      const scripted = options.respond?.(poolCode, page, authkey)
      if (scripted !== null && scripted !== undefined) return scripted
      const uid = typeof uidFor === 'function' ? uidFor(authkey) : uidFor
      const count = page === 1 ? countFor(poolCode, authkey) : 0
      return envelopeOf(uid, poolCode, page, count)
    }),
  }
}

let rowidSeq = 0

/** 既有落库行(默认常驻池三星,无 id = 迁入行形态) */
export function storedRecord(overrides: Partial<WishRecord> = {}): StoredRecord {
  rowidSeq += 1
  return {
    gachaType: 200,
    time: '2021-01-01 00:00:00',
    name: `旧记录${rowidSeq}`,
    rankType: 3,
    id: null,
    seq: 0,
    rowid: rowidSeq,
    ...overrides,
  }
}

export interface FakeStorage {
  storage: StoragePort
  /** db.get(uid):观察/断言库内数据 */
  db: Map<string, StoredRecord[]>
  /** 关键写动作的调用记录(零写入断言用) */
  calls: {
    insertRecords: ReturnType<typeof vi.fn>
    migrateArchive: ReturnType<typeof vi.fn>
    ensureArchive: ReturnType<typeof vi.fn>
    clearArchive: ReturnType<typeof vi.fn>
    updateIdentity: ReturnType<typeof vi.fn>
  }
}

/** 内存 SQLite 假实现:档案 = db 键;set_last_synced 记入档案摘要 */
export function makeFakeStorage(seed: Record<string, StoredRecord[]> = {}): FakeStorage {
  const db = new Map<string, StoredRecord[]>(
    Object.entries(seed).map(([uid, rows]) => [uid, [...rows]]),
  )
  const lastSynced = new Map<string, string>()
  const calls = {
    insertRecords: vi.fn(),
    migrateArchive: vi.fn(),
    ensureArchive: vi.fn(),
    clearArchive: vi.fn(),
    updateIdentity: vi.fn(),
  }
  const storage: StoragePort = {
    loadRecords: async (uid) => [...(db.get(uid) ?? [])],
    insertRecords: async (uid, rows) => {
      calls.insertRecords(uid, rows)
      const list = db.get(uid) ?? []
      for (const row of rows) {
        list.push({
          ...row,
          seq: list.filter((item) => item.time === row.time && item.name === row.name).length,
          rowid: (rowidSeq += 1),
        })
      }
      db.set(uid, list)
      return rows.length
    },
    updateIdentity: async (updates) => {
      calls.updateIdentity(updates)
      return updates.length
    },
    getWatermark: async () => null,
    setWatermark: async () => {},
    setLastSynced: async (uid, iso) => {
      lastSynced.set(uid, iso)
    },
    clearArchive: async (uid) => {
      calls.clearArchive(uid)
      // 对齐 Rust db_clear_archive:记录+水位+last_synced 同清,档案行(键)保留
      const removed = (db.get(uid) ?? []).length
      db.set(uid, [])
      lastSynced.delete(uid)
      return removed
    },
    migrateArchive: async (from, to) => {
      calls.migrateArchive(from, to)
      const rows = db.get(from) ?? []
      db.set(from, [])
      db.set(to, [...(db.get(to) ?? []), ...rows])
      return rows.length
    },
    listArchives: async () =>
      [...db.keys()].map((uid) => ({
        uid,
        createdAt: '2026-01-01T00:00:00Z',
        lastSyncedAt: lastSynced.get(uid) ?? null,
      })),
    ensureArchive: async (uid) => {
      calls.ensureArchive(uid)
      if (!db.has(uid)) db.set(uid, [])
    },
  }
  return { storage, db, calls }
}

// —— Excel 合成工作簿(spec 03 同构:七列表头,角色活动表拆 301/400)——

function cell(value: string | number): ExcelCell {
  return { t: typeof value === 'number' ? 'n' : 's', v: value }
}

const HEADERS = ['时间', '名称', '类别', '星级', '总次数', '保底内', '备注'].map(cell)

/** 五表同构小样本:角色活动 2 行(301/400 各 1)+ 武器/常驻各 1 行 + 新手空表 */
export function makeWorkbook(): WorkbookData {
  return {
    sheets: [
      {
        name: '角色活动祈愿',
        rows: [
          HEADERS,
          [cell('2021-05-01 10:00:00'), cell('温迪'), cell('角色'), cell(5), cell(1), cell(1), cell('')],
          [cell('2021-06-01 11:00:00'), cell('优菈'), cell('角色'), cell(5), cell(2), cell(2), cell('祈愿2')],
          [cell('2021-06-01 11:00:00'), cell('试作斩岩'), cell('武器'), cell(4), cell(3), cell(3), cell('')],
        ],
      },
      {
        name: '武器活动祈愿',
        rows: [
          HEADERS,
          [cell('2021-06-02 09:00:00'), cell('天空之翼'), cell('武器'), cell(5), cell(1), cell(1), cell('')],
        ],
      },
      {
        name: '常驻祈愿',
        rows: [
          HEADERS,
          [cell('2021-06-03 09:00:00'), cell('迪卢克'), cell('角色'), cell(5), cell(1), cell(1), cell('')],
        ],
      },
      { name: '集录祈愿', rows: [HEADERS] },
      { name: '新手祈愿', rows: [HEADERS] },
    ],
  }
}
