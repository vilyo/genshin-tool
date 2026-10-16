/**
 * domain ports 的 Tauri 适配层(spec 02 §1/§2;ADR-0001:Rust 只做 IO,判定全在 domain)。
 * - gacha_get:应用内唯一主动出网的 HTTP 命令(G4),拒绝值为 Rust 聚合的错误串 → NetworkError;
 * - db_*:StoragePort 逐方法映射(T02 命令签名;invoke 参数键按 Tauri 惯例用 camelCase);
 * - 探测命令(spec 02 §2):Windows 专属,非 Windows 拒绝 { kind: 'unsupported_platform' }
 *   → UnsupportedPlatformError,引导 macOS 用户走手动粘贴。
 * jsdom 测试不可用 Tauri 运行时:spec 以 vi.mock('@tauri-apps/api/core') 注入假 invoke。
 */
import { invoke } from '@tauri-apps/api/core'
import {
  CacheLinkNotFoundError,
  NetworkError,
  UnsupportedPlatformError,
} from '@/domain/errors'
import type {
  ArchiveSummary,
  ClockPort,
  FilePort,
  GachaApiPort,
  StoragePort,
} from '@/domain/ports'
import type { StoredRecord } from '@/domain/records'

/** Rust list_game_dirs 行(serde lowercase:cn=国服,global=国际服) */
export interface GameDirInfo {
  region: 'cn' | 'global'
  /** 游戏数据目录(含 GenshinImpact_Data/YuanShen_Data 段,其下即 webCaches) */
  gameDir: string
  /** 该区服 output_log.txt 修改时间(ISO 8601) */
  logMtime: string
}

/** Rust webcache_candidates 行(Rust 侧已按 mtime 降序) */
export interface CacheFileInfo {
  path: string
  mtime: string
}

/** 探测 IO 失败(缓存复制重试后仍失败):非网络/平台问题,引导改走文件导入或手动粘贴 */
export class ProbeIoError extends Error {
  constructor(message = '读取游戏缓存失败,请关闭游戏后重试;若仍失败请改用文件导入或手动粘贴') {
    super(message)
    this.name = 'ProbeIoError'
  }
}

/** Tauri 拒绝值归一为文案:Rust 侧多为错误文案串;其余形状给兜底文案 */
function asMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw !== '') return raw
  if (raw !== null && typeof raw === 'object' && 'message' in raw) {
    const message = (raw as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

/**
 * 探测命令的拒绝值:Rust ProbeError 序列化 { kind, message }。
 * kind → domain 错误类映射(spec 02 §7):unsupported_platform → UnsupportedPlatformError、
 * not_found → CacheLinkNotFoundError、io → ProbeIoError;未知形状归普通 Error。
 */
export function toProbeError(raw: unknown): Error {
  if (raw !== null && typeof raw === 'object' && 'kind' in raw) {
    const payload = raw as { kind?: unknown; message?: unknown }
    const message =
      typeof payload.message === 'string' && payload.message !== '' ? payload.message : undefined
    if (payload.kind === 'unsupported_platform') return new UnsupportedPlatformError(message)
    if (payload.kind === 'not_found') return new CacheLinkNotFoundError(message)
    if (payload.kind === 'io') return new ProbeIoError(message)
  }
  return new Error(asMessage(raw, '自动获取祈愿记录失败'))
}

/** 经 Rust gacha_get 发起官方接口 GET(限速/重试/判定在前端 domain,D13/D14) */
export const tauriGachaApi: GachaApiPort = {
  async get(url: string): Promise<string> {
    try {
      return await invoke<string>('gacha_get', { url })
    } catch (raw) {
      // 网络类失败是唯一可重试类(D14),错误串来自 Rust 聚合(连接/超时/HTTP 非 2xx)
      throw new NetworkError(asMessage(raw, '网络请求失败,请检查网络后重试(已自动重试 3 次)'))
    }
  },
}

/** 经 Rust read_file_bytes 读缓存字节(≤64MB 上限由 Rust 侧拒绝) */
export const tauriFile: FilePort = {
  async readBytes(path: string): Promise<Uint8Array> {
    try {
      const bytes = await invoke<number[]>('read_file_bytes', { path })
      return new Uint8Array(bytes)
    } catch (raw) {
      // 文件读取失败非网络类,不参与拉取重试;文案取自 Rust 错误串
      throw new Error(asMessage(raw, '读取缓存文件失败'))
    }
  },
}

/** 真实时钟(spec 02 §2 ClockPort):D13 限速/D14 重试间隔的 now 基准与 sleep */
export const realClock: ClockPort = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** db_* 命令调用壳:拒绝值(Rust 错误文案串)归一为 Error(message) */
async function invokeDb<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (raw) {
    throw new Error(asMessage(raw, '本地数据库操作失败'))
  }
}

/** 经 Rust db_* 命令读写本地 SQLite 档案(单事务写入、同键多抽由 seq 区分) */
export const tauriStorage: StoragePort = {
  loadRecords: (uid) => invokeDb<StoredRecord[]>('db_load_records', { uid }),
  insertRecords: (uid, rows) => invokeDb<number>('db_insert_records', { uid, rows: [...rows] }),
  updateIdentity: (updates) => invokeDb<number>('db_update_identity', { updates: [...updates] }),
  getWatermark: (uid, gachaType) =>
    invokeDb<string | null>('db_get_watermark', { uid, gachaType }),
  setWatermark: (uid, gachaType, id) =>
    invokeDb<void>('db_set_watermark', { uid, gachaType, id }),
  setLastSynced: (uid, iso) => invokeDb<void>('db_set_last_synced', { uid, iso }),
  clearArchive: (uid) => invokeDb<number>('db_clear_archive', { uid }),
  migrateArchive: (from, to) => invokeDb<number>('db_migrate_archive', { from, to }),
  listArchives: () => invokeDb<ArchiveSummary[]>('db_list_archives'),
  ensureArchive: (uid) => invokeDb<void>('db_ensure_archive', { uid }),
}

/** 自动探测游戏目录(Windows 专属;非 Windows 拒绝为 UnsupportedPlatformError) */
export async function listGameDirs(): Promise<GameDirInfo[]> {
  try {
    return await invoke<GameDirInfo[]>('list_game_dirs')
  } catch (raw) {
    throw toProbeError(raw)
  }
}

/** 枚举某游戏目录下 webCaches 缓存候选(Windows 专属;Rust 侧已按 mtime 降序) */
export async function webcacheCandidates(gameDir: string): Promise<CacheFileInfo[]> {
  try {
    return await invoke<CacheFileInfo[]>('webcache_candidates', { gameDir })
  } catch (raw) {
    throw toProbeError(raw)
  }
}

/** 复制缓存到临时文件并返回其路径(读取前必须复制,ZFGameBrowser 锁定;Windows 专属) */
export async function copyToTemp(path: string): Promise<string> {
  try {
    return await invoke<string>('copy_to_temp', { path })
  } catch (raw) {
    throw toProbeError(raw)
  }
}
