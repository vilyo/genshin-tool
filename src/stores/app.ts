import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
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
} from '@/domain/errors'
import { canonicalize } from '@/domain/link'
import {
  UNLINKED_UID,
  applyExcelImport,
  previewExcelImport,
  type ExcelApplyResult,
  type ExcelImportPreview,
  type ExcelPort,
  type WorkbookData,
} from '@/domain/excelImport'
import type {
  ArchiveSummary,
  ClockPort,
  FilePort,
  GachaApiPort,
  StoragePort,
} from '@/domain/ports'
import {
  BACKUP_MAX_BYTES,
  backupFileName,
  exportBackup as buildBackupFile,
  importBackup as mergeBackupInto,
  parseBackup,
  type BackupImportResult,
} from '@/domain/backup'
import { probeCandidates, type ProbeCandidate } from '@/domain/probe'
import type { StoredRecord } from '@/domain/records'
import type { SyncDeps } from '@/domain/syncPool'
import {
  autoSyncOnStartup,
  syncAll,
  type SyncAllProgress,
  type SyncAllResult,
} from '@/domain/syncAll'
import {
  BACKUP_FILE_PICK,
  LINK_FILE_PICK,
  XLSX_PICK,
  pickFile,
  pickSavePath,
  type FilePickSpec,
  type FileSaveSpec,
} from '@/services/dialogs'
import { tauriExcel } from '@/services/excelPort'
import {
  copyToTemp,
  listGameDirs,
  pickDirectory,
  readTextFile,
  realClock,
  tauriFile,
  tauriGachaApi,
  tauriStorage,
  webcacheCandidates,
  saveTextFile as writeTextFileRaw,
  type CacheFileInfo,
  type GameDirInfo,
} from '@/services/tauriPorts'
import { loadAutoSync, loadGameDir, saveGameDir } from '@/stores/settings'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 编排依赖集:store 全部外部世界经此注入(运行期 = tauriPorts/对话框服务,
 * 测试以 setAppDeps 替换为假实现——与 domain 的端口注入同一纪律)。
 */
export interface AppDeps {
  api: GachaApiPort
  clock: ClockPort
  storage: StoragePort
  file: FilePort
  excel: ExcelPort
  listGameDirs(): Promise<GameDirInfo[]>
  webcacheCandidates(gameDir: string): Promise<CacheFileInfo[]>
  copyToTemp(path: string): Promise<string>
  pickFile(spec: FilePickSpec): Promise<string | null>
  /** 备份导出的系统保存对话框(T18;取消返回 null) */
  saveFile(spec: FileSaveSpec): Promise<string | null>
  /** 备份落盘写文本(Rust save_text_file;备份导出用) */
  writeTextFile(path: string, contents: string): Promise<number>
  /** 备份导入读文本(64MB 真实大小门禁在 Rust read_text_file) */
  readTextFile(path: string): Promise<string>
  /** 手动指定游戏客户端目录的系统对话框(T18;取消返回 null) */
  pickDirectory(): Promise<string | null>
}

const realDeps: AppDeps = {
  api: tauriGachaApi,
  clock: realClock,
  storage: tauriStorage,
  file: tauriFile,
  excel: tauriExcel,
  listGameDirs,
  webcacheCandidates,
  copyToTemp,
  pickFile,
  saveFile: pickSavePath,
  writeTextFile: writeTextFileRaw,
  readTextFile,
  pickDirectory,
}

let deps: AppDeps = realDeps

/** 测试注入:整体替换或部分覆盖编排依赖;传 null 恢复真实端口 */
export function setAppDeps(override: Partial<AppDeps> | null): void {
  deps = override === null ? realDeps : { ...realDeps, ...override }
}

export interface StoreMessage {
  kind: 'success' | 'error'
  text: string
}

/** 三入口的最近动作(错误重试时重放;不入响应式状态) */
type FetchEntry = { kind: 'oneclick' } | { kind: 'file' } | { kind: 'paste'; text: string }

/**
 * 拉取错误 → 展示文案(spec 02 §7 表,UI 单一依据):
 * LinkExpiredError 用 S7 定稿原句(errors.ts 默认 message),不展示错误码、可重试;
 * NetworkError 默认文案自带「已自动重试 3 次」;ApiError 展示官方 message 且不重试(§7),
 * LinkInvalidError 同为链接问题、重试同链接无意义,也不重试。
 * 可能在拉取中途发生的错误(过期/无效/ApiError/网络/协议)携带 note:中断前已拉取的
 * 页照常保留(D14),提示用户数据未丢。
 */
export interface FetchErrorView {
  text: string
  hint: string | null
  /** 中断保留提示(仅可能在拉取中途发生的错误携带) */
  note?: string
  retryable: boolean
}

