import { describe, expect, it } from 'vitest'
import iconManifest from '@/assets/icons/manifest.json'
import { avatarFor } from './boardDisplay'

type IconManifest = Record<string, { path: string; weapon?: string }>

/** 内置清单(fetch-icons.mjs 产物)在测试环境静态可导入 */
const manifest = iconManifest as IconManifest

describe('avatarFor(ADR-0005 图标映射)', () => {
  it('内置清单与盘上文件一致:每个条目都解析为图标 URL', () => {
    // 一致性守卫:manifest 有映射而 glob 缺文件 = 仓库状态漂移,此处直接失败
    expect(Object.keys(manifest).length).toBeGreaterThan(0)
    for (const [name, entry] of Object.entries(manifest)) {
      const avatar = avatarFor(name)
      expect(avatar.kind, name).toBe('icon')
      expect(avatar.url, name).toContain(entry.path)
    }
  })

  it('映射命中:返回图标 URL,首字仍随行(注入合成清单验证映射路)', () => {
    const avatar = avatarFor('温迪', {
      温迪: { path: 'character/UI_AvatarIcon_Venti.png' },
    })
    expect(avatar).toEqual({
      kind: 'icon',
      char: '温',
      url: expect.stringContaining('UI_AvatarIcon_Venti'),
    })
  })

  it('名称未收录:回退首字占位章', () => {
    const avatar = avatarFor('未来新角色')
    expect(avatar).toEqual({ kind: 'placeholder', char: '未', url: null })
  })

  it('清单有映射但文件缺失:同样回退占位章,不阻塞渲染', () => {
    const avatar = avatarFor('幽灵物品', {
      幽灵物品: { path: 'character/UI_NotBundled_Missing.png', weapon: '弓' },
    })
    expect(avatar).toEqual({ kind: 'placeholder', char: '幽', url: null })
  })
})
