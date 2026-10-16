/**
 * Excel 历史迁入语义层(spec 03 §3–§7 / ADR-0004):D1 表名映射、D2 表头校验、
 * D3 行归一、D4 导出行模型、V1–V6 校验清单、§5 预览 VM 与 §6/§7 合并编排。
 * 解包经 ExcelPort 注入(Rust extract_xlsx,T09),存储经 StoragePort 注入;
 * 解析为纯函数且不改写入参 WorkbookData——源文件只读纪律(G10):
 * 本模块没有任何文件/网络写路径,预览与导入共用同一份解包产物的确定性解析。
 */
import { poolLabel } from './pools'
import { mergeRecords } from './records'
import type { StoredRecord, WishRecord } from './records'
import type { StoragePort } from './ports'

/** 中性单元格类型标记(与 Rust ExcelCell 的 t 一致;'e' = 公式错误如 #REF!) */
export type ExcelCellType = 's' | 'n' | 'b' | 'e' | 'null'

/** 中性单元格(ADR-0004):t 标记类型,v 为原始 JSON 值(Rust 侧类型保真) */
export interface ExcelCell {
  t: ExcelCellType
  v: string | number | boolean | null
}

/** 一张工作表:表名 + 全部行(首行为表头;行内可能短于七列,按缺格处理) */
export interface SheetData {
  name: string
  rows: ExcelCell[][]
}

/** 整个工作簿(spec 03 §2:`{ sheets: [{ name, rows }] }`,表序 = 工作簿内顺序) */
export interface WorkbookData {
  sheets: SheetData[]
}

/** 解包端口(T09 extract_xlsx 的 domain 面):只有读,源文件绝不写回 */
export interface ExcelPort {
  extractWorkbook(path: string): Promise<WorkbookData>
}

/** D2 规范表头(七列,顺序固定) */
export const EXCEL_HEADERS: readonly string[] = [
  '时间',
  '名称',
  '类别',
  '星级',
  '总次数',
  '保底内',
  '备注',
]

/** D3 时间列格式:文本单元格精确匹配此形态,数值/日期型一律 ERROR */
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** D1 备注列重建 400 的哨兵值(仅角色活动表消费备注列) */
const REMARK_SECOND_POOL = '祈愿2'

/**
 * D1 工作表名 → 基础 gacha_type:精确匹配,禁止模糊/包含匹配;
 * 角色活动祈愿表内再按备注拆 301/400(重建值),其余表忽略备注列。
 */
const POOL_BY_SHEET_NAME: Readonly<Record<string, number>> = {
  角色活动祈愿: 301,
  武器活动祈愿: 302,
  常驻祈愿: 200,
  集录祈愿: 500,
  新手祈愿: 100,
}

/** 唯一消费备注列做 gacha_type 重建的工作表映射值 */
const REMARK_REBUILD_BASE_CODE = 301

/** §7「未关联 UID」哨兵档案 uid(仅当无任何档案时由 applyExcelImport 创建) */
export const UNLINKED_UID = '0'

// ---------------------------------------------------------------------------
// 校验问题(V1–V6 + D2/D3)与预览 VM(spec 03 §4/§5)
// ---------------------------------------------------------------------------

/** ERROR 级问题种类:D2 表头 / D3+V5 行级 / V3 同名冲突 */
export type ExcelErrorKind = 'header' | 'row' | 'nameConflict'

/** WARNING 级问题种类:D3 备注 / V1 总次数 / V2 保底内 / V4 时间降序 / V6 未识别表 */
export type ExcelWarningKind =
  | 'remark'
  | 'countGap'
  | 'pityMismatch'
  | 'timeDesc'
  | 'unknownSheet'

export type ExcelIssueKind = ExcelErrorKind | ExcelWarningKind

/** 单条校验问题(UI 可展开;行号为工作表内物理行号,1 起含表头,表级问题为 null) */
export interface ExcelIssue {
  kind: ExcelIssueKind
  sheetName: string
  row: number | null
  /** 中文原因文案(UI 直用) */
  message: string
}

/** WARNING 分类聚合(§5:分类计数,可展开) */
export interface ExcelWarningGroup {
  kind: ExcelWarningKind
  /** 中文分类标签 */
  label: string
  count: number
  issues: ExcelIssue[]
}

