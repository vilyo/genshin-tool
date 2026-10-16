/**
 * 祈愿记录模型与合并去重(spec 01 §1–§3):拉取管线(02)、Excel 迁入(03)、备份(§6)
 * 共用的数据底座。排序即权威时序:id 跨池全局单调已核实;
 * 改动须对照 spec 01 §8 的 E1–E8/E14 不变式测试。
 */
import { poolCategory } from './pools'

/** 档案中的单条祈愿记录(落库口径;字段名对齐官方返回的驼峰化) */
export interface WishRecord {
  /** gacha_type 数字(接口返回字符串 "301" 入库前归一;迁入行按工作表/备注重建) */
  gachaType: number
  /** 服务器时区本地时间串,存原样如 `2026-09-23 21:14:36`,永不转换 */
  time: string
  /** 物品名(API 强制 lang=zh-cn,故恒为中文;Excel 本为中文) */
  name: string
  /** 星级 3/4/5 */
  rankType: number
  /** 接口 19 位数字 id;迁入行为 null;TEXT 存储,比较用 BigInt */
  id: string | null
}

/** 落库行 = WishRecord + 存储序号(seq/rowid 由存储层承载,不入备份) */
export interface StoredRecord extends WishRecord {
  /** 同精确键 (gacha_type,time,name,rank_type) 内的出现序号,0 起 */
  seq: number
  /** SQLite rowid,会话内寻址用(身份回填),不导出、不备份 */
  rowid: number
}

/**
 * 全库统一时序比较器(spec 01 §2),返回 -1|0|1,依序:
 * time 字符串升序 → id 空值在前 → id 均存在按 BigInt 升序(19 位超 Number 精度,
 * 禁用 Number 比较)→ seq 升序 → 仍相等返回 0,交由稳定排序保持输入序。
 * incoming 侧的 WishRecord 无 seq,seq 参与的分支视其为相等。
 */
export function compareRecords(
  a: WishRecord & { seq?: number },
  b: WishRecord & { seq?: number },
): -1 | 0 | 1 {
  if (a.time !== b.time) return a.time < b.time ? -1 : 1
  if (a.id === null || b.id === null) {
    // 空值在前;双双无 id 落到 seq(纯迁入区以导入份数序兜底)
    if (a.id === null && b.id === null) return compareSeq(a, b)
    return a.id === null ? -1 : 1
  }
  const idA = BigInt(a.id)
  const idB = BigInt(b.id)
  if (idA !== idB) return idA < idB ? -1 : 1
  return compareSeq(a, b)
}

/** seq 升序兜底;任一侧无 seq 视为相等,由稳定排序保持输入序 */
function compareSeq(a: { seq?: number }, b: { seq?: number }): -1 | 0 | 1 {
  if (a.seq === undefined || b.seq === undefined || a.seq === b.seq) return 0
  return a.seq < b.seq ? -1 : 1
}

/** 身份回填项:既有无 id 行 rowid → 接口权威 id(类别内 code 错标时一并纠偏) */
interface IdentityUpgrade {
  rowid: number
  id: string
  gachaType?: number
}

export interface MergeResult {
  /** 合并后的全量(既有在前、新增按 incoming 序追加;回填行以新对象呈现),不改写入参 */
  records: WishRecord[]
  /** 真正新增的行(保持 incoming 序) */
  added: WishRecord[]
  /** 身份回填:既有行 rowid → { id, gachaType? } */
  upgrades: IdentityUpgrade[]
}

/**
 * 跨来源自然键:poolCategory 使 301/400 同桶(双角色池备注错标不产生重复计数,ADR-0002);
 * 完整去重键还要叠加「同键出现份数」,在 mergeRecords 内以计数表达。
 */
function naturalKey(record: WishRecord): string {
  return JSON.stringify([poolCategory(record.gachaType), record.time, record.name, record.rankType])
}

/** 回填行在输出中以新对象呈现(不改写入参) */
function applyUpgrade(row: StoredRecord, upgrade: IdentityUpgrade | undefined): StoredRecord {
  if (!upgrade) return row
  return {
    ...row,
    id: upgrade.id,
    ...(upgrade.gachaType !== undefined ? { gachaType: upgrade.gachaType } : {}),
  }
}

/**
 * 合并去重(spec 01 §3,领域层第一道闸):
 * 1. 既有侧统计自然键总份数 mult、精确 id 索引、无 id 行回填队列(组内按 §2 比较器排序);
 * 2. incoming 按行有无 id 分流——有 id 行的存在性只看精确 id(全局唯一,未命中即本地必无):
 *    命中跳过;未命中且队列非空则回填首个未回填份,类别内 code 不同一并纠偏为接口权威值;
 *    否则新增。无 id 行走份数闸门:n ≤ mult 重复跳过,超出新增;
 * 3. 份内配对确定性:有 id 迁入升序与队列 seq 序按第 k 个对齐(同键 = 同秒同名同星,
 *    份内次序即十连内次序);合并后每自然键份数只增不减。
 * 调用契约:incoming 已按 compareRecords 升序(接口 id 降序翻转、Excel 表序);
 * 函数内稳定排序仅防御,不破坏输出契约。
 */
export function mergeRecords(
  existing: readonly StoredRecord[],
  incoming: readonly WishRecord[],
): MergeResult {
  const ordered = [...incoming].sort(compareRecords)

  const mult = new Map<string, number>()
  const idIndex = new Set<string>()
  const unpaired = new Map<string, StoredRecord[]>()
  for (const row of existing) {
    const key = naturalKey(row)
    mult.set(key, (mult.get(key) ?? 0) + 1)
    if (row.id === null) {
      const queue = unpaired.get(key)
      if (queue) queue.push(row)
      else unpaired.set(key, [row])
    } else {
      idIndex.add(row.id)
    }
  }
  for (const queue of unpaired.values()) queue.sort(compareRecords)

  const added: WishRecord[] = []
  const upgrades: IdentityUpgrade[] = []
  const upgradeByRowid = new Map<number, IdentityUpgrade>()
  const noIdSeen = new Map<string, number>()

  for (const item of ordered) {
    const key = naturalKey(item)
    if (item.id !== null) {
      if (idIndex.has(item.id)) continue
      const paired = unpaired.get(key)?.shift()
      if (paired) {
        const upgrade: IdentityUpgrade = { rowid: paired.rowid, id: item.id }
        // 键已保证同类别,code 不同即为备注错标,以接口侧为权威纠偏(E6)
        if (paired.gachaType !== item.gachaType) upgrade.gachaType = item.gachaType
        upgrades.push(upgrade)
        upgradeByRowid.set(paired.rowid, upgrade)
      } else {
        // 同键两份 id 各异是合法形态(十连同名同星、分页边界),任何分支不得丢行(E3/E14②)
        added.push(item)
      }
      idIndex.add(item.id) // 防御:同一 id 本轮内只生效一次
    } else {
      const nth = (noIdSeen.get(key) ?? 0) + 1
      noIdSeen.set(key, nth)
      if (nth > (mult.get(key) ?? 0)) added.push(item)
    }
  }

  const records: WishRecord[] = [
    ...existing.map((row) => applyUpgrade(row, upgradeByRowid.get(row.rowid))),
    ...added,
  ]
  return { records, added, upgrades }
}
