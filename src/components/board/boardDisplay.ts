/**
 * 主画面显示映射助手(T17):领域值 → 视觉编码的薄映射层。
 * 只调用 domain 纯函数,不定义任何统计口径;头像/图标包(ADR-0005)经 avatarFor
 * 接入:构建期清单(src/assets/icons/manifest.json,fetch-icons.mjs 产物)有映射
 * 返回图标 URL,缺映射/缺文件回退首字占位章,不阻塞渲染。
 */
import { constellationOf, refinementOf } from '@/domain/roster'
import { STANDARD_ROSTER } from '@/domain/standardRoster'
import type { PoolCategory } from '@/domain/pools'
import type { RosterView } from '@/domain/roster'
import { degreeOf, type Degree } from '@/domain/verdict'
import iconManifest from '@/assets/icons/manifest.json'

/** 程度档的显示词与 CSS 档色类(量距条/档位词/印签共用) */
export const DEGREE_META: Record<Degree, { label: string; cls: string }> = {
  superLucky: { label: '超欧', cls: 'deg-super-lucky' },
  lucky: { label: '欧', cls: 'deg-lucky' },
  normal: { label: '正常', cls: 'deg-normal' },
  unlucky: { label: '超非', cls: 'deg-unlucky' },
}

/** 头像解析结果:icon = 内置图标(ADR-0005);placeholder = 首字占位章(兜底) */
export type Avatar =
  | { kind: 'icon'; char: string; url: string }
  | { kind: 'placeholder'; char: string; url: null }

/** 清单条目(fetch-icons.mjs 产物):path 相对 icons 目录;weapon = 武器子类型文案 */
interface IconManifestEntry {
  path: string
  weapon?: string
}

/** 静态内置清单(manifest.json 随应用打包);重跑 npm run icons 更新 */
const ICON_MANIFEST = iconManifest as Record<string, IconManifestEntry>

/**
 * 构建期内置图标的 URL 索引:import.meta.glob 构建期展开为「文件路径 → 资源 URL」,
 * 运行时零出网取图(G4)。清单位置与 glob 基准一致(本文件上两级的 assets/icons)。
 */
const ICON_URLS = import.meta.glob('../../assets/icons/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * 头像映射(ADR-0005):清单有该名称且对应文件已内置 → 图标 URL;
 * 名称未收录(新内容未重跑脚本)或文件缺失 → 首字占位章。
 * manifest 参数默认取内置清单,测试可注入合成清单验证映射与回退两路。
 */
export function avatarFor(
  name: string,
  manifest: Record<string, IconManifestEntry> = ICON_MANIFEST,
): Avatar {
  const char = name.slice(0, 1)
  const entry = manifest[name]
  const url = entry === undefined ? undefined : ICON_URLS[`../../assets/icons/${entry.path}`]
  if (entry !== undefined && url !== undefined) {
    return { kind: 'icon', char, url }
  }
  return { kind: 'placeholder', char, url: null }
}

/** 名单内物品的类别(名单外 null;仅用于 C/R 标注的选型,不作任何判定) */
function rosterKind(name: string): 'character' | 'weapon' | null {
  return STANDARD_ROSTER.find((entry) => entry.name === name)?.kind ?? null
}

/**
 * 获取序的 C/R 标注(spec §0 #10):角色活动池恒角色(C)、武器活动池恒武器(R);
 * 常驻/集录等混合作用域按常驻名单的类别选型,名单外不标(保守,不出错标)。
 * 首次获取(C0/R0)不显示标,与图版一致。
 */
export function acquireTag(scope: PoolCategory, name: string, globalIndex: number): string | null {
  const kind =
    scope === 'eventChar' ? 'character' : scope === 'eventWeapon' ? 'weapon' : rosterKind(name)
  if (kind === 'character') {
    const value = constellationOf(globalIndex)
    return value >= 1 ? `C${value}` : null
  }
  if (kind === 'weapon') {
    const value = refinementOf(globalIndex)
    return value >= 1 ? `R${value}` : null
  }
  return null
}

/** 名册条目 ↔ 时间线行的联查键(两侧同源于 stats.fives,字段一一对应) */
export function timelineKey(
  name: string,
  date: string,
  pool: string,
  pulls: number,
): string {
  return `${name}|${date}|${pool}|${pulls}`
}

/** 名册视图 → 「联查键 → C/R 标注」索引(时间线标注不重算跨池序) */
export function buildTagIndex(scope: PoolCategory, roster: RosterView): Map<string, string | null> {
  const index = new Map<string, string | null>()
  for (const card of roster.cards) {
    for (const acquisition of card.acquisitions) {
      index.set(
        timelineKey(card.name, acquisition.date, acquisition.pool, acquisition.pulls),
        acquireTag(scope, card.name, acquisition.globalIndex),
      )
    }
  }
  return index
}

/**
 * 量距条档位界线(抽数):按 degreeOf 反解档位跳变点——角色类 22/45/76、武器 19/40/68
 * 只在 verdict.ts 档表维护一处,此处不重复定义(扫描上界 90 ≥ 最大硬保底)。
 */
export function meterBounds(scope: PoolCategory): [number, number, number] {
  const bounds: number[] = []
  let prev = degreeOf(1, scope)
  for (let pulls = 2; pulls <= 90; pulls += 1) {
    const degree = degreeOf(pulls, scope)
    if (degree !== prev) {
      bounds.push(pulls - 1)
      prev = degree
    }
  }
  return [bounds[0]!, bounds[1]!, bounds[2]!]
}

/** 比率百分比文案:保留一位小数并去尾 .0(0.6 → '60%',0.4 → '40%') */
export function percentText(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`
}
