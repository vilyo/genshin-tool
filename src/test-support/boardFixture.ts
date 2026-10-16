/**
 * 主画面(T17)测试夹具:确定性合成档案,覆盖六个作用域与保底/歪判定/程度档的关键形态。
 * 全部记录按 +1 分钟步进生成(2026-01-01 10:00 起),比较器时序 = 生成序。
 *
 * 布局(五星行 pulls = 距上一五星的记录数,含出货那抽):
 * - eventChar(301/400):刻晴×1(首五星,不完整,歪)→ 22 填充 → 那维莱特×23(不歪)
 *   → 7 填充(400,首个四星)→ 雷电将军×8(不歪)→ 77 填充 → 迪卢克×78(歪)
 *   → 90 填充 → 莫娜×91(歪,触底)→ 30 填充(末条四星)
 *   ⇒ 共 231 条;五星 5;完整 pulls [23,8,78,91] 均值 50 → 评级 A、歪率 3/5=60% 触发
 *   修正 → 显示 B+;垫抽 30、距硬 60、四星保底 1;大保底就绪。
 * - eventWeapon(302):磐岩结绿×1(首五星,不完整占位)→ 54 填充 → 天空之翼×55
 *   → 5 填充 ⇒ 共 61 条,完整均值 55 → 评级 B(武器档 54–62)、垫抽 5。
 * - standard(200):46 填充 → 迪卢克×47(全档案第 2 次 → 名册标 C1;作用域首五星
 *   不完整,不进均值)→ 3 填充 ⇒ 50 条。
 * - novice(100):1 填充 → 琴×2 ⇒ 2 条(无保底带、不评级;作用域首五星不完整)。
 * - unknown(1000):未知之器(四星)⇒ 1 条(「未收录」页签出现 → 六页签)。
 * 档案合计 345 条;全局数据集(四作用域)342 抽 / 五星 8 / 覆盖 1 天 / 起始 2026-01。
 */
import type { StoredRecord } from '@/domain/records'
import { storedRecord } from './appFakes'

export function makeBoardRecords(): StoredRecord[] {
  let minutes = 0
  const nextTime = (): string => {
    const m = 600 + minutes++
    const day = Math.floor(m / 1440)
    const hh = String(Math.floor((m % 1440) / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10)
    return `${date} ${hh}:${mm}:00`
  }
  const out: StoredRecord[] = []
  const row = (gachaType: number, name: string, rankType: number): void => {
    out.push(storedRecord({ gachaType, name, rankType, time: nextTime(), id: null }))
  }
  const fillers = (code: number, count: number, rank = 3): void => {
    for (let i = 0; i < count; i += 1) row(code, `杂记${out.length + 1}`, rank)
  }

  // —— eventChar(301,填充中夹 400)——
  row(301, '刻晴', 5)
  fillers(301, 22)
  row(301, '那维莱特', 5)
  fillers(400, 1, 4)
  fillers(400, 6)
  row(301, '雷电将军', 5)
  fillers(301, 77)
  row(301, '迪卢克', 5)
  fillers(301, 90)
  row(301, '莫娜', 5)
  fillers(301, 29)
  row(301, '杂记终', 4)

  // —— eventWeapon / standard / novice / unknown ——
  row(302, '磐岩结绿', 5)
  fillers(302, 54)
  row(302, '天空之翼', 5)
  fillers(302, 5)
  fillers(200, 46)
  row(200, '迪卢克', 5)
  fillers(200, 3)
  fillers(100, 1)
  row(100, '琴', 5)
  row(1000, '未知之器', 4)

  return out
}