/** D14:逐页落库,中断不丢已确认页(错误弹窗的保留提示行) */
export const RETAINED_NOTE = '中断前已拉取的记录已保留。'

export function describeFetchError(error: Error): FetchErrorView {
  if (error instanceof UnsupportedPlatformError) {
    return {
      text: error.message,
      hint: '可在游戏内打开「祈愿-历史记录」页后,使用「手动导入 → 粘贴链接」完成获取。',
      retryable: false,
    }
  }
  if (error instanceof LinkExpiredError) {
    return {
      text: error.message,
      hint: '请先在游戏内重新打开「祈愿-历史记录」页,再点击重试。',
      note: RETAINED_NOTE,
      retryable: true,
    }
  }
  if (error instanceof LinkInvalidError) {
    return { text: error.message, hint: null, note: RETAINED_NOTE, retryable: false }
  }
  if (error instanceof ApiError) {
    // spec 02 §7:ApiError 展示官方 message,不重试
    return { text: `官方接口返回错误:${error.message}`, hint: null, note: RETAINED_NOTE, retryable: false }
  }
  if (error instanceof EmptyHistoryError) {
    return { text: error.message, hint: null, retryable: false }
  }
  if (error instanceof NetworkError || error instanceof ProtocolError) {
    return { text: error.message, hint: null, note: RETAINED_NOTE, retryable: true }
  }
  // CacheLinkNotFoundError/LinkParseError/ProbeIoError 的 message 即 spec 02 §7 定型文案,
  // 直出(均发生在拉取开始前,无保留提示)
  return { text: errorText(error), hint: null, retryable: true }
}

/**
 * 行尾噪声集合(粘贴尾噪,T04 遗留):规范祈愿 URL 的末字符恒为 authkey/lang 等
 * 参数值字符,不可能以标点收尾——用户复制常带句读/括号尾巴,不剔除会被并入
 * authkey 造成上游判过期。ASCII 与全角都要收(中文聊天最常见的全角逗号/分号/右括号):
 * 。、,;:!?)〉》】』」 引号本就是提取终结符,列入仅为完整。
 */
const TRAILING_NOISE = /[。、,;:!?)〉》】』」"'.…]+$/u

/** 粘贴文本 → 规范 API URL 列表:逐行 trim + 去行尾标点后拼接再提取(T04 尾噪) */
export function canonicalizePastedText(text: string): string[] {
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(TRAILING_NOISE, ''))
    .join('\n')
  return canonicalize(new TextEncoder().encode(cleaned))
}

/**
 * 设置面板的游戏目录自动探测展示(PRD F5):unsupported = macOS 等非 Windows 平台,
 * empty = 未找到,found = 找到的目录列表,error = 探测失败文案。
 */
export type GameDirProbeView =
  | { state: 'loading' }
  | { state: 'unsupported' }
  | { state: 'empty' }
  | { state: 'found'; dirs: GameDirInfo[] }
  | { state: 'error'; text: string }

/**
 * 应用 store:档案状态 + F1 全部交互流(一键获取/粘贴/文件导入/Excel 迁入)的编排胶水。
 * 三入口汇合同一条 probe → syncAll 管线(spec 02 §4);D9 多候选、uid 不一致确认切换、
 * '0' 哨兵并入、S7 过期文案等分支全在这里落状态,组件只读状态驱动渲染。
 */