export interface ExcelIssues {
  /** ERROR 全量逐条(ERROR 拦行;D2 拦整表) */
  errors: ExcelIssue[]
  /** WARNING 按类分组,组序固定 */
  warnings: ExcelWarningGroup[]
}

/** 重建 gacha_type 分布条目(角色活动表拆 301/400) */
export interface ExcelGachaTypeCount {
  gachaType: number
  count: number
}

/** §5 预览页「每表一块」 */
export interface ExcelSheetPreview {
  sheetName: string
  /** 官方池名(poolLabel);未识别工作表为 null */
  poolLabel: string | null
  /** D1 映射的基础 gacha_type(角色活动表恒为 301);未识别表为 null */
  gachaType: number | null
  /** 备注重建后的 gacha_type 分布(角色活动表拆 301/400,升序;其余表单值) */
  gachaTypeCounts: ExcelGachaTypeCount[]
  /** 实际将导入的行数(不含 ERROR 行;未识别表为数据行数,仅供 V6 展示) */
  rowCount: number
  /** 导入行的时间范围(升序首末;无行为 null) */
  timeRange: { start: string | null; end: string | null }
  /** 导入行的五星数 */
  fiveStarCount: number
}

/** §5 重叠预览(对「当前档案记录 ∪ 本次导入行」跑 mergeRecords 的三数) */
export interface ExcelOverlapPreview {
  /** 将新增条数 */
  added: number
  /** 与现有记录重叠、按重复丢弃条数(不含身份回填) */
  skipped: number
  /** 身份回填条数(迁入行恒无 id,本流程通常为 0;字段保留以对齐 §5 三数展示) */
  upgraded: number
}

/** 解析 + 校验产物(预览与导入共用;同 workbook 两次解析结果一致,G8) */
export interface ExcelParseResult {
  sheets: ExcelSheetPreview[]
  /** D4 导出行(gachaType 为重建值,id 恒 null),时间升序 */
  records: WishRecord[]
  issues: ExcelIssues
}

/** §5 预览 VM:解析产物 + 可选重叠预览(未传既有记录时 overlap 为 null) */
export interface ExcelImportPreview extends ExcelParseResult {
  overlap: ExcelOverlapPreview | null
}

/** 导入汇总(§5 导入报告:新增/回填/重复跳过;与预览 overlap 同口径) */
export interface ExcelImportSummary {
  added: number
  upgraded: number
  /** 纯重复跳过 = 导入行 − 新增 − 回填(与 backup.ts 的口径不同:回填单列不并入) */
  skipped: number
}

export interface ExcelApplyResult {
  /** 实际并入的档案 uid(currentUid 为 null 时为 UNLINKED_UID 哨兵) */
  archiveUid: string
  /** 是否为本流程创建的 '0' 哨兵档案(currentUid 为 null 且原无任何档案) */
  createdSentinel: boolean
  /** 解析校验产物(§5 导入报告复用,数字与预览一致,G8 钉住) */
  parse: ExcelParseResult
  summary: ExcelImportSummary
}

const WARNING_LABELS: Readonly<Record<ExcelWarningKind, string>> = {
  remark: '备注无法识别(已按角色活动祈愿导入)',
  countGap: '总次数不连续',
  pityMismatch: '保底内与自算不符',
  timeDesc: '时间非升序(已重排)',
  unknownSheet: '未识别的工作表(不导入)',
}

/** WARNING 分组展示顺序 */
const WARNING_ORDER: readonly ExcelWarningKind[] = [
  'remark',
  'countGap',
  'pityMismatch',
  'timeDesc',
  'unknownSheet',
]

// ---------------------------------------------------------------------------
// 单元格读取与归一辅助
// ---------------------------------------------------------------------------

type MaybeCell = ExcelCell | undefined

/** 文本值(t==='s');其余类型(含缺格)返回 null */
function textCell(cell: MaybeCell): string | null {
  return cell !== undefined && cell.t === 's' && typeof cell.v === 'string' ? cell.v : null
}

/** 空单元格:缺格 / null 格 / 纯空白文本(全空行与空备注的判定口径) */
function isBlankCell(cell: MaybeCell): boolean {
  if (cell === undefined || cell.t === 'null') return true
  const text = textCell(cell)
  return text !== null && text.trim() === ''
}

