#!/usr/bin/env node
/**
 * 图标资源构建期下载(ADR-0005:genshin-db 映射 + Enka 素材,T18):
 * 1. genshin-db(离线)枚举五星角色/武器的中文名与 UI 文件名(filename_icon);
 * 2. 从 https://enka.network/ui/{UI文件名}.png 下载(并发 ≤4),落
 *    src/assets/icons/{character|weapon}/{UI文件名}.png;
 * 3. 生成 src/assets/icons/manifest.json:中文名 → { path, weapon? }(武器子类型文案)。
 *
 * 纪律:
 * - 幂等可重跑:已存在的图片文件跳过下载;manifest 每次按「盘上实际存在的文件」重建。
 * - 单张 >500KB 跳过(体积控制);非 PNG 响应拒绝;单张失败只记警告,不卡构建。
 * - 网络不可用/全部失败:仍写出 manifest(可能为空映射)并正常退出 0——运行时
 *   avatarFor 按 manifest 映射取图,缺映射/缺文件一律回退占位章,不影响应用。
 * - 只收五星(四星可选未开,控制仓库体积;需要时在 FIVE_STAR_ONLY 放开)。
 *
 * 再跑时机:genshin-db 升级(新版本新角色/武器)后 `npm run icons` 重新下载;
 * 未重跑前新物品在界面显示占位章(ADR-0005 后果条,可接受的滞后)。
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const genshinDb = require('genshin-db')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'icons')
const ENKA_UI = 'https://enka.network/ui'
const CONCURRENCY = 4
const MAX_FILE_BYTES = 500 * 1024
const FETCH_TIMEOUT_MS = 30_000
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const FIVE_STAR_ONLY = true
const DB_OPTS = { resultLanguage: 'chs', queryLanguages: ['chs'] }

const warnings = []

/** genshin-db 枚举某类物品的中文名(rarity 过滤,默认只五星) */
function namesOf(kind) {
  const query = kind === 'character' ? genshinDb.characters : genshinDb.weapons
  const names = query('names', { ...DB_OPTS, matchCategories: true })
  return names.filter((name) => {
    const info = query(name, DB_OPTS)
    return FIVE_STAR_ONLY ? info?.rarity === 5 : info !== undefined
  })
}

/** 下载单张图标;已存在即跳过(幂等)。任何失败抛错,由调用方记警告 */
async function fetchIcon(uiName, destFile) {
  if (existsSync(destFile)) return
  const res = await fetch(`${ENKA_UI}/${uiName}.png`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(`超过 ${Math.round(MAX_FILE_BYTES / 1024)}KB 体积上限(${bytes.length} 字节)`)
  }
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('响应不是 PNG 图片')
  await mkdir(path.dirname(destFile), { recursive: true })
  await writeFile(destFile, bytes)
}

/** 小并发工作池:并发 ≤ CONCURRENCY,失败逐条收集为警告 */
async function downloadAll(items) {
  let index = 0
  async function worker() {
    while (index < items.length) {
      const item = items[index++]
      try {
        await fetchIcon(item.uiName, item.destFile)
      } catch (error) {
        warnings.push(`${item.name}(${item.uiName}):${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  /** @type {{ name: string, uiName: string, destFile: string, relPath: string, weapon?: string }[]} */
  const items = []
  for (const name of namesOf('character')) {
    const uiName = genshinDb.characters(name, DB_OPTS)?.images?.filename_icon
    if (typeof uiName !== 'string' || uiName === '') {
      warnings.push(`角色 ${name}:缺 filename_icon,跳过`)
      continue
    }
    items.push({
      name,
      uiName,
      destFile: path.join(OUT_DIR, 'character', `${uiName}.png`),
      relPath: `character/${uiName}.png`,
    })
  }
  for (const name of namesOf('weapon')) {
    const info = genshinDb.weapons(name, DB_OPTS)
    const uiName = info?.images?.filename_icon
    if (typeof uiName !== 'string' || uiName === '') {
      warnings.push(`武器 ${name}:缺 filename_icon,跳过`)
      continue
    }
    items.push({
      name,
      uiName,
      destFile: path.join(OUT_DIR, 'weapon', `${uiName}.png`),
      relPath: `weapon/${uiName}.png`,
      weapon: info.weaponText,
    })
  }
  console.log(`清单:${items.length} 张(五星 ${FIVE_STAR_ONLY ? 'only' : 'off'})`)

  await downloadAll(items)

  /** @type {Record<string, { path: string, weapon?: string }>} */
  const manifest = {}
  let present = 0
  for (const item of items) {
    // manifest 只收录盘上实际存在的文件;缺文件的条目回退占位章(运行时自动兜底)
    if (!existsSync(item.destFile)) continue
    present += 1
    manifest[item.name] =
      item.weapon === undefined ? { path: item.relPath } : { path: item.relPath, weapon: item.weapon }
  }
  const manifestPath = path.join(OUT_DIR, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`完成:${present}/${items.length} 张就位 → ${path.relative(ROOT, manifestPath)}`)
  if (warnings.length > 0) {
    console.warn(`警告 ${warnings.length} 条(已跳过,不影响退出):`)
    for (const line of warnings) console.warn(`  - ${line}`)
  }
}

main().catch((error) => {
  // 只防清单组装层的意外;下载失败已降级为警告。此处失败仍先尝试写空 manifest。
  console.error(`图标脚本异常:${error instanceof Error ? error.message : String(error)}`)
  writeFile(path.join(OUT_DIR, 'manifest.json'), '{}\n')
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
})
