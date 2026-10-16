/**
 * Excel 解包命令的 ExcelPort 适配(ADR-0004:T09 extract_xlsx 只解包,语义全在 TS;
 * tauriPorts.ts 属 T08 交付产物不在本任务改动范围,故此处单独落 Excel 侧映射)。
 * 拒绝值(Rust 错误串:超 20MB/200k 行、非 xlsx 等)归一为普通 Error(文案直出)。
 */
import { invoke } from '@tauri-apps/api/core'
import type { ExcelPort, WorkbookData } from '@/domain/excelImport'

function asMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw !== '') return raw
  if (raw !== null && typeof raw === 'object' && 'message' in raw) {
    const message = (raw as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

export const tauriExcel: ExcelPort = {
  async extractWorkbook(path: string): Promise<WorkbookData> {
    try {
      return await invoke<WorkbookData>('extract_xlsx', { path })
    } catch (raw) {
      throw new Error(asMessage(raw, '解析 Excel 文件失败'))
    }
  },
}