/** 单元格值的消息化展示(空/异常类型均有可读形态) */
function cellDisplay(cell: MaybeCell): string {
  if (cell === undefined || cell.t === 'null') return '(空)'
  if (cell.t === 'e') return typeof cell.v === 'string' ? cell.v : '(公式错误)'
  if (cell.t === 'b') return (cell.v === true ? 'TRUE' : 'FALSE')
  if (cell.t === 'n') return typeof cell.v === 'number' ? String(cell.v) : '(数值)'
  const text = typeof cell.v === 'string' ? cell.v : ''
  return text === '' ? '(空)' : text
}

/** 星级归一:整数单元格 3/4/5;文本数字容忍归一(spec D3 注记),其余 null */
function normalizeRank(cell: MaybeCell): number | null {
  const parse = (value: number): number | null =>
    value === 3 || value === 4 || value === 5 ? value : null
  if (cell !== undefined && cell.t === 'n' && typeof cell.v === 'number') {
    return Number.isInteger(cell.v) ? parse(cell.v) : null
  }
  const text = textCell(cell)
  if (text !== null) {
    const parsed = Number(text.trim())
    if (Number.isInteger(parsed)) return parse(parsed)
  }
  return null
}

/** 总次数/保底内:正整数数值单元格(spec D3 仅星级注记文本容忍,此两列从严) */
function positiveIntCell(cell: MaybeCell): number | null {
  if (cell === undefined || cell.t !== 'n' || typeof cell.v !== 'number') return null
  return Number.isInteger(cell.v) && cell.v >= 1 ? cell.v : null
}

/** D2 表头校验:首行(去尾部空格后)逐列精确等于七列,顺序固定 */
function headerMatches(row: readonly ExcelCell[] | undefined): boolean {
  if (row === undefined) return false
  let end = row.length
  while (end > 0 && isBlankCell(row[end - 1])) end -= 1
  if (end !== EXCEL_HEADERS.length) return false
  return EXCEL_HEADERS.every((expected, index) => textCell(row[index]) === expected)
}

// ---------------------------------------------------------------------------
// 解析管线(D1→D2→D3→V3→V4→V1→V2→D4)
// ---------------------------------------------------------------------------

/** D3 归一后的候选行(已过行级 ERROR;是否导入还看 V3 冲突) */
interface CandidateRow {
  sheetName: string
  /** 工作表内物理行号(1 起含表头;首条数据行 = 2) */
  row: number
  /** 表内物理序(V4 稳定排序的同秒 tie-break) */
  order: number
  gachaType: number
  time: string
  name: string
  category: string
  rankType: number
  count: number
  pity: number
}

/** D3 单行归一产物:fields 为 null 当且仅当该行有 ERROR */
interface RowOutcome {
  fields: Omit<CandidateRow, 'sheetName' | 'row' | 'order'> | null
  errors: string[]
  remarkWarning: string | null
}

/** D3 逐列归一(spec 03 §3 表;一行多错合并为一个 errors 列表) */
function normalizeRow(row: readonly ExcelCell[], baseCode: number): RowOutcome {
  const errors: string[] = []
  const at = (index: number): MaybeCell => row[index]

  // 时间:须为文本且匹配格式;数值/日期型提示改为文本
  const time = textCell(at(0))
  if (time === null) {
    const timeCell = at(0)
    if (timeCell !== undefined && timeCell.t === 'n') {
      errors.push(
        `「时间」为数值/日期型单元格(值 ${cellDisplay(at(0))}),请改为文本格式(YYYY-MM-DD HH:MM:SS)`,
      )
    } else {
      errors.push(`「时间」不是 YYYY-MM-DD HH:MM:SS 格式的文本(值 ${cellDisplay(at(0))})`)
    }
  } else if (!TIME_PATTERN.test(time)) {
    errors.push(`「时间」不是 YYYY-MM-DD HH:MM:SS 格式的文本(值 ${time})`)
  }

  // 名称:非空文本,去首尾空白
  const nameText = textCell(at(1))
  const name = nameText !== null ? nameText.trim() : null
  if (name === null || name === '') {
    errors.push(`「名称」为空或不是文本(值 ${cellDisplay(at(1))})`)
  }

  // 类别:仅 校验+V3 一致性,不参与池判定
  const category = textCell(at(2))
  if (category !== '角色' && category !== '武器') {
    errors.push(`「类别」须为「角色」或「武器」(值 ${cellDisplay(at(2))})`)
  }

  const rankType = normalizeRank(at(3))
  if (rankType === null) errors.push(`「星级」须为 3/4/5 的整数(值 ${cellDisplay(at(3))})`)

  const count = positiveIntCell(at(4))
  if (count === null) errors.push(`「总次数」须为正整数(值 ${cellDisplay(at(4))})`)

  const pity = positiveIntCell(at(5))
  if (pity === null) errors.push(`「保底内」须为正整数(值 ${cellDisplay(at(5))})`)

  // 备注:仅角色活动表参与重建(空→301、祈愿2→400、其他→WARNING 按 301);其余表忽略
  let gachaType = baseCode
  let remarkWarning: string | null = null
  if (baseCode === REMARK_REBUILD_BASE_CODE && !isBlankCell(at(6))) {
    const remark = textCell(at(6))
    if (remark !== null && remark.trim() === REMARK_SECOND_POOL) {
      gachaType = 400
    } else {
      remarkWarning = `「备注」无法识别(值 ${cellDisplay(at(6))}),已按「角色活动祈愿」(301)导入`
    }
  }

  // 任一检查失败(含值错误:格式/取值不符,其字段并非 null)→ 整行 ERROR
  if (errors.length > 0 || time === null || name === null || category === null || rankType === null || count === null || pity === null) {
    return { fields: null, errors, remarkWarning: null }
  }
  return {
    fields: { gachaType, time, name, category, rankType, count, pity },
    errors,
    remarkWarning,
  }
}

