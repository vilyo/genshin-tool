// 生成品牌图标「祈愿之星」(1024×1024 PNG)
// 语义: 深蓝夜空底 = 祈愿界面, 金色外环 + 刻度 = 保底进度盘(金弧 = 已垫 60/90), 中央四芒星 = 五星出货
// 视觉: 原神祈愿界面蓝黑 + 金 (#D3BC8E 家族)
// 用法: node scripts/make-icon.mjs && npm run tauri icon -- scripts/app-icon.png -o src-tauri/icons
// (渲染用 macOS 自带 qlmanage 将 SVG 转位图, 开发环境为 macOS)
import { writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const D2R = Math.PI / 180
const pol = (cx, cy, r, deg) => [
  cx + r * Math.cos(deg * D2R),
  cy + r * Math.sin(deg * D2R),
]
const f = (n) => n.toFixed(1)

// 外环刻度: 90 抽保底,每 5 抽一小刻,四正向为主刻
const ticks = []
for (let i = 0; i < 18; i++) {
  const deg = -90 + i * 20
  const major = i % 4.5 === 0 // 0 / 90 / 180 / 270 度方向
  const [x1, y1] = pol(512, 512, major ? 356 : 366, deg)
  const [x2, y2] = pol(512, 512, 388, deg)
  ticks.push(
    `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#EFE0B0" stroke-width="${major ? 5 : 2.5}" stroke-opacity="${major ? 0.95 : 0.5}"/>`,
  )
}

// 保底进度弧: 已垫 60/90
const sweep = (60 / 90) * 360
const [ex, ey] = pol(512, 512, 372, -90 + sweep)

// 中央四芒星(内凹曲线边,祈愿之星)+ 高光小星
const sparkle = `M 512 128 C 549 405 619 475 896 512 C 619 549 549 619 512 896 C 475 619 405 549 128 512 C 405 475 475 405 512 128 Z`
const mini = (cx, cy, r) =>
  `M ${f(cx)} ${f(cy - r)} C ${f(cx + r * 0.12)} ${f(cy - r * 0.32)} ${f(cx + r * 0.32)} ${f(cy - r * 0.12)} ${f(cx + r)} ${f(cy)} C ${f(cx + r * 0.32)} ${f(cy + r * 0.12)} ${f(cx + r * 0.12)} ${f(cy + r * 0.32)} ${f(cx)} ${f(cy + r)} C ${f(cx - r * 0.12)} ${f(cy + r * 0.32)} ${f(cx - r * 0.32)} ${f(cy + r * 0.12)} ${f(cx - r)} ${f(cy)} C ${f(cx - r * 0.32)} ${f(cy - r * 0.12)} ${f(cx - r * 0.12)} ${f(cy - r * 0.32)} ${f(cx)} ${f(cy - r)} Z`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="i-bg" cx="0.5" cy="0.42" r="0.78">
    <stop offset="0" stop-color="#161827"/><stop offset="0.65" stop-color="#0E0F1A"/><stop offset="1" stop-color="#08090F"/>
  </radialGradient>
  <radialGradient id="i-halo" cx="0.5" cy="0.46" r="0.5">
    <stop offset="0" stop-color="#D3BC8E" stop-opacity="0.14"/><stop offset="1" stop-color="#D3BC8E" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="i-arc" x1="190" y1="190" x2="834" y2="834" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#F2E3B4"/><stop offset="1" stop-color="#9A7F45"/>
  </linearGradient>
  <linearGradient id="i-gold" x1="0" y1="128" x2="0" y2="896" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#EFE0B0"/><stop offset="1" stop-color="#B49A5E"/>
  </linearGradient>
</defs>
<rect width="1024" height="1024" fill="#08090F"/>
<rect width="1024" height="1024" fill="url(#i-bg)"/>
<circle cx="512" cy="512" r="400" fill="none" stroke="#D3BC8E" stroke-width="2.5" stroke-opacity="0.9"/>
${ticks.join('\n')}
<path d="M 512 140 A 372 372 0 1 1 ${f(ex)} ${f(ey)}" fill="none" stroke="url(#i-arc)" stroke-width="12"/>
<circle cx="${f(ex)}" cy="${f(ey)}" r="18" fill="#EFE0B0" opacity="0.25"/>
<circle cx="${f(ex)}" cy="${f(ey)}" r="9" fill="#FFF7DF"/>
<rect width="1024" height="1024" fill="url(#i-halo)"/>
<path d="${sparkle}" fill="url(#i-gold)"/>
<path d="${mini(706, 318, 46)}" fill="#EFE0B0" fill-opacity="0.85"/>
<path d="${mini(340, 700, 28)}" fill="#D3BC8E" fill-opacity="0.6"/>
</svg>`

// SVG 母版入库 (scripts/app-icon.svg), 经 qlmanage 渲染为 1024 PNG
const svgPath = new URL('./app-icon.svg', import.meta.url).pathname
writeFileSync(svgPath, svg)
execFileSync('qlmanage', ['-t', '-s', '1024', '-o', new URL('.', import.meta.url).pathname, svgPath], { stdio: 'pipe' })
rmSync(new URL('./app-icon.png', import.meta.url).pathname, { force: true })
execFileSync('mv', [
  new URL('./app-icon.svg.png', import.meta.url).pathname,
  new URL('./app-icon.png', import.meta.url).pathname,
])
console.log('scripts/app-icon.svg + scripts/app-icon.png written (祈愿之星)')
