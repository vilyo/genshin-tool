/**
 * 文件选择器封装(tauri-plugin-dialog,与鸣潮同构):取消/关闭一律返回 null,
 * 由调用方决定静默或提示;动态 import 使 jsdom 测试无需加载插件运行时。
 */

export interface FilePickSpec {
  title: string
  filters: { name: string; extensions: string[] }[]
}

/** Excel 历史迁入(PRD F1.5:v1 仅 xlsx) */
export const XLSX_PICK: FilePickSpec = {
  title: '选择祈愿记录 Excel(.xlsx)',
  filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
}

/** 链接文件导入(PRD F1.3 兜底:老日志/云原神日志/手动拷出的 data_2) */
export const LINK_FILE_PICK: FilePickSpec = {
  title: '选择含祈愿链接的文件',
  filters: [{ name: '全部文件', extensions: ['*'] }],
}

/** 单选文件;取消返回 null */
export async function pickFile(spec: FilePickSpec): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    title: spec.title,
    multiple: false,
    directory: false,
    filters: spec.filters,
  })
  return typeof selected === 'string' ? selected : null
}