/** D4 行模型:重建 gacha_type + 原串时间,id 恒 null(seq 由合并/存储层分配) */
function toRecord(row: CandidateRow): WishRecord {
  return {
    gachaType: row.gachaType,
    time: row.time,
    name: row.name,
    rankType: row.rankType,
    id: null,
  }
}

/** 解析一张已识别表的候选行(D2 表头已过;全空行跳过;行级 ERROR 逐条上报) */
function collectCandidates(sheet: SheetData, baseCode: number, errors: ExcelIssue[], warnings: ExcelIssue[]): CandidateRow[] {
  const candidates: CandidateRow[] = []
  for (let index = 1; index < sheet.rows.length; index++) {
    const physicalRow = index + 1
    const row = sheet.rows[index]
    if (row.every((cell) => isBlankCell(cell))) continue // 全空行跳过
    const outcome = normalizeRow(row, baseCode)
    if (outcome.fields === null) {
      errors.push({
        kind: 'row',
        sheetName: sheet.name,
        row: physicalRow,
        message: outcome.errors.join('；'),
      })
      continue
    }
    candidates.push({ ...outcome.fields, sheetName: sheet.name, row: physicalRow, order: index })
    if (outcome.remarkWarning !== null) {
      warnings.push({
        kind: 'remark',
        sheetName: sheet.name,
        row: physicalRow,
        message: outcome.remarkWarning,
      })
    }
  }
  return candidates
}

/**
 * 解析 + 全量校验(spec 03 §3–§4):纯函数,不改写 workbook。
 * 顺序:D1 分表 → D2 表头 → D3 行归一 → V3 同名唯一(跨全文件)→
 * 每表 V4 时间排序 → V1 总次数连续 → V2 保底内自算比对 → D4 输出。
 */
