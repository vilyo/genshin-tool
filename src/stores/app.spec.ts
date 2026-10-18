import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  CacheLinkNotFoundError,
  LinkExpiredError,
  LinkInvalidError,
  LinkParseError,
  NetworkError,
  UnsupportedPlatformError,
} from '@/domain/errors'
import type { ProbeCandidate } from '@/domain/probe'
import type { GameDirInfo } from '@/services/tauriPorts'
import { setAppDeps, useAppStore, canonicalizePastedText, describeFetchError } from './app'
import {
  CN_CANONICAL,
  GLOBAL_URL,
  RAW_URL,
  cacheBytesOf,
  fakeClock,
  makeFakeApi,
  makeFakeStorage,
  makeWorkbook,
  storedRecord,
  type FakeStorage,
} from '@/test-support/appFakes'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
})

/** 探底/拉取全链路的默认依赖:单目录 + 缓存含 RAW_URL + uid 777 */
function injectHappyPath(cacheText: string = RAW_URL, storage: FakeStorage = makeFakeStorage()) {
  const api = makeFakeApi()
  const listGameDirs = vi.fn(async (): Promise<GameDirInfo[]> => [
    { region: 'cn', gameDir: 'D:/Genshin Impact', logMtime: '2026-10-16T00:00:00Z' },
  ])
  const webcacheCandidates = vi.fn(async () => [
    { path: 'D:/Genshin Impact/webCaches/2.7.1/Cache/Cache_Data/data_2', mtime: 'x' },
  ])
  const copyToTemp = vi.fn(async (path: string) => `${path}.tmp`)
  setAppDeps({
    api,
    clock: fakeClock,
    storage: storage.storage,
    file: { readBytes: vi.fn(async () => cacheBytesOf(cacheText)) },
    listGameDirs,
    webcacheCandidates,
    copyToTemp,
    pickFile: vi.fn(async () => null),
  })
  return { api, listGameDirs, storage }
}

