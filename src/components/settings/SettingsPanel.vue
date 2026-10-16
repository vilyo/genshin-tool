<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { loadAutoSync, saveAutoSync } from '@/stores/settings'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import AboutSection from './AboutSection.vue'
import ArchiveManager from './ArchiveManager.vue'
import BackupImportConfirm from './BackupImportConfirm.vue'
import ClearDataConfirm from './ClearDataConfirm.vue'

/**
 * 设置面板(T18,PRD F5):右侧滑出抽屉,V5 视觉。
 * 条目:主题明暗 / 启动自动同步 / 游戏客户端目录 / 档案管理 / 备份导出导入 /
 * 清空数据(二次确认)/ 关于。偏好项即时生效并持久化(localStorage 简化)。
 * 面板整体由 app store 的 settingsOpen 驱动,嵌套确认层为同一 store 的待决状态。
 */
const store = useAppStore()
const theme = useThemeStore()

/** 面板每次打开重建(外层 v-if),从 localStorage 恢复启动同步偏好 */
const autoSync = ref(loadAutoSync())

function toggleAutoSync(): void {
  autoSync.value = !autoSync.value
  saveAutoSync(autoSync.value)
}

function setTheme(next: ThemeName): void {
  theme.set(next)
}

const themeOptions: { value: ThemeName; label: string }[] = [
  { value: 'dark', label: '夜仪' },
  { value: 'light', label: '昼版' },
]

function onKeydown(event: KeyboardEvent): void {
  // 仅面板打开时接管 ESC(与主画面的流水抽屉 ESC 互不干扰)
  if (event.key !== 'Escape' || !store.settingsOpen) return
  store.closeSettings()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

const REGION_LABEL: Record<'cn' | 'global', string> = { cn: '国服', global: '国际服' }
</script>

<template>
  <template v-if="store.settingsOpen">
    <div
      class="settings-backdrop"
      @click="store.closeSettings()"
    />
    <aside
      class="settings-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <header class="settings-head">
        <span class="settings-mark" />设置
        <button
          type="button"
          class="settings-close"
          aria-label="关闭设置"
          @click="store.closeSettings()"
        >
          ✕
        </button>
      </header>

      <div class="settings-body">
        <h3 class="group-title">偏好</h3>
        <div class="set-row">
          <div class="info">
            <div class="t">主题</div>
            <div class="d">夜仪为默认;偏好即时生效并记住</div>
          </div>
          <div
            class="seg"
            role="group"
            aria-label="主题"
          >
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              :class="{ 'is-active': theme.theme === option.value }"
              @click="setTheme(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="set-row">
          <div class="info">
            <div class="t">启动时自动同步</div>
            <div class="d">仅缓存链接有效时静默增量;失效则静默跳过</div>
          </div>
          <button
            type="button"
            class="toggle"
            :aria-pressed="autoSync"
            aria-label="启动时自动同步"
            @click="toggleAutoSync"
          >
            <i />
          </button>
        </div>
        <div class="set-row col">
          <div class="info">
            <div class="t">游戏客户端目录</div>
            <div class="d">自动探测优先,手动指定暂不参与获取(供后续版本使用)</div>
          </div>
          <ul
            v-if="store.dirProbe.state === 'found'"
            class="dir-list"
          >
            <li
              v-for="dir in store.dirProbe.dirs"
              :key="dir.gameDir"
              class="dir-row"
            >
              <span class="dir-region">{{ REGION_LABEL[dir.region] }}</span>
              <span
                class="dir-path"
                :title="dir.gameDir"
              >{{ dir.gameDir }}</span>
            </li>
          </ul>
          <p
            v-else-if="store.dirProbe.state === 'unsupported'"
            class="dir-note"
          >
            自动获取仅支持 Windows;macOS 可用「手动导入 → 粘贴链接」。
          </p>
          <p
            v-else-if="store.dirProbe.state === 'empty'"
            class="dir-note"
          >
            未找到游戏目录。
          </p>
          <p
            v-else-if="store.dirProbe.state === 'error'"
            class="dir-note error"
          >
            {{ store.dirProbe.text }}
          </p>
          <p
            v-else
            class="dir-note"
          >
            正在探测…
          </p>
          <div class="dir-manual">
            <span
              class="dir-path"
              :title="store.manualGameDir ?? undefined"
            >手动指定:{{ store.manualGameDir ?? '未指定' }}</span>
            <button
              type="button"
              class="set-btn"
              @click="store.chooseGameDirManually()"
            >
              指定目录
            </button>
          </div>
        </div>

        <h3 class="group-title">档案与数据</h3>
        <ArchiveManager />
        <div class="set-row">
          <div class="info">
            <div class="t">备份与恢复</div>
            <div class="d">导出当前档案为 JSON 文件;导入按去重键合并入备份所属档案</div>
          </div>
          <button
            type="button"
            class="set-btn"
            :disabled="store.busy || store.currentUid === null"
            @click="store.exportBackupFile()"
          >
            导出备份
          </button>
          <button
            type="button"
            class="set-btn"
            :disabled="store.busy"
            @click="store.importBackupFile()"
          >
            导入备份
          </button>
        </div>
        <div class="set-row">
          <div class="info">
            <div class="t">清空数据</div>
            <div class="d">清空当前档案的全部祈愿记录与同步水位,不可恢复</div>
          </div>
          <button
            type="button"
            class="set-btn danger"
            :disabled="store.busy || store.currentUid === null"
            @click="store.askClearArchive()"
          >
            清空数据
          </button>
        </div>

        <AboutSection />
      </div>
    </aside>
    <!-- 嵌套确认层(置于抽屉之上):清空二次确认 / 备份导入预览确认 -->
    <ClearDataConfirm />
    <BackupImportConfirm />
  </template>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--backdrop);
}