export function parseWorkbook(workbook: WorkbookData): ExcelParseResult {
  const errors: ExcelIssue[] = []
  const warnings: ExcelIssue[] = []

  interface SheetWork {
    sheetName: string
    baseCode: number | null
    /** 未识别表的展示行数(V6);已识别表走 candidates */
    unknownRowCount: number
    candidates: CandidateRow[]
  }

  const works: SheetWork[] = []

  // D1 + D2 + D3
  for (const sheet of workbook.sheets) {
    const baseCode = POOL_BY_SHEET_NAME[sheet.name]
    if (baseCode === undefined) {
      // V6:未识别表名 → 报告列出(表名 + 数据行数),不导入、不静默丢弃
      const dataRowCount = sheet.rows.length > 0 ? sheet.rows.length - 1 : 0
      warnings.push({
        kind: 'unknownSheet',
        sheetName: sheet.name,
        row: null,
        message: `未识别的工作表「${sheet.name}」(${dataRowCount} 行),不导入`,
      })
      works.push({ sheetName: sheet.name, baseCode: null, unknownRowCount: dataRowCount, candidates: [] })
      continue
    }
    if (sheet.rows.length === 0) {
      // 整表零行(连表头都没有):与「仅表头的空表」同视为合法空表,计 0 行
      works.push({ sheetName: sheet.name, baseCode, unknownRowCount: 0, candidates: [] })
      continue
    }
    if (!headerMatches(sheet.rows[0])) {
      // D2:表头不符 → 整表 ERROR,不导入
      errors.push({
        kind: 'header',
        sheetName: sheet.name,
        row: sheet.rows.length > 0 ? 1 : null,
        message: `表头与规范不符(须为「${EXCEL_HEADERS.join(' ')}」七列且顺序一致),整表不导入`,
      })
      works.push({ sheetName: sheet.name, baseCode, unknownRowCount: 0, candidates: [] })
      continue
    }
    works.push({
      sheetName: sheet.name,
      baseCode,
      unknownRowCount: 0,
      candidates: collectCandidates(sheet, baseCode, errors, warnings),
    })
  }

  // V3:同名物品星级、类别跨全文件唯一;违例即数据损坏,同名组各行全部 ERROR
  const byName = new Map<string, CandidateRow[]>()
  for (const work of works) {
    for (const candidate of work.candidates) {
      const group = byName.get(candidate.name)
      if (group === undefined) byName.set(candidate.name, [candidate])
      else group.push(candidate)
    }
  }
  const conflicted = new Set<CandidateRow>()
  for (const group of byName.values()) {
    const variants = new Set(group.map((row) => `${row.rankType}★${row.category}`))
    if (variants.size <= 1) continue
    const summary = [...variants].join(' / ')
    for (const row of group) {
      conflicted.add(row)
      errors.push({
        kind: 'nameConflict',
        sheetName: row.sheetName,
        row: row.row,
        message: `同名物品「${row.name}」星级/类别不一致(${summary}),相关行均不导入`,
      })
    }
  }

  const blocks: ExcelSheetPreview[] = []
  const allRecords: WishRecord[] = []

  for (const work of works) {
    if (work.baseCode === null) {
      blocks.push({
        sheetName: work.sheetName,
        poolLabel: null,
        gachaType: null,
        gachaTypeCounts: [],
        rowCount: work.unknownRowCount,
        timeRange: { start: null, end: null },
        fiveStarCount: 0,
      })
      continue
    }

    // V3 剔除后进入逐表时序校验(校验只对真正要导入的行,口径与统计一致)
    const candidates = work.candidates.filter((row) => !conflicted.has(row))

    // V4:时间非降序;降序 → 报告后按 (时间, 行序) 稳定重排(同秒先后以行序为准)
    const outOfOrder = candidates.some((row, index) => index > 0 && row.time < candidates[index - 1].time)
    if (outOfOrder) {
      warnings.push({
        kind: 'timeDesc',
        sheetName: work.sheetName,
        row: null,
        message: '表内时间存在降序,已按时间升序重排后导入(同秒先后以行序为准)',
      })
      candidates.sort((a, b) => (a.time === b.time ? a.order - b.order : a.time < b.time ? -1 : 1))
    }

    // V1:总次数表内 1..N 严格递增(缺号/重复/乱序在断点处报告,WARNING 放行)
    let expectedCount = 1
    for (const row of candidates) {
      if (row.count !== expectedCount) {
        warnings.push({
          kind: 'countGap',
          sheetName: work.sheetName,
          row: row.row,
          message: `总次数不连续:此处应为 ${expectedCount},实际 ${row.count}(疑似漏记或误录)`,
        })
      }
      expectedCount = row.count + 1
    }

    // V2:保底内自算比对 —— 仅五星重置(五星行值 = 距上一五星行数含自身,
    // 其后一行重置 1;四星绝不重置),自算基于排序后的行序,统计一律以自算为准
    let pityRun = 0
    for (const row of candidates) {
      pityRun += 1
      if (row.pity !== pityRun) {
        warnings.push({
          kind: 'pityMismatch',
          sheetName: work.sheetName,
          row: row.row,
          message: `保底内不符:列值 ${row.pity},按「仅五星重置」自算应为 ${pityRun}`,
        })
      }
      if (row.rankType === 5) pityRun = 0
    }

    const records = candidates.map(toRecord)
    allRecords.push(...records)

    const counts = new Map<number, number>()
    for (const row of candidates) counts.set(row.gachaType, (counts.get(row.gachaType) ?? 0) + 1)
    blocks.push({
      sheetName: work.sheetName,
      poolLabel: poolLabel(work.baseCode),
      gachaType: work.baseCode,
      gachaTypeCounts: [...counts.entries()]
        .map(([gachaType, count]) => ({ gachaType, count }))
        .sort((a, b) => a.gachaType - b.gachaType),
      rowCount: records.length,
      timeRange: {
        start: records.length > 0 ? records[0].time : null,
        end: records.length > 0 ? records[records.length - 1].time : null,
      },
      fiveStarCount: candidates.filter((row) => row.rankType === 5).length,
    })
  }

  // D4:全文件时间升序交付合并层(表序拼接后稳定排序,同秒保持表内先后)
  const records = allRecords.sort((a, b) => (a.time === b.time ? 0 : a.time < b.time ? -1 : 1))

  const warningGroups = WARNING_ORDER.flatMap((kind) => {
    const issues = warnings.filter((issue) => issue.kind === kind)
    return issues.length === 0
      ? []
      : [{ kind, label: WARNING_LABELS[kind], count: issues.length, issues }]
  })

  return { sheets: blocks, records, issues: { errors, warnings: warningGroups } }
}

