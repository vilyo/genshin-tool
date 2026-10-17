// 定稿「凝缘」PNG 是唯一母版；重新生成桌面图标与前端品牌图标。
// 用法：node scripts/make-icon.mjs（不依赖 macOS 专用渲染工具）
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const source = fileURLToPath(new URL('./app-icon.png', import.meta.url))
const output = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url))
const assets = fileURLToPath(new URL('../src/assets/', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'genshintool-icons-'))

try {
  execFileSync(process.execPath, [
    require.resolve('@tauri-apps/cli/tauri.js'),
    'icon', source, '--output', temporary,
  ], { stdio: 'pipe' })

  mkdirSync(output, { recursive: true })
  // Tauri 同时生成移动端资源；本项目仅保留根目录的桌面资源。
  for (const entry of readdirSync(temporary, { withFileTypes: true })) {
    if (entry.isFile() && /\.(png|ico|icns)$/.test(entry.name)) {
      copyFileSync(join(temporary, entry.name), join(output, entry.name))
    }
  }
  mkdirSync(assets, { recursive: true })
  copyFileSync(join(output, '128x128.png'), join(assets, 'app-icon.png'))
  console.log('已从定稿 PNG 更新桌面图标与前端品牌图标')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
