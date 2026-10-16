import { describe, expect, it } from 'vitest'
import { poolCategory } from './pools'
import {
  deepFreeze,
  eCell,
  FIXTURE_SHEETS,
  headerRow,
  makeRows,
  makeSheet,
  makeWorkbook,
  nCell,
  nullCell,
  sCell,
  timeAt,
} from './excelFixture'
import type { FixtureRowSpec } from './excelFixture'
import { applyExcelImport, parseWorkbook, previewExcelImport, UNLINKED_UID } from './excelImport'
import type { ExcelIssue, ExcelParseResult, ExcelPort, ExcelWarningKind } from './excelImport'
import type { IdentityUpdate, StoragePort } from './ports'
import type { StoredRecord, WishRecord } from './records'

// ---------------------------------------------------------------------------
// 合成样本(spec 03:仓库内测试一律用 fixture,真实 xlsx 绝不入库)
// ---------------------------------------------------------------------------

/** 十连同秒行组(双四星:第 1、4 行) */
const TEN_PULL_TIME = timeAt(4, 20, 0, 0)
const TEN_PULL_SPECS: FixtureRowSpec[] = [4, 3, 3, 4, 3, 3, 3, 3, 3, 3].map((rank, index) => ({
  time: TEN_PULL_TIME,
  name: `十连${index + 1}号`,
  rank,
}))

/** G1/G8/G9 共用的五表合成工作簿(22 行,池分布 301:13 / 400:1 / 302:3 / 200:2 / 500:1 / 100:2) */
function buildCharSpecs(): FixtureRowSpec[] {
  return [
    // 星级以文本单元格出现(D3 容忍归一)、名称带首尾空白(D3 去空白)
    { time: timeAt(1, 8, 0, 0), name: ' 行秋 ', rank: 4, override: { 3: sCell('4') } },
    { time: timeAt(1, 8, 0, 1), name: '讨龙英杰谭', category: '武器', rank: 3 },
    { time: timeAt(2, 9, 0, 0), name: '那维莱特', rank: 5, remark: '祈愿2' },
    { time: timeAt(3, 10, 0, 0), name: '妮露', rank: 5 },
    ...TEN_PULL_SPECS,
  ]
}

function buildSampleWorkbook() {
  return makeWorkbook([
    makeSheet(FIXTURE_SHEETS.eventChar, makeRows(buildCharSpecs())),
    makeSheet(FIXTURE_SHEETS.eventWeapon, makeRows([
      { time: timeAt(2, 9, 0, 1), name: '碧落之珑', category: '武器', rank: 5 },
      { time: timeAt(2, 9, 0, 2), name: '匣里龙吟', category: '武器', rank: 4 },
      { time: timeAt(2, 9, 0, 3), name: '武器表角色四星', category: '角色', rank: 4 },
    ])),
    makeSheet(FIXTURE_SHEETS.standard, makeRows([
      { time: timeAt(1, 9, 0, 0), name: '迪卢克', rank: 5 },
      { time: timeAt(1, 9, 0, 1), name: '西风剑', category: '武器', rank: 4 },
    ])),
    makeSheet(FIXTURE_SHEETS.chronicled, makeRows([
      { time: timeAt(3, 11, 0, 0), name: '风鹰剑', category: '武器', rank: 5 },
    ])),
    makeSheet(FIXTURE_SHEETS.novice, makeRows([
      { time: timeAt(1, 7, 0, 0), name: '安柏', rank: 4 },
      { time: timeAt(1, 7, 0, 1), name: '凯亚', rank: 4 },
    ])),
  ])
}

const UID = '100000001'

// ---------------------------------------------------------------------------
// 假实现(照 syncPool.spec 的 fakeStorage 模式,按 uid 分桶)
// ---------------------------------------------------------------------------

