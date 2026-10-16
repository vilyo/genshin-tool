import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { Mock } from 'vitest'
import { CacheLinkNotFoundError, NetworkError, UnsupportedPlatformError } from '@/domain/errors'
import type { WishRecord } from '@/domain/records'
import {
  ProbeIoError,
  copyToTemp,
  listGameDirs,
  realClock,
  tauriFile,
  tauriGachaApi,
  tauriStorage,
  toProbeError,
  webcacheCandidates,
} from './tauriPorts'

// jsdom 无 Tauri 运行时:mock invoke,断言命令名/参数与返回、错误映射
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = invoke as unknown as Mock

beforeEach(() => {
  invokeMock.mockReset()
})

/** 捕获 Promise 的拒绝值供断言(避免 unhandled rejection) */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('预期应拒绝,却正常返回')
}

describe('tauriGachaApi(gacha_get)', () => {
  it('get 透传规范 URL 并返回响应体原文', async () => {
    invokeMock.mockResolvedValue('{"retcode":0}')
    const url = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=Ab%2Bcd'

    const body = await tauriGachaApi.get(url)

    expect(invokeMock).toHaveBeenCalledWith('gacha_get', { url })
    expect(body).toBe('{"retcode":0}')
  })

  it('命令拒绝(Rust 错误串)映射为 NetworkError 且保留文案(唯一可重试类)', async () => {
    invokeMock.mockRejectedValue('祈愿记录请求失败:connection reset')

    const error = (await caught(tauriGachaApi.get('https://x'))) as NetworkError

    expect(error).toBeInstanceOf(NetworkError)
    expect(error.message).toBe('祈愿记录请求失败:connection reset')
  })

  it('非字符串拒绝(命令缺失等)落到默认 NetworkError 文案', async () => {
    invokeMock.mockRejectedValue({ weird: true })

    const error = (await caught(tauriGachaApi.get('https://x'))) as NetworkError

    expect(error).toBeInstanceOf(NetworkError)
    expect(error.message).toBe('网络请求失败,请检查网络后重试(已自动重试 3 次)')
  })
})

describe('tauriFile(read_file_bytes)', () => {
  it('readBytes 还原为 Uint8Array 并透传 path', async () => {
    invokeMock.mockResolvedValue([0, 1, 254, 255])

    const bytes = await tauriFile.readBytes('C:/tmp/data_2')

    expect(invokeMock).toHaveBeenCalledWith('read_file_bytes', { path: 'C:/tmp/data_2' })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes)).toEqual([0, 1, 254, 255])
  })

  it('读取失败(Rust 错误串)归一为普通 Error,不参与拉取重试', async () => {
    invokeMock.mockRejectedValue('缓存文件超过 64MB 读取上限')

    const error = (await caught(tauriFile.readBytes('C:/tmp/data_2'))) as Error

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(NetworkError)
    expect(error.message).toBe('缓存文件超过 64MB 读取上限')
  })
})

describe('realClock(ClockPort)', () => {
  it('now 取当前毫秒时间戳,sleep 以真实定时器兑现', async () => {
    const before = Date.now()
    const now = realClock.now()
    await realClock.sleep(2)

    expect(now).toBeGreaterThanOrEqual(before)
    expect(Math.abs(now - Date.now())).toBeLessThan(1000)
  })
})