describe('档案状态(init/切换)', () => {
  it.each([null, '2026-10-02T00:00:00Z'])('真实档案同步时间同为 %s 时保持列表顺序', async (syncedAt) => {
    const storage = makeFakeStorage({ '0': [], '111': [storedRecord()], '777': [storedRecord()] })
    if (syncedAt !== null) {
      await storage.storage.setLastSynced('111', syncedAt)
      await storage.storage.setLastSynced('777', syncedAt)
    }
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()
    await store.init()
    expect(store.currentUid).toBe('111')
  })

  it('无档案:init 后 currentUid 为 null、记录为空', async () => {
    injectHappyPath()
    const store = useAppStore()

    await store.init()

    expect(store.currentUid).toBeNull()
    expect(store.records).toEqual([])
  })

  it('有档案:init 恢复首个档案并载入全量记录', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.init()

    expect(store.currentUid).toBe('777')
    expect(store.records).toHaveLength(1)
  })

  it('空 \'0\' 哨兵与真实档案并存:init 跳过哨兵选中真实档案', async () => {
    const storage = makeFakeStorage({ '0': [], '777': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.init()

    expect(store.currentUid).toBe('777')
    expect(store.records).toHaveLength(1)
  })

  it('仅 \'0\' 哨兵档案:init 回退选中哨兵(纯 Excel 迁入用户的记录在 \'0\')', async () => {
    const storage = makeFakeStorage({ '0': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.init()

    expect(store.currentUid).toBe('0')
    expect(store.records).toHaveLength(1)
  })

  it('多个真实档案:init 取最近同步者(与 D16 认领同规则)', async () => {
    const storage = makeFakeStorage({ '111': [storedRecord()], '777': [storedRecord()] })
    await storage.storage.setLastSynced('111', '2026-10-01T00:00:00Z')
    await storage.storage.setLastSynced('777', '2026-10-02T00:00:00Z')
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.init()

    expect(store.currentUid).toBe('777')
  })
})

describe('F1.1 一键获取', () => {
  it('单候选直拉:探测 → 五池编排 → 完成报告 + 档案跟随(uid 777 建档)', async () => {
    injectHappyPath()
    const store = useAppStore()

    await store.oneClickFetch()

    expect(store.fetchOpen).toBe(true)
    expect(store.fetchError).toBeNull()
    expect(store.fetchResult).not.toBeNull()
    expect(store.fetchResult?.uid).toBe('777')
    expect(store.fetchResult?.pools).toHaveLength(5)
    expect(store.fetchResult?.added).toBe(15) // 五池 × 每池 3 条
    expect(store.currentUid).toBe('777')
    expect(store.records).toHaveLength(15)
  })

  it('多游戏目录:挂起选择;选定后继续走完管线', async () => {
    const ctx = injectHappyPath()
    ctx.listGameDirs.mockResolvedValue([
      { region: 'cn', gameDir: 'D:/CN', logMtime: 'a' },
      { region: 'global', gameDir: 'D:/Global', logMtime: 'b' },
    ])
    const store = useAppStore()

    await store.oneClickFetch()

    expect(store.pendingDirs).toHaveLength(2)
    expect(store.fetchResult).toBeNull()

    await store.chooseGameDir('D:/Global')

    expect(store.pendingDirs).toBeNull()
    expect(store.fetchResult?.uid).toBe('777')
  })

  it('无游戏目录:CacheLinkNotFoundError 引导(游戏内打开历史记录页)', async () => {
    const ctx = injectHappyPath()
    ctx.listGameDirs.mockResolvedValue([])
    const store = useAppStore()

    await store.oneClickFetch()

    expect(store.fetchError).toBeInstanceOf(CacheLinkNotFoundError)
    expect(store.fetchError?.message).toContain('祈愿-历史记录')
  })

  it('macOS(非 Windows):UnsupportedPlatformError 文案引导手动粘贴,不可重试', async () => {
    const ctx = injectHappyPath()
    ctx.listGameDirs.mockRejectedValue(new UnsupportedPlatformError())
    const store = useAppStore()

    await store.oneClickFetch()

    const view = describeFetchError(store.fetchError!)
    expect(view.text).toContain('手动粘贴')
    expect(view.hint).toContain('粘贴链接')
    expect(view.retryable).toBe(false)
  })

  it('缓存无链接:CacheLinkNotFoundError;错误后重试重放一键获取', async () => {
    const ctx = injectHappyPath('no link here')
    const store = useAppStore()

    await store.oneClickFetch()
    expect(store.fetchError).toBeInstanceOf(CacheLinkNotFoundError)

    ctx.listGameDirs.mockClear()
    store.retryFetch()
    await vi.waitFor(() => expect(ctx.listGameDirs).toHaveBeenCalledTimes(1))
  })
})

describe('F1.2 粘贴导入(macOS 真实走通)', () => {
  it('含链接文本(行尾空白/中文行尾噪)→ 探底 → 五池拉取走通', async () => {
    injectHappyPath()
    const store = useAppStore()

    // 尾噪形态:行尾双空格 + 后续中文备注行(未 trim 会把空格并入 authkey)
    const ok = await store.pasteImport(`  ${RAW_URL}  \n备注:随手记的一行\n`)

    expect(ok).toBe(true)
    expect(store.pasteError).toBeNull()
    expect(store.fetchOpen).toBe(true)
    expect(store.fetchError).toBeNull()
    expect(store.fetchResult?.added).toBe(15)
    expect(store.currentUid).toBe('777')
  })

  it('无链接:粘贴弹窗行内报错,不打开拉取弹窗', async () => {
    injectHappyPath()
    const store = useAppStore()

    const ok = await store.pasteImport('这里没有链接')

    expect(ok).toBe(false)
    expect(store.pasteError).toBe(new LinkParseError().message)
    expect(store.fetchOpen).toBe(false)
  })

  it('全部候选过期:S7 定稿文案(LinkExpiredError 原句,可重试)', async () => {
    const api = makeFakeApi({
      respond: () => JSON.stringify({ retcode: -101, message: 'authkey timeout' }),
    })
    setAppDeps({ api, clock: fakeClock, pickFile: vi.fn(async () => null) })
    const store = useAppStore()

    await store.pasteImport(RAW_URL)

    expect(store.fetchError).toBeInstanceOf(LinkExpiredError)
    expect(store.fetchError?.message).toBe('祈愿链接已过期,请在游戏内重新打开祈愿记录页')
    expect(describeFetchError(store.fetchError!).retryable).toBe(true)
  })

  it('中途断网:已完成池保留并刷新展示(D14),错误呈现', async () => {
    const storage = makeFakeStorage({ '777': [] })
    setAppDeps({
      api: makeFakeApi({ reject: (poolCode) => poolCode === 302 }),
      clock: fakeClock,
      storage: storage.storage,
    })
    const store = useAppStore()
    await store.init() // 当前档案 777

    await store.pasteImport(RAW_URL)

    expect(store.fetchError).toBeInstanceOf(NetworkError)
    expect(store.fetchResult).toBeNull()
    expect(store.records).toHaveLength(3) // 301 池已落库页保留并刷新
    expect(store.archives.some((archive) => archive.uid === '777')).toBe(true) // archives 同步刷新
    expect(describeFetchError(store.fetchError!).note).toContain('已保留')
  })

  it('中断刷新(#2):无档案首次获取中断——archives 刷新可见新档,不自动认领', async () => {
    const storage = makeFakeStorage()
    setAppDeps({
      api: makeFakeApi({ reject: (poolCode) => poolCode === 302 }),
      clock: fakeClock,
      storage: storage.storage,
    })
    const store = useAppStore()

    await store.pasteImport(RAW_URL)

    expect(store.fetchError).toBeInstanceOf(NetworkError)
    expect(store.currentUid).toBeNull() // 守卫 uid 不可得:不自动切档
    expect(store.archives.some((archive) => archive.uid === '777')).toBe(true) // 建档与已入库数据可见
    expect(storage.db.get('777')).toHaveLength(3) // 数据保留
  })

  it('同步成功但档案刷新失败:成功态保留,降级非阻断提示(#8)', async () => {
    const storage = makeFakeStorage()
    setAppDeps({
      api: makeFakeApi(),
      clock: fakeClock,
      storage: {
        ...storage.storage,
        listArchives: async () => {
          throw new Error('db busy')
        },
      },
    })
    const store = useAppStore()

    await store.pasteImport(RAW_URL)

    expect(store.fetchResult).not.toBeNull() // 成功态不被刷新失败翻转
    expect(store.fetchError).toBeNull()
    expect(store.message?.text).toContain('刷新档案展示失败')
    expect(store.currentUid).toBe('777')
  })
})

describe('F1.3 文件导入', () => {
  it('取消选文件:静默返回,不打开任何弹窗', async () => {
    const pickFile = vi.fn(async () => null)
    setAppDeps({ pickFile })
    const store = useAppStore()

    await store.fileImport()

    expect(pickFile).toHaveBeenCalledTimes(1)
    expect(store.fetchOpen).toBe(false)
  })

  it('文件无链接:LinkParseError(入口层与缓存无链接区分)', async () => {
    setAppDeps({
      pickFile: vi.fn(async () => 'C:/old.log'),
      file: { readBytes: vi.fn(async () => cacheBytesOf('plain text')) },
    })
    const store = useAppStore()

    await store.fileImport()

    expect(store.fetchError).toBeInstanceOf(LinkParseError)
  })

  it('老日志文件含链接:提取后走同一管线', async () => {
    const storage = makeFakeStorage()
    setAppDeps({
      api: makeFakeApi(),
      clock: fakeClock,
      storage: storage.storage,
      pickFile: vi.fn(async () => 'C:/output_log.txt'),
      file: { readBytes: vi.fn(async () => cacheBytesOf(RAW_URL)) },
    })
    const store = useAppStore()

    await store.fileImport()

    expect(store.fetchResult?.added).toBe(15)
  })
})

describe('D9 多候选选择', () => {
  /** 两个不同 authkey → 两个不同 uid 的候选(RAW→777,GLOBAL→888) */
  function injectTwoCandidates(): FakeStorage {
    const storage = makeFakeStorage()
    const api = makeFakeApi({
      uid: (authkey) => (authkey?.startsWith('Xy') ? '888' : '777'),
    })
    setAppDeps({ api, clock: fakeClock, storage: storage.storage, pickFile: vi.fn(async () => null) })
    return storage
  }

  it('多候选不同 uid:挂起选择;选定后进入拉取', async () => {
    injectTwoCandidates()
    const store = useAppStore()

    await store.pasteImport(`${RAW_URL}\n${GLOBAL_URL}`)

    expect(store.pendingCandidates).toHaveLength(2)
    expect(store.fetchResult).toBeNull()

    const first = store.pendingCandidates![0]!
    await store.chooseCandidate(first)

    expect(store.pendingCandidates).toBeNull()
    expect(store.fetchResult?.uid).toBe('777')
  })

  it('取消选择:中止零写入', async () => {
    const storage = injectTwoCandidates()
    const store = useAppStore()

    await store.pasteImport(`${RAW_URL}\n${GLOBAL_URL}`)
    store.cancelCandidateSelection()

    expect(store.pendingCandidates).toBeNull()
    expect(store.fetchOpen).toBe(false)
    expect(storage.calls.insertRecords).not.toHaveBeenCalled()
  })
})

describe('uid 守卫与切换确认(PRD S5)', () => {
  it('候选 uid ≠ 当前档案:挂起确认,零写入;确认后以新 uid 重入', async () => {
    const storage = makeFakeStorage({ '111': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()
    await store.init()
    expect(store.currentUid).toBe('111')

    await store.pasteImport(RAW_URL) // 候选 uid 777

    expect(store.pendingMismatch).toEqual({ resolvedUid: '777', url: CN_CANONICAL })
    expect(storage.calls.ensureArchive).not.toHaveBeenCalled()
    expect(storage.calls.insertRecords).not.toHaveBeenCalled()

    await store.confirmArchiveSwitch()

    expect(store.pendingMismatch).toBeNull()
    expect(store.fetchResult?.uid).toBe('777')
    expect(store.currentUid).toBe('777')
    expect(store.records).toHaveLength(15)
  })

  it('拒绝切换:中止零写入,当前档案不变', async () => {
    const storage = makeFakeStorage({ '111': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()
    await store.init()

    await store.pasteImport(RAW_URL)
    store.cancelArchiveSwitch()

    expect(store.pendingMismatch).toBeNull()
    expect(store.fetchOpen).toBe(false)
    expect(store.currentUid).toBe('111')
    expect(storage.calls.insertRecords).not.toHaveBeenCalled()
  })

  it('候选 uid 为 null(探底空列表):由 syncAll 守卫确认真实 uid 后仍走切换确认', async () => {
    // 301 空(探底 uid=null),302 起有数据(守卫解析出 888)
    const api = makeFakeApi({
      uid: '888',
      countFor: (pool) => (pool === 301 ? 0 : 3),
    })
    const storage = makeFakeStorage({ '111': [storedRecord()] })
    setAppDeps({ api, clock: fakeClock, storage: storage.storage })
    const store = useAppStore()
    await store.init()

    await store.pasteImport(RAW_URL)

    expect(store.pendingCandidates).toBeNull()
    expect(store.pendingMismatch).toEqual({ resolvedUid: '888', url: CN_CANONICAL })

    await store.confirmArchiveSwitch()
    expect(store.currentUid).toBe('888')
  })
})

describe("'0' 哨兵档案并入(spec 03 §7)", () => {
  it('同步成功且存在未关联档案:给并入确认(n 取自 loadRecords),确认后 migrate', async () => {
    const storage = makeFakeStorage({ '0': [storedRecord(), storedRecord(), storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.pasteImport(RAW_URL)

    expect(store.pendingSentinelMerge).toEqual({ count: 3 })

    await store.confirmSentinelMerge()

    expect(storage.calls.migrateArchive).toHaveBeenCalledWith('0', '777')
    expect(store.pendingSentinelMerge).toBeNull()
    expect(store.records).toHaveLength(18) // 15 条同步 + 3 条并入
  })

  it("拒绝并入:零写入,'0' 档案保留", async () => {
    const storage = makeFakeStorage({ '0': [storedRecord()] })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()

    await store.pasteImport(RAW_URL)
    store.cancelSentinelMerge()

    expect(store.pendingSentinelMerge).toBeNull()
    expect(storage.calls.migrateArchive).not.toHaveBeenCalled()
    expect(storage.db.get('0')).toHaveLength(1)
  })
})

describe('F1.5 Excel 迁入(spec 03 §5 预览契约)', () => {
  function injectExcel(storage: FakeStorage = makeFakeStorage()) {
    const pickFile = vi.fn(async () => 'C:/wish.xlsx')
    setAppDeps({
      storage: storage.storage,
      pickFile,
      excel: { extractWorkbook: vi.fn(async () => makeWorkbook()) },
    })
    return { pickFile, storage }
  }

  it('选文件 → 预览:每表块/重建分布/重叠三数;取消零写入', async () => {
    injectExcel()
    const store = useAppStore()

    await store.openExcelImport()

    expect(store.excelOpen).toBe(true)
    const preview = store.excelPreview!
    expect(preview.sheets).toHaveLength(5)
    expect(preview.sheets[0]).toMatchObject({ poolLabel: '角色活动祈愿', rowCount: 3, fiveStarCount: 2 })
    expect(preview.sheets[0]!.gachaTypeCounts).toEqual([
      { gachaType: 301, count: 2 },
      { gachaType: 400, count: 1 },
    ])
    expect(preview.overlap).toEqual({ added: 5, skipped: 0, upgraded: 0 })
    expect(preview.issues.errors).toEqual([])

    store.cancelExcelImport()

    expect(store.excelOpen).toBe(false)
    expect(store.excelPreview).toBeNull()
  })

  it('确认导入:applyExcelImport 数字与预览一致(G8),记录刷新', async () => {
    const ctx = injectExcel()
    const store = useAppStore()
    await store.openExcelImport()
    const preview = store.excelPreview!

    await store.confirmExcelImport()

    expect(store.excelResult?.summary.added).toBe(preview.overlap?.added)
    expect(store.excelResult?.archiveUid).toBe('0') // 无档案 → 哨兵建档
    expect(store.currentUid).toBe('0')
    expect(store.records).toHaveLength(5)
    expect(ctx.storage.calls.insertRecords).toHaveBeenCalled()
  })

  it('解包失败:预览弹窗行内报错', async () => {
    setAppDeps({
      pickFile: vi.fn(async () => 'C:/broken.xlsx'),
      excel: { extractWorkbook: vi.fn(async () => { throw new Error('仅支持 .xlsx 文件') }) },
    })
    const store = useAppStore()

    await store.openExcelImport()

    expect(store.excelError).toBe('仅支持 .xlsx 文件')
    expect(store.excelPreview).toBeNull()
  })

  it('导入部分写入后失败:错误呈现且已写入数据刷新可见(#9)', async () => {
    const storage = makeFakeStorage({ '777': [] })
    setAppDeps({
      storage: {
        ...storage.storage,
        updateIdentity: async () => {
          throw new Error('db locked')
        },
      },
      pickFile: vi.fn(async () => 'C:/wish.xlsx'),
      excel: { extractWorkbook: vi.fn(async () => makeWorkbook()) },
    })
    const store = useAppStore()
    await store.init() // 当前档案 777

    await store.openExcelImport()
    expect(store.excelPreview).not.toBeNull()

    await store.confirmExcelImport()

    expect(store.excelError).toBe('db locked')
    expect(store.records).toHaveLength(5) // insertRecords 已落库,失败后刷新可见
  })
})

describe('D16 启动自动同步(静默)', () => {
  it('开关关:不做任何探测', async () => {
    localStorage.setItem('genshintool.autoSync', 'false')
    const listGameDirs = vi.fn(async () => [])
    setAppDeps({ listGameDirs })
    const store = useAppStore()

    await store.startupAutoSync()

    expect(listGameDirs).not.toHaveBeenCalled()
    expect(store.fetchOpen).toBe(false)
  })

  it('开关开 + 缓存可用:静默增量入库并认领最近同步档案,不弹窗', async () => {
    injectHappyPath()
    const store = useAppStore()

    await store.startupAutoSync()

    expect(store.fetchOpen).toBe(false)
    expect(store.message).toBeNull()
    expect(store.currentUid).toBe('777')
    expect(store.records).toHaveLength(15)
  })

  it('开关开 + macOS 无探测:静默跳过不抛错', async () => {
    const listGameDirs = vi.fn(async () => {
      throw new UnsupportedPlatformError()
    })
    setAppDeps({ listGameDirs })
    const store = useAppStore()

    await expect(store.startupAutoSync()).resolves.toBeUndefined()
    expect(store.fetchOpen).toBe(false)
  })

  it('启动同步进行中:busy 闸门生效,用户入口不可并发(#1)', async () => {
    let release!: (dirs: GameDirInfo[]) => void
    const gate = new Promise<GameDirInfo[]>((resolve) => {
      release = resolve
    })
    const listGameDirs = vi.fn(async () => gate)
    setAppDeps({
      api: makeFakeApi(),
      clock: fakeClock,
      storage: makeFakeStorage().storage,
      listGameDirs,
    })
    const store = useAppStore()

    const running = store.startupAutoSync()
    expect(store.syncing).toBe(true)
    expect(store.busy).toBe(true)

    // 同步进行中触发一键获取:被 busy 闸住,不产生第二次探测、不弹拉取弹窗
    await store.oneClickFetch()
    expect(listGameDirs).toHaveBeenCalledTimes(1)
    expect(store.fetchOpen).toBe(false)

    release([])
    await running
    expect(store.busy).toBe(false)
  })
})

describe('错误文案映射(spec 02 §7)', () => {
  it('ApiError 展示官方 message 且不重试(#4);NetworkError 注明已自动重试 3 次', () => {
    const api = describeFetchError(new ApiError(-5, '系统繁忙'))
    expect(api.text).toBe('官方接口返回错误:系统繁忙')
    expect(api.retryable).toBe(false) // §7:ApiError 不重试
    expect(api.note).toContain('已保留')

    const network = describeFetchError(new NetworkError())
    expect(network.text).toContain('已自动重试 3 次')
    expect(network.retryable).toBe(true)

    // 链接无效:重试同链接无意义,引导重新复制(#4)
    const invalid = describeFetchError(new LinkInvalidError())
    expect(invalid.retryable).toBe(false)
  })
})

describe('粘贴文本尾噪处理(T04 遗留)', () => {
  it('逐行 trim + 去行尾标点:空白与句读尾巴不并入 authkey', () => {
    expect(canonicalizePastedText(`  ${RAW_URL}  \n下一行`)).toEqual([CN_CANONICAL])
    expect(canonicalizePastedText(`${RAW_URL}。`)).toEqual([CN_CANONICAL])
  })

  it('全角标点尾噪:全角逗号/分号/右括号及 ASCII 混合尾巴被剔除(#3)', () => {
    expect(canonicalizePastedText(`${RAW_URL},`)).toEqual([CN_CANONICAL])
    expect(canonicalizePastedText(`${RAW_URL};`)).toEqual([CN_CANONICAL])
    expect(canonicalizePastedText(`${RAW_URL})`)).toEqual([CN_CANONICAL])
    expect(canonicalizePastedText(`${RAW_URL});`)).toEqual([CN_CANONICAL])
  })

  it('无链接返回空数组;缺 authkey 上抛 LinkParseError', () => {
    expect(canonicalizePastedText('没有任何链接')).toEqual([])
    expect(() => canonicalizePastedText('https://example.com/?auth_appid=webview_gacha')).toThrow(
      LinkParseError,
    )
  })
})

describe('档案切换动作(T18 UI 前置)', () => {
  it('switchArchive 只切状态,不删数据', async () => {
    const storage = makeFakeStorage({
      '777': [storedRecord()],
      '888': [storedRecord(), storedRecord()],
    })
    injectHappyPath(RAW_URL, storage)
    const store = useAppStore()
    await store.init()

    await store.switchArchive('888')

    expect(store.currentUid).toBe('888')
    expect(store.records).toHaveLength(2)
    expect(storage.db.get('777')).toHaveLength(1)
  })
})

/** 类型面冒烟:ProbeCandidate 形状(pick-list 组件展示字段) */
it('探底候选展示字段齐备', async () => {
  injectTwoCandidates()
  const store = useAppStore()
  await store.pasteImport(`${RAW_URL}\n${GLOBAL_URL}`)
  const candidates: ProbeCandidate[] = store.pendingCandidates!
  expect(candidates.map((candidate) => candidate.uid)).toEqual(['777', '888'])
  expect(candidates[0]!.latestTime).toMatch(/^2026-01-01 /)
})

function injectTwoCandidates() {
  const api = makeFakeApi({ uid: (authkey) => (authkey?.startsWith('Xy') ? '888' : '777') })
  setAppDeps({ api, clock: fakeClock, pickFile: vi.fn(async () => null) })
}
