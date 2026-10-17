/**
 * 文件选择器封装(tauri-plugin-dialog,与鸣潮同构):取消/关闭一律返回 null,
 * 由调用方决定静默或提示;动态 import 使 jsdom 测试无需加载插件运行时。
 */

export interface FilePickSpec {
  title: string
  /** 省略 = 不过滤;macOS 面板不认 "*" 通配扩展名,传了反而全灰 */
  filters?: { name: string; extensions: string[] }[]
}

/** Excel 历史迁入(PRD F1.5:v1 仅 xlsx) */
export const XLSX_PICK: FilePickSpec = {
  title: '选择祈愿记录 Excel(.xlsx)',
  filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
}

/** 链接文件导入(PRD F1.3 兜底:老日志/云原神日志/手动拷出的 data_2);
 *  不带过滤器——目标文件可能是无扩展名的 data_2,任何扩展名白名单都会挡住它 */
export const LINK_FILE_PICK: FilePickSpec = {
  title: '选择含祈愿链接的文件',
}

/** 备份导入(PRD F4:自有 JSON 格式 genshintool-backup-*.json) */
export const BACKUP_FILE_PICK: FilePickSpec = {
  title: '选择备份文件',
  filters: [{ name: 'JSON 备份', extensions: ['json'] }],
}

/** 备份导出的保存对话框参数(defaultPath = 默认文件名) */
export interface FileSaveSpec {
  title: string
  defaultPath: string
  filters: { name: string; extensions: string[] }[]
}

/** 导出备份:系统保存对话框定路径,取消返回 null */
export async function pickSavePath(spec: FileSaveSpec): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const selected = await save({
    title: spec.title,
    defaultPath: spec.defaultPath,
    filters: spec.filters,
  })
  return typeof selected === 'string' ? selected : null
}

/** 单选文件;取消返回 null */
export async function pickFile(spec: FilePickSpec): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    title: spec.title,
    multiple: false,
    directory: false,
    filters: spec.filters?.length ? spec.filters : undefined,
  })
  return typeof selected === 'string' ? selected : null
}