export const useAppStore = defineStore('app', () => {
  // —— 档案状态 ——
  const archives = ref<ArchiveSummary[]>([])
  /** 当前档案 UID;null = 尚无档案 */
  const currentUid = ref<string | null>(null)
  /** 当前档案全量记录(落库口径) */
  const records = ref<StoredRecord[]>([])
  const loading = ref(false)
  const message = ref<StoreMessage | null>(null)

  // —— 共用拉取管线(FetchDialog 的状态源)——
  const fetchOpen = ref(false)
  /** 探测段文案(定位目录/读缓存/提取/验证链接);进入拉取段后由 syncProgress 接管 */
  const fetchStage = ref<string | null>(null)
  /** 探测/提取段门闩(一键获取、粘贴路由、文件读取期间) */
  const probing = ref(false)
  const syncing = ref(false)
  const syncProgress = ref<SyncAllProgress | null>(null)
  const fetchError = ref<Error | null>(null)
  const fetchResult = ref<SyncAllResult | null>(null)
  let lastEntry: FetchEntry | null = null

  // —— D9/uid 守卫/'0' 哨兵的待决对话框 ——
  /** 多游戏目录待选择(单目录直取,不进此状态) */
  const pendingDirs = ref<GameDirInfo[] | null>(null)
  /** 多候选不同 uid 待选择(D9) */
  const pendingCandidates = ref<ProbeCandidate[] | null>(null)
  /** 链接 uid 与当前档案不一致待确认(ArchiveMismatchError;拒绝 = 中止零写入) */
  const pendingMismatch = ref<{ resolvedUid: string; url: string } | null>(null)
  /** '0' 哨兵并入确认(spec 03 §7;目标恒为同步后的当前档案) */
  const pendingSentinelMerge = ref<{ count: number } | null>(null)

  // —— Excel 迁入(F1.5,spec 03 §5 预览契约)——
  const excelOpen = ref(false)
  const excelLoading = ref(false)
  const excelApplying = ref(false)
  const excelPreview = ref<ExcelImportPreview | null>(null)
  const excelError = ref<string | null>(null)
  const excelResult = ref<ExcelApplyResult | null>(null)
  let excelWorkbook: WorkbookData | null = null

  // —— 粘贴弹窗的行内错误(先于管线的本地规范化失败)——
  const pasteError = ref<string | null>(null)

  // —— 设置面板(T18,F4/F5)——
  const settingsOpen = ref(false)

  /** 设置面板的游戏目录自动探测展示(PRD F5;一键获取的探测链路不读手动目录) */
  const dirProbe = ref<GameDirProbeView>({ state: 'loading' })
  /** 手动指定的游戏客户端目录(仅作面板展示与后续版本使用,不参与获取) */
  const manualGameDir = ref<string | null>(loadGameDir())

  /** 备份导出/导入/清空进行中(纳入 busy 闸门,与拉取管线互斥) */
  const backupPending = ref(false)

  /** 备份导入的预览确认(spec 01 §6:先算新增/回填/跳过,确认后才落库) */
  const pendingBackupImport = ref<{
    targetUid: string
    isCurrent: boolean
    result: BackupImportResult
  } | null>(null)

  /** 清空当前档案的二次确认(F4) */
  const pendingClear = ref(false)

  const busy = computed(
    () =>
      loading.value ||
      probing.value ||
      syncing.value ||
      excelLoading.value ||
      excelApplying.value ||
      backupPending.value,
  )

  function syncDeps(): SyncDeps {
    return { api: deps.api, clock: deps.clock, storage: deps.storage }
  }

  // ---------------------------------------------------------------------------
  // 档案状态
  // ---------------------------------------------------------------------------

  /**
   * 应用启动:listArchives → 按启动选档规则恢复档案(重启后数据完整可读)→ loadRecords。
   * 选档规则:'0' 哨兵是未关联 Excel 记录的暂存档(spec 03 §7),创建早、迁并后常为空,
   * 按列表首个选中会让启动总落在空哨兵上——有真实档案时跳过哨兵;多个真实档案取
   * 最近同步者(与 D16 自动同步认领同规则,不等同于上次手动选中的档案);仅剩哨兵时回退
   * 选中(纯 Excel 迁入、从未链接同步的用户,记录就在 '0' 里)。
   */
  async function init(): Promise<void> {
    if (loading.value || currentUid.value !== null) return
    loading.value = true
    try {
      const list = await deps.storage.listArchives()
      archives.value = list
      const real = list.filter((archive) => archive.uid !== UNLINKED_UID)
      const pool = real.length > 0 ? real : list
      const picked =
        pool
          .filter((archive) => archive.lastSyncedAt !== null)
          .sort((a, b) => b.lastSyncedAt!.localeCompare(a.lastSyncedAt!))[0] ?? pool[0]
      if (picked !== undefined) {
        currentUid.value = picked.uid
        records.value = await deps.storage.loadRecords(picked.uid)
      }
    } catch (error) {
      message.value = { kind: 'error', text: `读取本地档案失败:${errorText(error)}` }
    } finally {
      loading.value = false
    }
  }

  /** 载入指定档案全量记录并置为当前(S5:只切状态,不删数据、可随时切回) */
  async function loadRecords(uid: string): Promise<void> {
    records.value = await deps.storage.loadRecords(uid)
    currentUid.value = uid
  }

  /** 切换到已有档案(档案管理 UI 属 T18,动作先落在这里) */
  async function switchArchive(uid: string): Promise<void> {
    if (busy.value || uid === currentUid.value) return
    try {
      await loadRecords(uid)
    } catch (error) {
      message.value = { kind: 'error', text: `读取档案失败:${errorText(error)}` }
    }
  }

  // ---------------------------------------------------------------------------
  // 共用拉取管线:beginFetch / routeUrls / runSync(三入口汇合,spec 02 §4)
  // ---------------------------------------------------------------------------

  function beginFetch(entry: FetchEntry): void {
    lastEntry = entry
    fetchOpen.value = true
    fetchStage.value = null
    fetchError.value = null
    fetchResult.value = null
    syncProgress.value = null
    message.value = null
  }

  function stage(text: string | null): void {
    fetchStage.value = text
  }

  function failFetch(error: unknown): void {
    fetchStage.value = null
    fetchError.value = error instanceof Error ? error : new Error(String(error))
  }

  function closeFetch(): void {
    fetchOpen.value = false
    fetchStage.value = null
    fetchError.value = null
    fetchResult.value = null
    syncProgress.value = null
    pendingDirs.value = null
    pendingCandidates.value = null
  }

  /** 错误重试:重放三入口的最近动作(过期场景:游戏内重开历史页后一键重试) */
  function retryFetch(): void {
    const entry = lastEntry
    closeFetch()
    if (entry === null) return
    if (entry.kind === 'oneclick') void oneClickFetch()
    else if (entry.kind === 'file') void fileImport()
    else void pasteImport(entry.text)
  }

  /** D6–D9 路由:探底验证 → 全败上抛 / 单候选直入 / 多候选挂起选择 */
  async function routeUrls(urls: string[]): Promise<void> {
    stage('正在验证祈愿链接…')
    const probe = await probeCandidates(deps.api, deps.clock, urls)
    if (probe.candidates.length === 0) {
      // 全部 -101 → S7 过期文案;其余(网络不可达/retcode≠0)→ 上抛最后错误
      if (probe.allExpired) throw new LinkExpiredError()
      throw probe.error ?? new NetworkError()
    }
    stage(null)
    if (probe.candidates.length > 1) {
      // 探底已按 uid 去重(D8),>1 即含不同 uid(或匿名候选),挂起等用户选择
      pendingCandidates.value = probe.candidates
      return
    }
    await startSync(probe.candidates[0]!)
  }

  /** D9 单候选入口:uid 与当前档案不一致(双方已知)→ 挂起切换确认;否则进入拉取 */
  async function startSync(candidate: ProbeCandidate): Promise<void> {
    const target = candidate.uid
    if (currentUid.value !== null && target !== null && target !== currentUid.value) {
      pendingMismatch.value = { resolvedUid: target, url: candidate.url }
      return
    }
    await runSync(candidate.url, currentUid.value)
  }

  /**
   * 五池编排执行段(spec 02 §6):进度回调驱动 FetchDialog;成功后档案跟随
   * (确认切换/首次建档即落到同步 uid),失败时 ArchiveMismatch 挂起确认而非报错
   * ——探底候选 uid 为 null 时,真实 uid 由 syncAll 的守卫页确认。
   */
  async function runSync(url: string, expectedUid: string | null): Promise<void> {
    syncing.value = true
    fetchStage.value = null
    fetchError.value = null
    fetchResult.value = null
    syncProgress.value = null
    try {
      const result = await syncAll(syncDeps(), url, expectedUid, {
        onProgress: (progress) => {
          syncProgress.value = progress
        },
      })
      fetchResult.value = result
      try {
        // 成功态不被刷新失败翻转(#8):档案展示刷新失败降级为非阻断 message
        currentUid.value = result.uid
        archives.value = await deps.storage.listArchives()
        records.value = await deps.storage.loadRecords(result.uid)
        await maybeOfferSentinelMerge(result.uid)
      } catch (error) {
        message.value = { kind: 'error', text: `同步已完成,但刷新档案展示失败:${errorText(error)}` }
      }
    } catch (error) {
      if (error instanceof ArchiveMismatchError) {
        // uid 守卫先行确认,未落任何数据:交用户决定是否切换(spec 02 §6)
        pendingMismatch.value = { resolvedUid: error.resolvedUid, url }
        return
      }
      fetchError.value = error instanceof Error ? error : new Error(String(error))
      // 中断前已落库的页照常保留并刷新展示(D14);expectedUid 为 null(首次获取/确认
      // 切换重入)时拿不到守卫 uid,至少刷新 archives 让新建档可见,不自动认领(#2);
      // 刷新失败不掩盖原始错误
      try {
        archives.value = await deps.storage.listArchives()
        if (expectedUid !== null) {
          records.value = await deps.storage.loadRecords(expectedUid)
        } else if (currentUid.value !== null) {
          records.value = await deps.storage.loadRecords(currentUid.value)
        }
      } catch {
        // 忽略:原始错误优先呈现
      }
    } finally {
      syncing.value = false
      syncProgress.value = null
    }
  }

  /** '0' 哨兵并入确认(spec 03 §7):n 从 loadRecords('0') 取;拒绝则保留,可稍后再并 */
  async function maybeOfferSentinelMerge(uid: string): Promise<void> {
    if (uid === UNLINKED_UID) return
    if (!archives.value.some((archive) => archive.uid === UNLINKED_UID)) return
    const unlinked = await deps.storage.loadRecords(UNLINKED_UID)
    if (unlinked.length === 0) return
    pendingSentinelMerge.value = { count: unlinked.length }
  }

  async function confirmSentinelMerge(): Promise<void> {
    const pending = pendingSentinelMerge.value
    pendingSentinelMerge.value = null
    const uid = currentUid.value
    if (pending === null || uid === null || uid === UNLINKED_UID) return
    try {
      await deps.storage.migrateArchive(UNLINKED_UID, uid)
      records.value = await deps.storage.loadRecords(uid)
      archives.value = await deps.storage.listArchives()
    } catch (error) {
      message.value = { kind: 'error', text: `并入未关联记录失败:${errorText(error)}` }
    }
  }

  function cancelSentinelMerge(): void {
    pendingSentinelMerge.value = null // 拒绝:'0' 档案保留
  }

  // ---------------------------------------------------------------------------
  // F1.1 一键获取(Windows;macOS 经 UnsupportedPlatformError 引导粘贴)
  // ---------------------------------------------------------------------------

  async function oneClickFetch(): Promise<void> {
    if (busy.value) return
    beginFetch({ kind: 'oneclick' })
    probing.value = true
    try {
      stage('正在定位游戏目录…')
      const dirs = await deps.listGameDirs()
      if (dirs.length === 0) throw new CacheLinkNotFoundError()
      if (dirs.length > 1) {
        // 多目录:挂起等用户选择(单目录直取)
        pendingDirs.value = dirs
        stage(null)
        return
      }
      await fetchFromGameDir(dirs[0]!.gameDir)
    } catch (error) {
      failFetch(error)
    } finally {
      probing.value = false
    }
  }

  async function chooseGameDir(gameDir: string): Promise<void> {
    if (pendingDirs.value === null || busy.value) return
    pendingDirs.value = null
    probing.value = true
    try {
      await fetchFromGameDir(gameDir)
    } catch (error) {
      failFetch(error)
    } finally {
      probing.value = false
    }
  }

  function cancelDirSelection(): void {
    closeFetch()
  }

  /** 定好目录后:取 mtime 最新缓存(Rust 已降序)→ 复制到临时文件 → 读字节 → 共用路由 */
  async function fetchFromGameDir(gameDir: string): Promise<void> {
    stage('正在读取游戏缓存…')
    const caches = await deps.webcacheCandidates(gameDir)
    if (caches.length === 0) throw new CacheLinkNotFoundError()
    const tempPath = await deps.copyToTemp(caches[0]!.path)
    stage('正在提取祈愿链接…')
    const bytes = await deps.file.readBytes(tempPath)
    const urls = canonicalize(bytes)
    if (urls.length === 0) throw new CacheLinkNotFoundError() // 提取 0 条:缓存无链接引导
    await routeUrls(urls)
  }

  // ---------------------------------------------------------------------------
  // F1.2 粘贴导入(macOS 唯一自动途径)/ F1.3 文件导入(兜底入口)
  // ---------------------------------------------------------------------------

  /** 粘贴导入:先本地规范化(失败留在粘贴弹窗行内),有效链接进入共用探底→拉取管线 */
  async function pasteImport(text: string): Promise<boolean> {
    if (busy.value) return false
    pasteError.value = null
    let urls: string[]
    try {
      urls = canonicalizePastedText(text)
    } catch (error) {
      pasteError.value = errorText(error)
      return false
    }
    if (urls.length === 0) {
      pasteError.value = new LinkParseError().message
      return false
    }
    beginFetch({ kind: 'paste', text })
    probing.value = true
    try {
      await routeUrls(urls)
    } catch (error) {
      failFetch(error)
    } finally {
      probing.value = false
    }
    return true
  }

  /** 文件导入:选文件(取消静默)→ 读字节 → 提取 → 共用路由 */
  async function fileImport(): Promise<void> {
    if (busy.value) return
    probing.value = true
    try {
      const path = await deps.pickFile(LINK_FILE_PICK)
      if (path === null) return
      beginFetch({ kind: 'file' })
      stage('正在读取文件…')
      const bytes = await deps.file.readBytes(path)
      stage('正在提取祈愿链接…')
      const urls = canonicalize(bytes)
      if (urls.length === 0) throw new LinkParseError() // 文件无链接:入口层区分(spec 02 §4)
      await routeUrls(urls)
    } catch (error) {
      failFetch(error)
    } finally {
      probing.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // D9 多候选 / uid 不一致确认
  // ---------------------------------------------------------------------------

  async function chooseCandidate(candidate: ProbeCandidate): Promise<void> {
    if (pendingCandidates.value === null || busy.value) return
    pendingCandidates.value = null
    probing.value = true
    try {
      await startSync(candidate)
    } catch (error) {
      failFetch(error)
    } finally {
      probing.value = false
    }
  }

  function cancelCandidateSelection(): void {
    closeFetch()
  }

  /** 确认切换:以链接真实 uid 重入 syncAll(expectedUid = null → 自动建档并全程落库) */
  async function confirmArchiveSwitch(): Promise<void> {
    const pending = pendingMismatch.value
    pendingMismatch.value = null
    if (pending === null || busy.value) return
    probing.value = true
    try {
      await runSync(pending.url, null)
    } finally {
      probing.value = false
    }
  }

  /** 拒绝切换:中止本次导入,零写入(守卫确认未落数据),档案保持不变 */
  function cancelArchiveSwitch(): void {
    pendingMismatch.value = null
    closeFetch()
  }

  // ---------------------------------------------------------------------------
  // F1.5 Excel 历史迁入(spec 03 §5:预览必须先行,无预览不落库)
  // ---------------------------------------------------------------------------

  async function openExcelImport(): Promise<void> {
    if (busy.value) return
    const path = await deps.pickFile(XLSX_PICK)
    if (path === null) return // 取消选文件:静默返回
    excelOpen.value = true
    excelLoading.value = true
    excelError.value = null
    excelResult.value = null
    excelPreview.value = null
    try {
      const workbook = await deps.excel.extractWorkbook(path)
      excelWorkbook = workbook
      // 重叠预览对「当前档案记录」:无档案按空档案,得全零重叠
      const existing =
        currentUid.value === null ? [] : await deps.storage.loadRecords(currentUid.value)
      excelPreview.value = previewExcelImport(workbook, existing)
    } catch (error) {
      excelError.value = errorText(error)
    } finally {
      excelLoading.value = false
    }
  }

  /** 确认导入:applyExcelImport 重跑同一确定性解析(G8:报告数字与预览一致) */
  async function confirmExcelImport(): Promise<void> {
    if (excelPreview.value === null || excelWorkbook === null || busy.value) return
    excelApplying.value = true
    excelError.value = null
    try {
      const result = await applyExcelImport(deps.storage, excelWorkbook, currentUid.value)
      excelResult.value = result
      excelPreview.value = null
      excelWorkbook = null
      // 并入当前档案;无档案导入时落到 '0' 哨兵并切过去展示(spec 03 §7)
      currentUid.value = result.archiveUid
      archives.value = await deps.storage.listArchives()
      records.value = await deps.storage.loadRecords(result.archiveUid)
    } catch (error) {
      excelError.value = errorText(error)
      // 部分写入已发生(insertRecords 已批式落库,updateIdentity 等后续步骤才失败):
      // 尽力刷新档案展示让已写入数据可见;刷新失败不掩盖原始错误(#9)
      try {
        archives.value = await deps.storage.listArchives()
        if (currentUid.value !== null) {
          records.value = await deps.storage.loadRecords(currentUid.value)
        }
      } catch {
        // 忽略:原始错误优先呈现
      }
    } finally {
      excelApplying.value = false
    }
  }

  /** 取消导入:零写入(预览阶段本就无任何写路径) */
  function cancelExcelImport(): void {
    closeExcel()
  }

  function closeExcel(): void {
    excelOpen.value = false
    excelLoading.value = false
    excelApplying.value = false
    excelPreview.value = null
    excelError.value = null
    excelResult.value = null
    excelWorkbook = null
  }

  // ---------------------------------------------------------------------------
  // D16 启动自动同步(静默:成败都不弹窗不打扰)
  // ---------------------------------------------------------------------------

  /**
   * 开关开 → 从 mtime 最新缓存提取候选 → 域层 autoSyncOnStartup(任何需交互/报错的
   * 结局一律跳过)。全程挂 syncing 纳入 busy 闸门(#1):启动同步进行中一键获取/粘贴/
   * Excel 迁入不可并发——双 syncAll 并发会绕过 D13 全局限速,且会让 Excel 预览按错误的
   * 档案状态计重叠(G8);静默语义不变(fetchOpen 不置位,不弹窗)。
   */
  async function startupAutoSync(): Promise<void> {
    if (!loadAutoSync() || busy.value) return
    syncing.value = true
    try {
      const dirs = await deps.listGameDirs() // macOS:UnsupportedPlatformError → 静默跳过
      if (dirs.length === 0) return
      const caches = await deps.webcacheCandidates(dirs[0]!.gameDir)
      if (caches.length === 0) return
      const tempPath = await deps.copyToTemp(caches[0]!.path)
      const bytes = await deps.file.readBytes(tempPath)
      const urls = canonicalize(bytes)
      if (urls.length === 0) return
      const ok = await autoSyncOnStartup(syncDeps(), urls, currentUid.value)
      if (!ok) return // 多候选/uid 不一致/过期/网络失败等:静默留待手动一键获取
      // 成功:静默刷新;从未建档时按「最近同步」认领展示档案
      archives.value = await deps.storage.listArchives()
      if (currentUid.value === null) {
        const recentlySynced = archives.value
          .filter((archive) => archive.lastSyncedAt !== null)
          .sort((a, b) => (a.lastSyncedAt! > b.lastSyncedAt! ? -1 : 1))[0]
        if (recentlySynced !== undefined) currentUid.value = recentlySynced.uid
      }
      if (currentUid.value !== null) {
        records.value = await deps.storage.loadRecords(currentUid.value)
      }
    } catch {
      // D16:静默跳过,不弹窗、不记为错误
    } finally {
      syncing.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // T18:设置面板(F5)/ 备份导出导入(F4)/ 清空数据(F4)
  // ---------------------------------------------------------------------------

  function openSettings(): void {
    settingsOpen.value = true
    // 每次打开都重探一次(结果随时可能变化;失败/平台不支持在面板内呈现)
    void refreshGameDirs()
  }

  /** 关闭面板连带收起其嵌套浮层(清空确认/导入预览),不留半开的待决状态 */
  function closeSettings(): void {
    settingsOpen.value = false
    pendingClear.value = false
    pendingBackupImport.value = null
  }

  /** 面板的目录自动探测展示:UnsupportedPlatform = 非 Windows(macOS 引导手动粘贴) */
  async function refreshGameDirs(): Promise<void> {
    dirProbe.value = { state: 'loading' }
    try {
      const dirs = await deps.listGameDirs()
      dirProbe.value = dirs.length > 0 ? { state: 'found', dirs } : { state: 'empty' }
    } catch (error) {
      if (error instanceof UnsupportedPlatformError) dirProbe.value = { state: 'unsupported' }
      else dirProbe.value = { state: 'error', text: errorText(error) }
    }
  }

  /**
   * 手动指定游戏客户端目录(T18 裁决):仅存 localStorage 作面板展示与后续版本使用,
   * v1 自动探测优先,不参与一键获取的探测链路。
   */
  async function chooseGameDirManually(): Promise<void> {
    try {
      const path = await deps.pickDirectory()
      if (path === null) return // 取消选目录:静默
      saveGameDir(path)
      manualGameDir.value = path
    } catch (error) {
      message.value = { kind: 'error', text: `选择目录失败:${errorText(error)}` }
    }
  }

  /**
   * 导出当前档案为 JSON 备份(PRD F4 / spec 01 §6):保存对话框定路径(取消静默),
   * 前端组装 BackupFile 后经 Rust save_text_file 落盘。
   */
  async function exportBackupFile(): Promise<void> {
    if (busy.value) return // 与拉取/Excel 管线互斥(busy 含 backupPending)
    if (currentUid.value === null) {
      message.value = { kind: 'error', text: '尚无祈愿档案,先完成一次获取或导入再导出备份。' }
      return
    }
    backupPending.value = true
    try {
      const uid = currentUid.value
      const path = await deps.saveFile({
        title: '导出祈愿记录备份',
        defaultPath: backupFileName(uid, new Date()),
        filters: [{ name: 'JSON 备份', extensions: ['json'] }],
      })
      if (path === null) return
      // 备份函数先按完整记录排序,再剥离存储字段,保留同秒十连抽序。
      const backup = buildBackupFile(records.value, uid, new Date().toISOString())
      await deps.writeTextFile(path, JSON.stringify(backup))
      message.value = {
        kind: 'success',
        text: `已导出 ${backup.records.length} 条祈愿记录到 ${path}`,
      }
    } catch (error) {
      message.value = { kind: 'error', text: `导出备份失败:${errorText(error)}` }
    } finally {
      backupPending.value = false
    }
  }

  /**
   * 导入备份(PRD F4 / spec 01 §6):选文件 → 读文本(64MB 真实大小门禁在 Rust)→
   * parseBackup 逐层校验 → 对目标档案(backup.uid)算合并预览,挂起等确认后才落库。
   * 校验/读取失败直接进 message(解析拒绝文案来自 backup.ts,UI 直用)。
   */
  async function importBackupFile(): Promise<void> {
    if (busy.value) return // 与拉取/Excel 管线互斥;预览按当前库态计算,不接受并发写
    backupPending.value = true
    try {
      const path = await deps.pickFile(BACKUP_FILE_PICK)
      if (path === null) return
      const text = await deps.readTextFile(path)
      const backup = parseBackup(text, BACKUP_MAX_BYTES)
      // 预览对「目标档案」的既有行:当前档案用内存,非当前档案读库(缺失档案返回空)
      const targetRecords =
        backup.uid === currentUid.value
          ? records.value
          : await deps.storage.loadRecords(backup.uid)
      pendingBackupImport.value = {
        targetUid: backup.uid,
        isCurrent: backup.uid === currentUid.value,
        result: mergeBackupInto(targetRecords, backup),
      }
    } catch (error) {
      message.value = { kind: 'error', text: `导入备份失败:${errorText(error)}` }
    } finally {
      backupPending.value = false
    }
  }

  /** 确认导入:ensureArchive(目标档案可能不存在)→ 新增行 + 身份回填落库,再刷新展示 */
  async function confirmBackupImport(): Promise<void> {
    const pending = pendingBackupImport.value
    pendingBackupImport.value = null
    if (pending === null || busy.value) return
    backupPending.value = true
    try {
      const { targetUid, isCurrent, result } = pending
      await deps.storage.ensureArchive(targetUid)
      if (result.added.length > 0) await deps.storage.insertRecords(targetUid, result.added)
      if (result.upgrades.length > 0) await deps.storage.updateIdentity(result.upgrades)
      try {
        archives.value = await deps.storage.listArchives()
        if (isCurrent) records.value = await deps.storage.loadRecords(targetUid)
      } catch (error) {
        // 导入本身已完成,展示刷新失败降级为非阻断提示
        message.value = {
          kind: 'error',
          text: `导入已完成,但刷新档案展示失败:${errorText(error)}`,
        }
        return
      }
      message.value = {
        kind: 'success',
        text:
          `导入完成:新增 ${result.summary.added} 条、回填 ${result.summary.upgraded} 条、` +
          `跳过 ${result.summary.skipped} 条。` +
          (isCurrent ? '' : `记录已并入 UID ${targetUid},可在「档案管理」中切换查看。`),
      }
    } catch (error) {
      message.value = { kind: 'error', text: `导入备份失败:${errorText(error)}` }
      // 部分写入可能已发生(insertRecords 已批式落库),尽力刷新让已写入数据可见
      try {
        archives.value = await deps.storage.listArchives()
      } catch {
        // 忽略:原始错误优先呈现
      }
    } finally {
      backupPending.value = false
    }
  }

  /** 取消导入:零写入(预览阶段未落任何库) */
  function cancelBackupImport(): void {
    pendingBackupImport.value = null
  }

  function askClearArchive(): void {
    if (currentUid.value === null || backupPending.value) return
    pendingClear.value = true
  }

  function cancelClearArchive(): void {
    pendingClear.value = false
  }

  /**
   * 确认清空当前档案(F4):db_clear_archive 同事务清除记录+水位+last_synced_at,
   * 档案行保留;当前档案留在原地置为空档(保守不自动切换)。
   */
  async function confirmClearArchive(): Promise<void> {
    const uid = currentUid.value
    if (!pendingClear.value || uid === null || busy.value) return
    pendingClear.value = false
    backupPending.value = true
    try {
      const removed = await deps.storage.clearArchive(uid)
      records.value = []
      try {
        archives.value = await deps.storage.listArchives()
      } catch {
        // 列表刷新失败不掩盖清空结果
      }
      message.value = {
        kind: 'success',
        text: `已清空 UID ${uid} 的 ${removed} 条祈愿记录与同步水位,档案保留。`,
      }
    } catch (error) {
      message.value = { kind: 'error', text: `清空数据失败:${errorText(error)}` }
    } finally {
      backupPending.value = false
    }
  }

  return {
    // 档案状态
    archives,
    currentUid,
    records,
    loading,
    message,
    // 共用管线
    fetchOpen,
    fetchStage,
    probing,
    syncing,
    syncProgress,
    fetchError,
    fetchResult,
    busy,
    pasteError,
    // 待决对话框
    pendingDirs,
    pendingCandidates,
    pendingMismatch,
    pendingSentinelMerge,
    // Excel
    excelOpen,
    excelLoading,
    excelApplying,
    excelPreview,
    excelError,
    excelResult,
    // 设置面板/备份/清空(T18)
    settingsOpen,
    dirProbe,
    manualGameDir,
    backupPending,
    pendingBackupImport,
    pendingClear,
    // 动作
    init,
    loadRecords,
    switchArchive,
    oneClickFetch,
    chooseGameDir,
    cancelDirSelection,
    pasteImport,
    fileImport,
    retryFetch,
    closeFetch,
    chooseCandidate,
    cancelCandidateSelection,
    confirmArchiveSwitch,
    cancelArchiveSwitch,
    confirmSentinelMerge,
    cancelSentinelMerge,
    openExcelImport,
    confirmExcelImport,
    cancelExcelImport,
    closeExcel,
    startupAutoSync,
    openSettings,
    closeSettings,
    refreshGameDirs,
    chooseGameDirManually,
    exportBackupFile,
    importBackupFile,
    confirmBackupImport,
    cancelBackupImport,
    askClearArchive,
    cancelClearArchive,
    confirmClearArchive,
  }
})
