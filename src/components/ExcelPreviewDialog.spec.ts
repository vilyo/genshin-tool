import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import type { ExcelIssue, ExcelWarningGroup } from '@/domain/excelImport'
import { previewExcelImport } from '@/domain/excelImport'
import { makeWorkbook } from '@/test-support/appFakes'
import { useAppStore } from '@/stores/app'
import ExcelPreviewDialog from './ExcelPreviewDialog.vue'

/** 先落 store 状态再挂载(条件渲染以首帧呈现) */
function mountDialog(setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(ExcelPreviewDialog, { global: { plugins: [pinia] } }), store }
}

const ERROR_ISSUE: ExcelIssue = {
  kind: 'row',
  sheetName: '角色活动祈愿',
  row: 3,
  message: '星级无法归一为 3/4/5',
}
const WARNING_GROUP: ExcelWarningGroup = {
  kind: 'countGap',
  label: '总次数不连续',
  count: 1,
  issues: [{ kind: 'countGap', sheetName: '角色活动祈愿', row: 4, message: '总次数缺号:缺 2' }],
}

describe('ExcelPreviewDialog(F1.5 预览契约)', () => {
  it('解析中文案', () => {
    const { wrapper } = mountDialog((store) => {
      store.excelOpen = true
      store.excelLoading = true
    })
    expect(wrapper.find('.stage-line').text()).toBe('正在解析工作簿…')
  })

  it('解析失败:行内报错 + 关闭', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.excelOpen = true
      store.excelError = '仅支持 .xlsx 文件'
    })

    expect(wrapper.find('.error-text').text()).toBe('仅支持 .xlsx 文件')

    await wrapper.findAll('button').find((button) => button.text() === '关闭')!.trigger('click')
    expect(store.excelOpen).toBe(false)
  })

  it('预览页:每表一块(池名/重建分布/条数/五星)、重叠三数、确认按钮带总量', () => {
    const { wrapper } = mountDialog((store) => {
      store.excelOpen = true
      store.excelPreview = previewExcelImport(makeWorkbook(), [])
    })

    const blocks = wrapper.findAll('.sheet-block')
    expect(blocks).toHaveLength(5)
    expect(blocks[0]!.text()).toContain('角色活动祈愿')
    expect(blocks[0]!.text()).toContain('301×2 / 400×1') // 备注重建分布
    expect(blocks[0]!.text()).toContain('3 条')
    expect(blocks[0]!.text()).toContain('五星 2')
    expect(blocks[4]!.text()).toContain('新手祈愿')

    expect(wrapper.find('.overlap-line').text()).toContain('将新增 5 条')
    expect(wrapper.find('.overlap-line').text()).toContain('重叠 0 条')

    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('导入 5 条'))!
    expect(confirm.text()).toBe('导入 5 条(新增 5)')
  })

  it('校验报告:ERROR 逐条可展开、WARNING 分类计数可展开', () => {
    const { wrapper } = mountDialog((store) => {
      store.excelOpen = true
      store.excelPreview = {
        ...previewExcelImport(makeWorkbook(), []),
        issues: { errors: [ERROR_ISSUE], warnings: [WARNING_GROUP] },
      }
    })

    const groups = wrapper.findAll('details.issue-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.classes()).toContain('is-error')
    expect(groups[0]!.find('summary').text()).toContain('ERROR 1 行')
    expect(groups[0]!.text()).toContain('星级无法归一为 3/4/5')
    expect(groups[1]!.find('summary').text()).toContain('总次数不连续 1 条')
  })

  it('取消:零写入并关闭', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.excelOpen = true
      store.excelPreview = previewExcelImport(makeWorkbook(), [])
    })

    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')

    expect(store.excelOpen).toBe(false)
    expect(store.excelPreview).toBeNull()
  })

  it('确认导入:交 store 落库', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.excelOpen = true
      store.excelPreview = previewExcelImport(makeWorkbook(), [])
    })
    const spy = vi.spyOn(store, 'confirmExcelImport').mockResolvedValue(undefined)

    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('导入 5 条'))!
      .trigger('click')

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('完成报告:三数与档案 UID,完成后关闭', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.excelOpen = true
      store.excelResult = {
        archiveUid: '0',
        createdSentinel: true,
        parse: previewExcelImport(makeWorkbook(), []),
        summary: { added: 5, upgraded: 0, skipped: 0 },
      }
    })

    expect(wrapper.find('.done-line').text()).toContain('新增 5 条')
    expect(wrapper.find('.done-line').text()).toContain('重叠跳过 0 条')
    expect(wrapper.text()).toContain('档案 UID 0')

    await wrapper.findAll('button').find((button) => button.text() === '完成')!.trigger('click')
    expect(store.excelOpen).toBe(false)
  })
})
