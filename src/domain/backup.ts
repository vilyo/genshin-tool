/**
 * 备份与恢复(spec 01 §6):JSON 格式模型 + 导出/解析/导入合并。
 * 全部纯函数:导出时间由参数注入,文件读写与档案落库由调用方经 ports.ts 完成,
 * 零 Tauri/Vue 依赖;解析拒绝分支的文案供 UI 直接展示(spec 01 §6 拒绝分支)。
 */
import { compareRecords, mergeRecords, type MergeResult, type StoredRecord, type WishRecord } from './records'

/** 备份文件格式版本:结构变更时递增;导入仅接受 ≤ 当前版本 */
export const BACKUP_FORMAT_VERSION = 1

/** 备份文件大小上限(字节,spec 01 §6):文件级门禁在读文件前按真实大小拒绝,此处为解析层兜底 */
export const BACKUP_MAX_BYTES = 64 * 1024 * 1024

/** 备份文件顶层结构:uid + 全字段记录 + 导出时间 + 版本号 */
export interface BackupFile {
  /** 应用标记:防止拿任意 JSON 误导入 */
  app: 'genshintool'
  version: number
  /** 备份所属档案,导入即合并入该 uid */
  uid: string
  /** 导出时间(ISO 8601) */
  exportedAt: string
  /** 全字段记录,含 id(null 保留) */
  records: WishRecord[]
}

/**
 * 组装备份文件:records 按 spec 01 §2 比较器稳定排序(再导出字节级等价的保证,E11),不改写入参。
 * exportedAt 由参数注入保持纯函数;落盘序列化与路径选择由调用方完成。
 */
export function exportBackup(
  records: readonly WishRecord[],
  uid: string,
  nowIso: string,
): BackupFile {
  return {
    app: 'genshintool',
    version: BACKUP_FORMAT_VERSION,
    uid,
    exportedAt: nowIso,
    // 先使用存储顺序排序,再剥离 rowid/seq;数组顺序承载无 id 十连的抽序。
    records: [...records].sort(compareRecords).map(({ gachaType, time, name, rankType, id }) => ({
      gachaType, time, name, rankType, id,
    })),
  }
}

/** 备份文件名:`genshintool-backup-<uid>-<yyyyMMdd-HHmmss>.json`(本机时区,月日时分秒补零) */
export function backupFileName(uid: string, timestamp: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${timestamp.getFullYear()}${p2(timestamp.getMonth() + 1)}${p2(timestamp.getDate())}` +
    `-${p2(timestamp.getHours())}${p2(timestamp.getMinutes())}${p2(timestamp.getSeconds())}`
  return `genshintool-backup-${uid}-${stamp}.json`
}

/**
 * 解析备份文本,逐层校验,不符一律抛 Error(文案 UI 直用):
 * 大小上限 → JSON 可解析 → app 标记 → version → uid → records 数组 → 逐行字段形状。
 * 大小口径:maxBytes 为上限字节(UI 层传 BACKUP_MAX_BYTES),实测以 text.length
 * (UTF-16 码元数)近似——中文名下码元数 ≤ UTF-8 字节数,可能低估,故超限的第一道
 * 门禁在读文件前按真实文件大小,此处为解析层防御。
 */
export function parseBackup(text: string, maxBytes: number): BackupFile {
  if (text.length > maxBytes) {
    throw new Error(
      `备份文件超过大小上限(${Math.round(maxBytes / 1024 / 1024)}MB),请确认导出的文件完整`,
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是有效的 JSON,请确认选择的是本工具导出的备份文件')
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error('不是原神祈愿工具箱的备份文件')
  }
  const file = raw as Record<string, unknown>
  if (file['app'] !== 'genshintool') {
    throw new Error('不是原神祈愿工具箱的备份文件')
  }
  if (typeof file['version'] !== 'number' || file['version'] > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `备份文件版本过新(当前支持到 v${BACKUP_FORMAT_VERSION}),请先升级应用再导入`,
    )
  }
  if (typeof file['uid'] !== 'string' || file['uid'] === '') {
    throw new Error('备份文件缺少档案 UID,无法确定导入目标')
  }
  if (!Array.isArray(file['records'])) {
    throw new Error('备份文件的记录列表格式不正确,无法导入')
  }
  const records = (file['records'] as unknown[]).map(parseBackupRecord)
  return {
    app: 'genshintool',
    version: file['version'],
    uid: file['uid'],
    exportedAt: typeof file['exportedAt'] === 'string' ? file['exportedAt'] : '',
    records,
  }
}

/** 单行字段形状校验(spec 01 §6):五字段必须齐全且类型正确;id 仅接受 string|null——
 *  缺失(undefined)会击穿 compareRecords 的 BigInt 分支,不做可空兜底 */
function parseBackupRecord(raw: unknown): WishRecord {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('备份文件的记录格式不正确,无法导入')
  }
  const item = raw as Record<string, unknown>
  const gachaType = item['gachaType']
  const time = item['time']
  const name = item['name']
  const rankType = item['rankType']
  const id = item['id']
  if (
    typeof gachaType !== 'number' ||
    typeof time !== 'string' ||
    time === '' ||
    typeof name !== 'string' ||
    name === '' ||
    (rankType !== 3 && rankType !== 4 && rankType !== 5) ||
    (id !== null && typeof id !== 'string')
  ) {
    throw new Error('备份文件的记录字段不完整或类型不符(需 gachaType/time/name/rankType/id),无法导入')
  }
  return { gachaType, time, name, rankType, id }
}

/** 导入汇总计数(spec 01 §6:报告新增/回填/跳过) */
export interface BackupImportSummary {
  /** 本次真正新增条数 */
  added: number
  /** 身份回填条数(既有无 id 行被接口行回填) */
  upgraded: number
  /** 跳过条数 = 备份记录数 − 新增数(重复 + 回填) */
  skipped: number
}

/** 导入结果 = 合并底座输出(records/added/upgrades)+ 汇总计数 */
export interface BackupImportResult extends MergeResult {
  summary: BackupImportSummary
}

/**
 * 导入合并:与目标档案既有行按 spec 01 §3 mergeRecords 合并,纯函数;
 * 读写落库由调用方经 StoragePort 完成,目标档案不存在则先 ensureArchive 后以空数组调用。
 * 重复导入幂等(合并底座 E1)。
 */
export function importBackup(
  existing: readonly StoredRecord[],
  backup: BackupFile,
): BackupImportResult {
  const merge = mergeRecords(existing, backup.records)
  return {
    ...merge,
    summary: {
      added: merge.added.length,
      upgraded: merge.upgrades.length,
      skipped: backup.records.length - merge.added.length,
    },
  }
}