describe('tauriStorage(db_* 映射)', () => {
  const wish: WishRecord = { gachaType: 301, time: '2026-09-23 21:14:36', name: '刻晴', rankType: 5, id: null }

  it('逐方法映射 db_* 命令名与 camelCase 参数键(T02 签名)', async () => {
    invokeMock.mockResolvedValue([])
    await tauriStorage.loadRecords('u1')
    await tauriStorage.insertRecords('u1', [wish])
    await tauriStorage.updateIdentity([{ rowid: 7, id: '1800000000000000001' }])
    await tauriStorage.updateIdentity([{ rowid: 8, id: '1800000000000000002', gachaType: 400 }])
    await tauriStorage.getWatermark('u1', 301)
    await tauriStorage.setWatermark('u1', 301, '1800000000000000001')
    await tauriStorage.setLastSynced('u1', '2026-10-16T00:00:00.000Z')
    await tauriStorage.clearArchive('u1')
    await tauriStorage.migrateArchive('0', 'u1')
    await tauriStorage.listArchives()
    await tauriStorage.ensureArchive('u1')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'db_load_records', { uid: 'u1' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'db_insert_records', { uid: 'u1', rows: [wish] })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'db_update_identity', {
      updates: [{ rowid: 7, id: '1800000000000000001' }],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'db_update_identity', {
      updates: [{ rowid: 8, id: '1800000000000000002', gachaType: 400 }],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'db_get_watermark', { uid: 'u1', gachaType: 301 })
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'db_set_watermark', {
      uid: 'u1',
      gachaType: 301,
      id: '1800000000000000001',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(7, 'db_set_last_synced', {
      uid: 'u1',
      iso: '2026-10-16T00:00:00.000Z',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(8, 'db_clear_archive', { uid: 'u1' })
    expect(invokeMock).toHaveBeenNthCalledWith(9, 'db_migrate_archive', { from: '0', to: 'u1' })
    expect(invokeMock).toHaveBeenNthCalledWith(10, 'db_list_archives', undefined)
    expect(invokeMock).toHaveBeenNthCalledWith(11, 'db_ensure_archive', { uid: 'u1' })
  })

  it('insertRecords 接受 readonly 数组,getWatermark 透传 null 水位,loadRecords 原样回传行', async () => {
    invokeMock
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([
        { gachaType: 400, time: '2026-09-24 08:00:00', name: '钟离', rankType: 5, id: '18', seq: 0, rowid: 1 },
      ])

    const frozen: readonly WishRecord[] = Object.freeze([wish])
    await expect(tauriStorage.insertRecords('u1', frozen)).resolves.toBe(2)
    await expect(tauriStorage.getWatermark('u1', 302)).resolves.toBeNull()
    const records = await tauriStorage.loadRecords('u1')
    expect(records).toEqual([
      { gachaType: 400, time: '2026-09-24 08:00:00', name: '钟离', rankType: 5, id: '18', seq: 0, rowid: 1 },
    ])
  })

  it('db_* 拒绝值(Rust 错误文案串)归一为 Error(message)', async () => {
    invokeMock.mockRejectedValue('写入祈愿记录失败:UNIQUE constraint failed')

    const error = (await caught(tauriStorage.insertRecords('u1', [wish]))) as Error

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('写入祈愿记录失败:UNIQUE constraint failed')
  })
})

describe('探测命令包装(spec 02 §2)', () => {
  it('透传命令名与 camelCase 参数键', async () => {
    invokeMock.mockResolvedValue([])
    await listGameDirs()
    await webcacheCandidates('C:/game/GenshinImpact_Data')
    await copyToTemp('C:/tmp/data_2')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_game_dirs')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'webcache_candidates', {
      gameDir: 'C:/game/GenshinImpact_Data',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'copy_to_temp', { path: 'C:/tmp/data_2' })
  })

  it('listGameDirs 透传 GameDirInfo 行', async () => {
    invokeMock.mockResolvedValue([
      { region: 'cn', gameDir: 'C:/a/YuanShen_Data', logMtime: '2026-10-16T00:00:00.000Z' },
    ])

    await expect(listGameDirs()).resolves.toEqual([
      { region: 'cn', gameDir: 'C:/a/YuanShen_Data', logMtime: '2026-10-16T00:00:00.000Z' },
    ])
  })

  it('toProbeError 按 kind 映射 domain 错误类', () => {
    expect(toProbeError({ kind: 'unsupported_platform', message: 'macOS 请手动粘贴' })).toBeInstanceOf(
      UnsupportedPlatformError,
    )
    expect(toProbeError({ kind: 'not_found', message: 'gone' })).toBeInstanceOf(CacheLinkNotFoundError)
    expect(toProbeError({ kind: 'io', message: 'locked' })).toBeInstanceOf(ProbeIoError)
    // 未知形状归普通 Error,保留文案
    const fallback = toProbeError('boom')
    expect(fallback).toBeInstanceOf(Error)
    expect(fallback.message).toBe('boom')
  })

  it('macOS 调自动探测:拒绝 {kind:unsupported_platform} → UnsupportedPlatformError', async () => {
    invokeMock.mockRejectedValue({ kind: 'unsupported_platform', message: '自动获取仅支持 Windows' })

    const error = (await caught(listGameDirs())) as UnsupportedPlatformError

    expect(error).toBeInstanceOf(UnsupportedPlatformError)
    expect(error.message).toBe('自动获取仅支持 Windows')
  })

  it('copyToTemp 拒绝 {kind:io} → ProbeIoError(引导手动导入的专用错误)', async () => {
    invokeMock.mockRejectedValue({ kind: 'io', message: '复制游戏缓存文件失败:锁定' })

    const error = (await caught(copyToTemp('C:/tmp/data_2'))) as ProbeIoError

    expect(error).toBeInstanceOf(ProbeIoError)
    expect(error.message).toBe('复制游戏缓存文件失败:锁定')
  })
})
