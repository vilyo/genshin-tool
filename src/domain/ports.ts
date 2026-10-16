/**
 * 领域端口(spec 02 §2):拉取管线/备份/Excel 迁入的外部依赖注入面。
 * domain 内一律只依赖本文件的接口,实现层在 src/services/tauriPorts.ts(T08),
 * 测试以假实现注入——抓取与解析的每一步都是纯函数或经端口注入,可伪造单测。
 * StoragePort 方法与 src-tauri db_* 命令一一对应(T02,字段驼峰)。
 */
import type { StoredRecord, WishRecord } from './records'

/** 官方接口端口:GET 任一官方 URL,返回原始响应体文本;解析与判定在 domain。
 *  网络类失败(连接/超时/HTTP 非 2xx/返回体非 JSON)以 NetworkError 抛出
 *  (NetworkError 类型由 errors.ts 定义,T04;本文件不实现该类) */
export interface GachaApiPort {
  get(url: string): Promise<string>
}

/** 文件字节端口:读探测模块复制出的临时缓存文件(≤64MB 上限) */
export interface FilePort {
  readBytes(path: string): Promise<Uint8Array>
}

/** 时钟端口:限速/重试间隔注入 */
export interface ClockPort {
  now(): number
  sleep(ms: number): Promise<void>
}

/** 身份回填项(对应 Rust db.rs IdentityUpdate):按 rowid 回填 id;gachaType 缺省 = 不动原值 */
export interface IdentityUpdate {
  rowid: number
  id: string
  gachaType?: number
}

/** 档案摘要(db_list_archives 行):lastSyncedAt null = 从未同步 */
export interface ArchiveSummary {
  uid: string
  createdAt: string
  lastSyncedAt: string | null
}

/** 存储端口:本地 SQLite 档案读写,错误经 Promise rejects 抛出(Rust 侧文案已定型) */
export interface StoragePort {
  /** db_load_records:全量读取(SQL 预排序,domain 须以 compareRecords 复排为最终口径) */
  loadRecords(uid: string): Promise<StoredRecord[]>
  /** db_insert_records:单事务批量写入(seq 由存储层分配),返回实际新增行数 */
  insertRecords(uid: string, rows: readonly WishRecord[]): Promise<number>
  /** db_update_identity:按 rowid 批量回填 id/gachaType(单事务),返回实际更新行数 */
  updateIdentity(updates: readonly IdentityUpdate[]): Promise<number>
  /** db_get_watermark:该池完整同步水位;null = 从未正常收尾(从未同步或上次中断) */
  getWatermark(uid: string, gachaType: number): Promise<string | null>
  /** db_set_watermark:UPSERT 水位,仅拉取正常收尾调用(空页或增量提前停),中断绝不调用 */
  setWatermark(uid: string, gachaType: number, id: string): Promise<void>
  /** db_set_last_synced:同步成功收尾写 last_synced_at,任一池失败则不写 */
  setLastSynced(uid: string, iso: string): Promise<void>
  /** db_clear_archive:记录+水位+last_synced_at 同事务清除(archives 行保留),返回删除条数 */
  clearArchive(uid: string): Promise<number>
  /** db_migrate_archive:'0' 哨兵档案迁移到真实 uid,返回迁移行数 */
  migrateArchive(from: string, to: string): Promise<number>
  /** db_list_archives:档案列表(重启后恢复最近档案等) */
  listArchives(): Promise<ArchiveSummary[]>
  /** db_ensure_archive:确保档案行存在(幂等;迁入建 '0' 哨兵、同步建档均走此命令) */
  ensureArchive(uid: string): Promise<void>
}