// ---------------------------------------------------------------------------
// 预览(§5)与合并编排(§6/§7)
// ---------------------------------------------------------------------------

/** 对「既有记录 ∪ 导入行」跑 spec 01 mergeRecords,产出三数重叠预览 */
function computeOverlap(
  existing: readonly StoredRecord[],
  incoming: readonly WishRecord[],
): ExcelOverlapPreview {
  const merge = mergeRecords(existing, incoming)
  return {
    added: merge.added.length,
    skipped: incoming.length - merge.added.length - merge.upgrades.length,
    upgraded: merge.upgrades.length,
  }
}

/**
 * §5 导入预览:解析产物 + 可选重叠预览。
 * existing 由调用方经 StoragePort.loadRecords 取当前档案后传入;不传时 overlap 为 null
 * (空档案传 [] 即得全零重叠)。与 applyExcelImport 共用同一确定性解析(G8)。
 */
export function previewExcelImport(
  workbook: WorkbookData,
  existing?: readonly StoredRecord[],
): ExcelImportPreview {
  const parse = parseWorkbook(workbook)
  return { ...parse, overlap: existing === undefined ? null : computeOverlap(existing, parse.records) }
}

/**
 * §6/§7 合并编排:解析 → 并入档案(currentUid 为 null 时走 '0' 哨兵)→ 返回汇总。
 * - 归属当前档案;迁入行先经 spec 01 mergeRecords(类别级自然键 + 份数):
 *   重叠按重复丢弃、永不降级既有行;迁入行恒无 id,身份回填只发生在后续
 *   接口同步(接口行携带权威 id 回填既有无 id 行),此处 upgrades 通常为空,
 *   通道保留以对齐 §5 三数展示。
 * - §7 哨兵:「无任何档案」判定 = currentUid 为 null 且 listArchives() 为空,此时
 *   ensureArchive('0') 真正建档;ensureArchive 幂等,异常态(有档案但未选中)下仅
 *   确保 '0' 行存在,记录仍安全并入 '0',绝不静默丢弃。
 */
export async function applyExcelImport(
  storage: StoragePort,
  workbook: WorkbookData,
  currentUid: string | null,
): Promise<ExcelApplyResult> {
  const parse = parseWorkbook(workbook)

  let archiveUid: string
  let createdSentinel = false
  let existing: StoredRecord[]
  if (currentUid === null) {
    createdSentinel = (await storage.listArchives()).length === 0
    archiveUid = UNLINKED_UID
    await storage.ensureArchive(archiveUid)
    existing = await storage.loadRecords(archiveUid) // 新建哨兵为空表;已有 '0' 档案时按合并语义幂等
  } else {
    archiveUid = currentUid
    existing = await storage.loadRecords(currentUid)
  }

  const merge = mergeRecords(existing, parse.records)
  await storage.insertRecords(archiveUid, merge.added)
  await storage.updateIdentity(merge.upgrades)

  return {
    archiveUid,
    createdSentinel,
    parse,
    summary: {
      added: merge.added.length,
      upgraded: merge.upgrades.length,
      skipped: parse.records.length - merge.added.length - merge.upgrades.length,
    },
  }
}
