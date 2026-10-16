/**
 * Excel 迁入测试的合成 fixture(spec 03:仓库内测试一律用合成样本,
 * 真实 xlsx 只做本地手动验证,绝不入库——项目规则)。
 * 产物与 Rust extract_xlsx(T09)同构:WorkbookData/SheetData/ExcelCell。
 * 数据行按 spec 03 §1 样本事实自动补齐:总次数缺省 = 表内序 1..N,
 * 保底内缺省 = 按「仅五星重置」规则自算(与 V2 同一口径,铁律:四星不重置)。
 */
import type { ExcelCell, SheetData, WorkbookData } from './excelImport'

/** 七列表头(D2 规范顺序) */
export const FIXTURE_HEADERS: readonly string[] = [
  '时间',
  '名称',
  '类别',
  '星级',
  '总次数',
  '保底内',
  '备注',
]

/** 五官方池工作表名(D1 精确匹配对象) */
export const FIXTURE_SHEETS = {
  eventChar: '角色活动祈愿',
  eventWeapon: '武器活动祈愿',
  standard: '常驻祈愿',
  chronicled: '集录祈愿',
  novice: '新手祈愿',
} as const

export const sCell = (v: string): ExcelCell => ({ t: 's', v })
export const nCell = (v: number): ExcelCell => ({ t: 'n', v })
export const bCell = (v: boolean): ExcelCell => ({ t: 'b', v })
export const eCell = (v: string): ExcelCell => ({ t: 'e', v })
export const nullCell = (): ExcelCell => ({ t: 'null', v: null })

export function headerRow(): ExcelCell[] {
  return FIXTURE_HEADERS.map((text) => sCell(text))
}

/** 时间串:`2026-01-<day> hh:mm:ss`(各段补零) */
export function timeAt(day: number, hour = 12, minute = 0, second = 0): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `2026-01-${p2(day)} ${p2(hour)}:${p2(minute)}:${p2(second)}`
}

/** 缺省时间:自 2026-01-01 00:00:00 起按行序每行 +1 秒(60 进位) */
function autoTime(index: number): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const hour = Math.floor(index / 3600)
  const minute = Math.floor(index / 60) % 60
  const second = index % 60
  return `2026-01-01 ${p2(hour)}:${p2(minute)}:${p2(second)}`
}

export interface FixtureRowSpec {
  /** 缺省按行序自动生成(autoTime) */
  time?: string
  /** 缺省 `物品<序>` */
  name?: string
  /** 缺省「角色」;武器表请显式传「武器」 */
  category?: string
  /** 缺省 3 */
  rank?: number
  /** 缺省 = 表内序(index+1) */
  count?: number
  /** 缺省 = 按「仅五星重置」自算 */
  pity?: number
  /** 缺省/ null = 空备注(null 单元格);字符串 = 文本备注 */
  remark?: string | null
  /** 按列下标(0..6)覆盖单元格——错误注入用(如时间数值型、星级 6、'e' 公式错误) */
  override?: Record<number, ExcelCell>
}

/** 依 spec 列表构造数据行(不含表头);保底内计数器跨行连续推进 */
export function makeRows(specs: readonly FixtureRowSpec[]): ExcelCell[][] {
  let pity = 0
  return specs.map((spec, index) => {
    const rank = spec.rank ?? 3
    pity += 1
    const pityValue = spec.pity ?? pity
    if (rank === 5) pity = 0 // 仅五星重置;四星不重置
    const remark = spec.remark === undefined || spec.remark === null ? nullCell() : sCell(spec.remark)
    const cells: ExcelCell[] = [
      sCell(spec.time ?? autoTime(index)),
      sCell(spec.name ?? `物品${index + 1}`),
      sCell(spec.category ?? '角色'),
      nCell(rank),
      nCell(spec.count ?? index + 1),
      nCell(pityValue),
      remark,
    ]
    if (spec.override !== undefined) {
      for (const [column, cell] of Object.entries(spec.override)) {
        cells[Number(column)] = cell
      }
    }
    return cells
  })
}

/** 整表 = 表头 + 数据行 */
export function makeSheet(name: string, rows: readonly ExcelCell[][]): SheetData {
  return { name, rows: [headerRow(), ...rows.map((row) => [...row])] }
}

export function makeWorkbook(sheets: readonly SheetData[]): WorkbookData {
  return { sheets: sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.map((row) => [...row]) })) }
}

/** 深冻结(G10 只读断言):解析/预览/导入全程不得改写解包产物;改写即抛 TypeError */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