.settings-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 110;
  width: min(440px, 94vw);
  display: flex;
  flex-direction: column;
  background: var(--raise);
  border-left: 1px solid var(--raise-border);
  box-shadow: -40px 0 90px -50px rgba(0, 0, 0, 0.75);
}

.settings-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--fg);
}

.settings-mark {
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--accent);
  transform: rotate(45deg);
}

.settings-close {
  margin-left: auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--dim);
  font-size: 12px;
  cursor: pointer;
}

.settings-close:hover {
  color: var(--fg);
  background: var(--accent-wash);
}

.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 20px 22px;
}

.group-title {
  margin: 16px 0 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--dim);
}

.set-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line-soft);
  flex-wrap: wrap;
}

.set-row.col {
  flex-direction: column;
  align-items: stretch;
}

.set-row:last-of-type {
  border-bottom: none;
}

.set-row .info {
  flex: 1;
  min-width: 180px;
}

.set-row .info .t {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--fg);
}

.set-row .info .d {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--mut);
}

.set-btn {
  flex: none;
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: none;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--mut);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.set-btn:hover:not(:disabled) {
  color: var(--fg);
  border-color: var(--accent-2);
}

.set-btn.danger {
  color: var(--cinnabar);
  border-color: var(--cinnabar);
}

.set-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 主题分段选择 */
.seg {
  flex: none;
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.seg button {
  border: none;
  background: none;
  padding: 5px 14px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--mut);
  cursor: pointer;
}

.seg button + button {
  border-left: 1px solid var(--line);
}

.seg button.is-active {
  color: var(--accent);
  background: var(--accent-wash);
  font-weight: 700;
}

/* 开关(aria-pressed 驱动滑块与描边) */
.toggle {
  flex: none;
  position: relative;
  width: 42px;
  height: 22px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--seal-bg);
  cursor: pointer;
  transition: border-color 0.15s;
}

.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dim);
  transition:
    left 0.15s,
    background 0.15s;
}

.toggle[aria-pressed='true'] {
  border-color: var(--accent);
}

.toggle[aria-pressed='true'] i {
  left: 22px;
  background: var(--accent);
}

/* 游戏目录展示 */
.dir-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dir-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--seal-bg);
}

.dir-region {
  flex: none;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.dir-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--mut);
}

.dir-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--mut);
}

.dir-note.error {
  color: var(--cinnabar);
}

.dir-manual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.dir-manual .dir-path {
  flex: 1;
}
</style>