/** 内存档案存储:记录全部写入调用;getWatermark 等迁入流程不该触碰的方法直接抛错 */
function fakeStorage(
  seed: Partial<Record<string, readonly WishRecord[]>> = {},
  archives: readonly string[] = [],
) {
  const db = new Map<string, StoredRecord[]>()
  let nextRowid = 1
  for (const [uid, records] of Object.entries(seed)) {
    if (records === undefined) continue
    db.set(uid, records.map((record) => ({ ...record, seq: 0, rowid: nextRowid++ })))
  }
  const archiveUids = [...archives]
  const ensureCalls: string[] = []
  const listArchivesCalls: number[] = []
  const insertedBatches: Array<{ uid: string; rows: WishRecord[] }> = []
  const identityUpdates: IdentityUpdate[] = []
  const storage: StoragePort = {
    async loadRecords(uid) {
      return db.get(uid) ?? []
    },
    async insertRecords(uid, rows) {
      insertedBatches.push({ uid, rows: [...rows] })
      const target = db.get(uid) ?? []
      for (const record of rows) target.push({ ...record, seq: 0, rowid: nextRowid++ })
      db.set(uid, target)
      return rows.length
    },
    async updateIdentity(updates) {
      identityUpdates.push(...updates)
      return updates.length
    },
    async getWatermark() {
      throw new Error('excelImport 不应调用 getWatermark')
    },
    async setWatermark() {
      throw new Error('excelImport 不应调用 setWatermark')
    },
    async setLastSynced() {
      throw new Error('excelImport 不应调用 setLastSynced')
    },
    async clearArchive() {
      throw new Error('excelImport 不应调用 clearArchive')
    },
    // spec 03 §7 的 migrate_archive('0' → 真实 uid)是后续用户确认编排(T11)的事,
    // 本模块只负责哨兵创建与并入
    async migrateArchive() {
      throw new Error('excelImport 不应调用 migrateArchive')
    },
    async listArchives() {
      listArchivesCalls.push(1)
      return archiveUids.map((uid) => ({ uid, createdAt: '', lastSyncedAt: null }))
    },
    async ensureArchive(uid) {
      ensureCalls.push(uid)
      if (!archiveUids.includes(uid)) archiveUids.push(uid)
    },
  }
  return { storage, db, archiveUids, ensureCalls, listArchivesCalls, insertedBatches, identityUpdates }
}

// ---------------------------------------------------------------------------
// 断言辅助
// ---------------------------------------------------------------------------

function countByGachaType(records: readonly WishRecord[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const record of records) {
    counts.set(record.gachaType, (counts.get(record.gachaType) ?? 0) + 1)
  }
  return counts
}

/** 取某类 WARNING 的逐条明细(无该组时为空) */
function groupOf(parse: ExcelParseResult, kind: ExcelWarningKind): ExcelIssue[] {
  const group = parse.issues.warnings.find((item) => item.kind === kind)
  return group === undefined ? [] : group.issues
}

function expectAscending(records: readonly WishRecord[]): void {
  for (let index = 1; index < records.length; index++) {
    expect(records[index].time >= records[index - 1].time).toBe(true)
  }
}

// ---------------------------------------------------------------------------
// G1–G10(spec 03 §8)
// ---------------------------------------------------------------------------

describe('excelImport(spec 03 §3–§7)', () => {
  it('G1 合成五表:全字段归一正确,总条数/池分布正确(含十连同秒双四星)', () => {
    const parse = parseWorkbook(buildSampleWorkbook())

    // 干净样本零问题
    expect(parse.issues).toEqual({ errors: [], warnings: [] })
    expect(parse.records).toHaveLength(22)

    // 每表一块的预览 VM(池名官方用语;角色活动表拆 301/400 重建条数)
    expect(parse.sheets).toEqual([
      {
        sheetName: '角色活动祈愿',
        poolLabel: '角色活动祈愿',
        gachaType: 301,
        gachaTypeCounts: [{ gachaType: 301, count: 13 }, { gachaType: 400, count: 1 }],
        rowCount: 14,
        timeRange: { start: timeAt(1, 8, 0, 0), end: TEN_PULL_TIME },
        fiveStarCount: 2,
      },
      {
        sheetName: '武器活动祈愿',
        poolLabel: '武器活动祈愿',
        gachaType: 302,
        gachaTypeCounts: [{ gachaType: 302, count: 3 }],
        rowCount: 3,
        timeRange: { start: timeAt(2, 9, 0, 1), end: timeAt(2, 9, 0, 3) },
        fiveStarCount: 1,
      },
      {
        sheetName: '常驻祈愿',
        poolLabel: '常驻祈愿',
        gachaType: 200,
        gachaTypeCounts: [{ gachaType: 200, count: 2 }],
        rowCount: 2,
        timeRange: { start: timeAt(1, 9, 0, 0), end: timeAt(1, 9, 0, 1) },
        fiveStarCount: 1,
      },
      {
        sheetName: '集录祈愿',
        poolLabel: '集录祈愿',
        gachaType: 500,
        gachaTypeCounts: [{ gachaType: 500, count: 1 }],
        rowCount: 1,
        timeRange: { start: timeAt(3, 11, 0, 0), end: timeAt(3, 11, 0, 0) },
        fiveStarCount: 1,
      },
      {
        sheetName: '新手祈愿',
        poolLabel: '新手祈愿',
        gachaType: 100,
        gachaTypeCounts: [{ gachaType: 100, count: 2 }],
        rowCount: 2,
        timeRange: { start: timeAt(1, 7, 0, 0), end: timeAt(1, 7, 0, 1) },
        fiveStarCount: 0,
      },
    ])

    // 池分布(301/400 重建、其余按表映射)
    const counts = countByGachaType(parse.records)
    expect(counts.get(301)).toBe(13)
    expect(counts.get(400)).toBe(1)
    expect(counts.get(302)).toBe(3)
    expect(counts.get(200)).toBe(2)
    expect(counts.get(500)).toBe(1)
    expect(counts.get(100)).toBe(2)

    // 全字段归一:名称去空白、星级文本容忍、备注重建 400、id 恒 null、时间原串
    expect(parse.records.find((row) => row.name === '行秋')).toEqual({
      gachaType: 301,
      time: timeAt(1, 8, 0, 0),
      name: '行秋',
      rankType: 4,
      id: null,
    })
    expect(parse.records.find((row) => row.name === '那维莱特')?.gachaType).toBe(400)
    expect(parse.records.every((row) => row.id === null)).toBe(true)

    // 十连同秒:同秒 10 行以行序为先后(稳定),总次数/保底内随表连续(V1/V2 零告警)
    const tenPull = parse.records.filter((row) => row.time === TEN_PULL_TIME)
    expect(tenPull.map((row) => row.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `十连${index + 1}号`),
    )
    expect(tenPull.filter((row) => row.rankType === 4)).toHaveLength(2)

    // D4:全文件时间升序交付
    expectAscending(parse.records)
  })

  it('G2 表名映射五值精确匹配;未识别表进 V6 不导入;空表计 0;全空行跳过', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventChar, [
        ...makeRows([
          { time: timeAt(1), name: '甲', rank: 4 },
          { time: timeAt(2), name: '乙', rank: 4 },
        ]),
        [nullCell(), nullCell(), nullCell(), nullCell(), nullCell(), nullCell(), nullCell()], // 全空行
      ]),
      // 含官方名前缀的表(模糊/包含匹配禁令)与完全陌生的表都按未识别处理
      makeSheet('角色活动祈愿-2', makeRows([{ time: timeAt(3), name: '伪表行', rank: 5 }])),
      makeSheet('自定义数据', makeRows([
        { time: timeAt(3, 1), name: 'x1', rank: 3 },
        { time: timeAt(3, 2), name: 'x2', rank: 3 },
        { time: timeAt(3, 3), name: 'x3', rank: 3 },
      ])),
      makeSheet(FIXTURE_SHEETS.standard, []), // 空表(仅表头)合法
      { name: FIXTURE_SHEETS.chronicled, rows: [] }, // 整表零行同视为合法空表
    ])
    const parse = parseWorkbook(wb)

    // 只导入已识别表;五表映射的其余四值已由 G1 的池分布覆盖,这里钉 301
    expect(parse.records.map((row) => row.gachaType)).toEqual([301, 301])
    expect(parse.issues.errors).toEqual([])

    // V6:列出表名与数据行数,不导入、不静默丢弃
    const unknown = groupOf(parse, 'unknownSheet')
    expect(unknown.map((issue) => [issue.sheetName, issue.row])).toEqual([
      ['角色活动祈愿-2', null],
      ['自定义数据', null],
    ])
    expect(unknown[0].message).toContain('角色活动祈愿-2')
    expect(unknown[0].message).toContain('1 行')
    expect(unknown[1].message).toContain('3 行')

    // 空表(仅表头)与整表零行都合法计 0 行、零问题
    const standard = parse.sheets.find((block) => block.sheetName === FIXTURE_SHEETS.standard)
    expect(standard).toEqual({
      sheetName: '常驻祈愿',
      poolLabel: '常驻祈愿',
      gachaType: 200,
      gachaTypeCounts: [],
      rowCount: 0,
      timeRange: { start: null, end: null },
      fiveStarCount: 0,
    })
    expect(parse.sheets.find((block) => block.sheetName === FIXTURE_SHEETS.chronicled)?.rowCount).toBe(0)
    expect(parse.issues.warnings.find((group) => group.kind === 'unknownSheet')?.issues.some((issue) => issue.sheetName === FIXTURE_SHEETS.chronicled)).toBe(false)
  })

  it('G3 表头错序/缺列 → D2 整表 ERROR,不导入;其余表照常', () => {
    const swappedHeader = [
      sCell('时间'), sCell('名称'), sCell('星级'), sCell('类别'),
      sCell('总次数'), sCell('保底内'), sCell('备注'),
    ]
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventChar, makeRows([{ time: timeAt(1), name: '好行', rank: 4 }])),
      {
        name: FIXTURE_SHEETS.eventWeapon,
        rows: [swappedHeader, ...makeRows([{ time: timeAt(1), name: '错序表行', category: '武器', rank: 4 }])],
      },
      {
        name: FIXTURE_SHEETS.standard,
        rows: [
          headerRow().slice(0, 6),
          ...makeRows([{ time: timeAt(1), name: '缺列表行', rank: 4 }]).map((row) => row.slice(0, 6)),
        ],
      },
    ])
    const parse = parseWorkbook(wb)

    expect(parse.issues.errors.map((issue) => [issue.kind, issue.sheetName])).toEqual([
      ['header', '武器活动祈愿'],
      ['header', '常驻祈愿'],
    ])
    expect(parse.issues.errors[0].message).toContain('表头')
    // 整表不导入:两坏表零行,好表照常
    expect(parse.records.map((row) => row.name)).toEqual(['好行'])
    expect(parse.sheets.find((block) => block.sheetName === FIXTURE_SHEETS.eventWeapon)?.rowCount).toBe(0)
    expect(parse.sheets.find((block) => block.sheetName === FIXTURE_SHEETS.standard)?.rowCount).toBe(0)
  })

  it('G4 行级归一错误(时间数值型/格式、星级 2/6、类别第三种、名称空白、公式错误)→ ERROR 行不导入,其余照常;一行多错合并', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventChar, makeRows([
        { time: timeAt(1), name: '好行一', rank: 4 },
        { time: timeAt(1), name: '时间数值', rank: 3, override: { 0: nCell(44563.5) } },
        { time: timeAt(1), name: '时间格式', rank: 3, override: { 0: sCell('2026/01/02 12:00:00') } },
        { time: timeAt(1), name: '星级低', rank: 3, override: { 3: nCell(2) } },
        { time: timeAt(1), name: '星级高', rank: 3, override: { 3: nCell(6) } },
        { time: timeAt(1), name: '类别怪', rank: 3, override: { 2: sCell('圣遗物') } },
        { time: timeAt(1), name: '名称空白', rank: 3, override: { 1: sCell('  ') } },
        // 一行三错:时间 + 星级 + 保底内
        { time: timeAt(1), name: '多错行', rank: 3, override: { 0: sCell('abc'), 3: nCell(6), 5: nCell(0) } },
        { time: timeAt(1), name: '公式错误', rank: 3, override: { 1: eCell('#REF!') } },
        { time: timeAt(1), name: '好行二', rank: 4 },
      ])),
    ])
    const parse = parseWorkbook(wb)

    // 8 个坏行各一条 ERROR(物理行号 3..10),一行多错合并进同一条
    expect(parse.issues.errors).toHaveLength(8)
    expect(parse.issues.errors.map((issue) => issue.row)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(parse.issues.errors.every((issue) => issue.kind === 'row')).toBe(true)
    const numeric = parse.issues.errors.find((issue) => issue.row === 3)
    expect(numeric?.message).toContain('数值/日期型')
    expect(numeric?.message).toContain('改为文本')
    const multi = parse.issues.errors.find((issue) => issue.row === 9)
    expect(multi?.message).toContain('；')
    expect(multi?.message).toContain('时间')
    expect(multi?.message).toContain('星级')
    expect(multi?.message).toContain('保底内')

    // ERROR 行绝不入库,其余行照常(不因个别行放弃整表)
    expect(parse.records.map((row) => row.name)).toEqual(['好行一', '好行二'])
  })

  it('G5 备注重建:祈愿2→400、空→301、异常值 WARNING 按 301;非角色活动表备注忽略', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventChar, makeRows([
        { time: timeAt(1), name: '空备注', rank: 4 },
        { time: timeAt(2), name: '二池', rank: 5, remark: '祈愿2' },
        { time: timeAt(3), name: '乱备注', rank: 3, remark: '写错了' },
        { time: timeAt(4), name: '带空格二池', rank: 3, remark: ' 祈愿2 ' },
      ])),
      makeSheet(FIXTURE_SHEETS.eventWeapon, makeRows([
        { time: timeAt(5), name: '武器表带备注', category: '武器', rank: 4, remark: '祈愿2' },
      ])),
      makeSheet(FIXTURE_SHEETS.standard, makeRows([
        { time: timeAt(6), name: '常驻表带备注', rank: 3, remark: '祈愿2' },
      ])),
    ])
    const parse = parseWorkbook(wb)

    expect(parse.records.map((row) => [row.name, row.gachaType])).toEqual([
      ['空备注', 301],
      ['二池', 400],
      ['乱备注', 301],
      ['带空格二池', 400],
      ['武器表带备注', 302],
      ['常驻表带备注', 200],
    ])
    // 仅角色活动表的异常备注告警(物理行 4);其他表的备注列静默忽略
    const remark = groupOf(parse, 'remark')
    expect(remark).toHaveLength(1)
    expect(remark[0].sheetName).toBe(FIXTURE_SHEETS.eventChar)
    expect(remark[0].row).toBe(4)
    expect(remark[0].message).toContain('301')
  })

  it('G6-V1 总次数缺号/重复在断点处报告,WARNING 放行', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.standard, makeRows([
        { time: timeAt(1, 0, 0, 0), name: '缺号前1', rank: 4, count: 1 },
        { time: timeAt(1, 0, 0, 1), name: '缺号前2', rank: 4, count: 2 },
        { time: timeAt(1, 0, 0, 2), name: '缺号行', rank: 4, count: 4 },
        { time: timeAt(1, 0, 0, 3), name: '缺号后续', rank: 4, count: 5 },
      ])),
      makeSheet(FIXTURE_SHEETS.chronicled, makeRows([
        { time: timeAt(2, 0, 0, 0), name: '重复1', rank: 4, count: 1 },
        { time: timeAt(2, 0, 0, 1), name: '重复2', rank: 4, count: 2 },
        { time: timeAt(2, 0, 0, 2), name: '重复3', rank: 4, count: 2 },
        { time: timeAt(2, 0, 0, 3), name: '重复4', rank: 4, count: 3 },
      ])),
    ])
    const parse = parseWorkbook(wb)

    const gaps = groupOf(parse, 'countGap')
    expect(gaps.map((issue) => [issue.sheetName, issue.row])).toEqual([
      ['常驻祈愿', 4],
      ['集录祈愿', 4],
    ])
    expect(gaps[0].message).toContain('应为 3')
    expect(gaps[0].message).toContain('实际 4')
    expect(gaps[1].message).toContain('应为 3')
    expect(gaps[1].message).toContain('实际 2')
    // WARNING 放行:8 行全部导入
    expect(parse.records).toHaveLength(8)
  })

  it('G6-V2 保底内不符(五星行错值)报告行号/列值/自算值,WARNING 放行', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventWeapon, makeRows([
        { time: timeAt(1, 0, 0, 0), name: 'w1', category: '武器', rank: 4, pity: 1 },
        { time: timeAt(1, 0, 0, 1), name: 'w2', category: '武器', rank: 4, pity: 2 },
        { time: timeAt(1, 0, 0, 2), name: 'w3', category: '武器', rank: 5, pity: 9 },
        { time: timeAt(1, 0, 0, 3), name: 'w4', category: '武器', rank: 4, pity: 1 },
      ])),
    ])
    const parse = parseWorkbook(wb)

    const mismatch = groupOf(parse, 'pityMismatch')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].row).toBe(4)
    expect(mismatch[0].message).toContain('9')
    expect(mismatch[0].message).toContain('3')
    expect(parse.records).toHaveLength(4)
  })

  it('G6-V3 同名异星跨表违例 → 双方 ERROR 均不导入;同名同星同类别合法', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.standard, makeRows([
        { time: timeAt(1, 0, 0, 0), name: '迪卢克', rank: 5 },
        { time: timeAt(1, 0, 0, 1), name: '重复同名', rank: 4 },
        { time: timeAt(1, 0, 0, 2), name: '重复同名', rank: 4 },
      ])),
      makeSheet(FIXTURE_SHEETS.chronicled, makeRows([
        { time: timeAt(2, 0, 0, 0), name: '迪卢克', rank: 4 },
      ])),
    ])
    const parse = parseWorkbook(wb)

    const conflicts = parse.issues.errors.filter((issue) => issue.kind === 'nameConflict')
    expect(conflicts.map((issue) => [issue.sheetName, issue.row])).toEqual([
      ['常驻祈愿', 2],
      ['集录祈愿', 2],
    ])
    expect(conflicts[0].message).toContain('5★角色')
    expect(conflicts[0].message).toContain('4★角色')
    // 违例组整组拦下;合法的同名同星同类别(十连同名)照常导入
    expect(parse.records.map((row) => row.name)).toEqual(['重复同名', '重复同名'])
  })

  it('G6-V4 降序时间 → 报告后按 (时间, 行序) 稳定重排导入', () => {
    const wb = makeWorkbook([
      makeSheet(FIXTURE_SHEETS.novice, makeRows([
        { time: timeAt(3), name: '甲', rank: 4 },
        { time: timeAt(1), name: '乙', rank: 4 },
        { time: timeAt(1), name: '丙', rank: 4 },
        { time: timeAt(2), name: '丁', rank: 4 },
      ])),
    ])
    const parse = parseWorkbook(wb)

    const desc = groupOf(parse, 'timeDesc')
    expect(desc).toHaveLength(1)
    expect(desc[0].sheetName).toBe(FIXTURE_SHEETS.novice)
    expect(desc[0].row).toBeNull()
    // 升序重排;同秒乙/丙保持行序
    expect(parse.records.map((row) => row.name)).toEqual(['乙', '丙', '丁', '甲'])
    expectAscending(parse.records)
  })

  it('G7 保底内自算:仅五星重置,四星绝不重置(样本铁律)', () => {
    const specs: FixtureRowSpec[] = [
      { time: timeAt(1, 0, 0, 0), name: 'a', category: '武器', rank: 4, pity: 1 },
      { time: timeAt(1, 0, 0, 1), name: 'b', category: '武器', rank: 4, pity: 2 },
      { time: timeAt(1, 0, 0, 2), name: 'c', category: '武器', rank: 5, pity: 3 },
      { time: timeAt(1, 0, 0, 3), name: 'd', category: '武器', rank: 4, pity: 1 },
      { time: timeAt(1, 0, 0, 4), name: 'e', category: '武器', rank: 4, pity: 2 },
      { time: timeAt(1, 0, 0, 5), name: 'f', category: '武器', rank: 5, pity: 3 },
      { time: timeAt(1, 0, 0, 6), name: 'g', category: '武器', rank: 3, pity: 1 },
    ]
    // 全对上:五星行值 = 距上一五星行数含自身(c=3、f=3),其后一行重置 1(d=1、g=1);
    // b=2、e=2 是「四星不重置」的回归点(若四星也清零,这两行的自算会变成 1)
    const clean = parseWorkbook(makeWorkbook([makeSheet(FIXTURE_SHEETS.eventWeapon, makeRows(specs))]))
    expect(groupOf(clean, 'pityMismatch')).toEqual([])

    // 挑一行写错(四星行 d 的保底内填 5)→ 恰该行告警,自算值 1
    const corrupt = parseWorkbook(makeWorkbook([
      makeSheet(FIXTURE_SHEETS.eventWeapon, makeRows(
        specs.map((spec, index) => (index === 3 ? { ...spec, pity: 5 } : spec)),
      )),
    ]))
    const mismatch = groupOf(corrupt, 'pityMismatch')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].row).toBe(5)
    expect(mismatch[0].message).toContain('应为 1')
  })

  it('G8 预览重叠计数与导入 summary 一致(空档案/有档案两态;同 workbook 二次解析一致)', async () => {
    const wb = buildSampleWorkbook()

    // 态一:空档案 —— 重叠为 0,新增 = 全量
    const storeA = fakeStorage({}, [UID])
    const existingA = await storeA.storage.loadRecords(UID)
    const previewA = previewExcelImport(wb, existingA)
    expect(previewA.overlap).toEqual({ added: 22, skipped: 0, upgraded: 0 })
    const appliedA = await applyExcelImport(storeA.storage, wb, UID)
    expect(appliedA.summary).toEqual({ added: 22, upgraded: 0, skipped: 0 })
    expect(storeA.db.get(UID)).toHaveLength(22)

    // 态二:档案已含前 5 条(无 id 既有行)—— 5 条按重复跳过
    const firstFive = parseWorkbook(wb).records.slice(0, 5)
    const storeB = fakeStorage({ [UID]: firstFive }, [UID])
    const existingB = await storeB.storage.loadRecords(UID)
    const previewB = previewExcelImport(wb, existingB)
    expect(previewB.overlap).toEqual({ added: 17, skipped: 5, upgraded: 0 })
    const appliedB = await applyExcelImport(storeB.storage, wb, UID)
    // 预览与导入同 workbook 各自解析,数字一致(G8 钉住)
    expect(appliedB.summary).toEqual({ added: 17, upgraded: 0, skipped: 5 })
    expect(appliedB.parse.records).toEqual(previewB.records)
    expect(storeB.db.get(UID)).toHaveLength(22)

    // 未传既有记录时不做重叠预览(空档案应显式传 [])
    expect(previewExcelImport(wb).overlap).toBeNull()
  })

  it("G9 无任何档案 → 创建 '0' 哨兵并并入;有档案 → 并入当前档案,不建哨兵", async () => {
    // 无任何档案(currentUid null + listArchives 为空)
    const storeEmpty = fakeStorage()
    const applied = await applyExcelImport(storeEmpty.storage, buildSampleWorkbook(), null)
    expect(applied.createdSentinel).toBe(true)
    expect(applied.archiveUid).toBe(UNLINKED_UID)
    expect(storeEmpty.ensureCalls).toEqual(['0'])
    expect(storeEmpty.db.get(UNLINKED_UID)).toHaveLength(22)
    expect(storeEmpty.archiveUids).toContain(UNLINKED_UID)

    // 有档案:并入当前档案,零哨兵动作(§7 的 '0'→真实 uid migrate 属 T11 编排,不在此)
    const store = fakeStorage({ [UID]: [] }, [UID])
    const applied2 = await applyExcelImport(store.storage, buildSampleWorkbook(), UID)
    expect(applied2.archiveUid).toBe(UID)
    expect(applied2.createdSentinel).toBe(false)
    expect(store.ensureCalls).toEqual([])
    expect(store.identityUpdates).toEqual([]) // 迁入行恒无 id,无身份回填
    expect(store.db.get(UID)).toHaveLength(22)
  })

  it('G10 源文件只读:ExcelPort 仅读方法、解包恰好一次,解包产物全程不被改写', async () => {
    const workbook = deepFreeze(buildSampleWorkbook())
    const snapshot = JSON.parse(JSON.stringify(workbook)) as unknown
    let extractCalls = 0
    let extractedPath = ''
    const port: ExcelPort = {
      async extractWorkbook(path) {
        extractCalls += 1
        extractedPath = path
        return workbook
      },
    }
    // 端口面只暴露读:除 extractWorkbook 外不存在任何写方法(G10 的 domain 层论证:
    // 本模块不 import 任何文件/网络写端口,Rust 解包只读由 T09/G11 保证;
    // 字节哈希不变在 domain 层即「源文件字节只经 extractWorkbook 只读通道进入」)
    expect(Object.keys(port)).toEqual(['extractWorkbook'])

    const sourcePath = 'C:/Genshin Impact/祈愿历史.xlsx'
    const loaded = await port.extractWorkbook(sourcePath)
    expect(extractCalls).toBe(1)
    expect(extractedPath).toBe(sourcePath)

    // 预览与导入复用同一解包产物(workbook 深冻结:任何改写在严格模式下即抛 TypeError)
    const store = fakeStorage({}, [UID])
    previewExcelImport(loaded, [])
    await applyExcelImport(store.storage, loaded, UID)
    expect(loaded).toEqual(snapshot)
    expect(store.db.get(UID)).toHaveLength(22)
  })

  it('归一辅助:poolCategory 口径下 301/400 同桶(合并语义不因重建值分裂)', () => {
    const parse = parseWorkbook(buildSampleWorkbook())
    const keys = new Set(parse.records.map((row) => poolCategory(row.gachaType)))
    expect(keys.has('eventChar')).toBe(true)
  })
})
