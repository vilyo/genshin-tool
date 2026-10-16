<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useThemeStore } from '@/stores/theme'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

/** 粘贴/Excel 弹窗开关由 App 持有(空态也要能呼出);文件导入与一键获取在 store 内闭环 */
const emit = defineEmits<{ 'open-paste': []; 'open-excel': [] }>()

const store = useAppStore()
const theme = useThemeStore()

/** 探测/拉取/Excel 解析期间入口不可用,避免管线互相踩踏 */
const busy = computed(() => store.busy)

const menuOpen = ref(false)

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function openPaste(): void {
  closeMenu()
  emit('open-paste')
}

function openExcel(): void {
  closeMenu()
  emit('open-excel')
}

async function importFile(): Promise<void> {
  closeMenu()
  await store.fileImport()
}

async function quickFetch(): Promise<void> {
  await store.oneClickFetch()
}

// 点击菜单外任意处收起下拉
function onDocumentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  if (event.target.closest('.menu-wrap') === null) closeMenu()
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <header
    class="titlebar"
    data-tauri-drag-region
  >
    <div
      class="brand"
      data-tauri-drag-region
    >
      <span
        class="brand-mark"
        aria-hidden="true"
      />
      <span class="brand-name">原神工具箱</span>
      <span class="brand-tag">ARMILLARY</span>
    </div>
    <div
      class="spacer"
      data-tauri-drag-region
    />
    <!-- 当前档案 UID 芯片(T11 仅展示;档案列表/切换管理属 T18) -->
    <span
      v-if="store.currentUid !== null"
      class="uid-chip"
      :title="`当前档案 UID ${store.currentUid}`"
    >UID {{ store.currentUid }}</span>
    <button
      type="button"
      class="tbtn accent"
      :disabled="busy"
      @click="quickFetch"
    >
      {{ store.syncing ? '获取中…' : '一键获取' }}
    </button>
    <!-- 手动导入下拉:粘贴(全平台)/文件(兜底)/Excel 历史迁入(F1.5) -->
    <div class="menu-wrap">
      <button
        type="button"
        class="tbtn"
        :disabled="busy"
        @click="toggleMenu"
      >
        手动导入 <span
          class="caret"
          aria-hidden="true"
        >▾</span>
      </button>
      <div
        v-if="menuOpen"
        class="menu"
      >
        <button
          type="button"
          class="menu-item"
          @click="openPaste"
        >
          粘贴链接
        </button>
        <button
          type="button"
          class="menu-item"
          @click="importFile"
        >
          导入文件
        </button>
        <button
          type="button"
          class="menu-item"
          @click="openExcel"
        >
          Excel 历史迁入
        </button>
      </div>
    </div>
    <button
      type="button"
      class="tbtn"
      aria-label="切换主题"
      :title="theme.theme === 'dark' ? '切换到昼版' : '切换到夜仪'"
      @click="theme.toggle()"
    >
      {{ theme.theme === 'dark' ? '昼版' : '夜仪' }}
    </button>
    <!-- 设置(T18):档案/备份/启动同步/目录/清空/关于,面板为右侧抽屉 -->
    <button
      type="button"
      class="tbtn"
      @click="store.openSettings()"
    >
      设置
    </button>
  </header>
  <SettingsPanel />
</template>

<style scoped>
.titlebar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--raise);
  color: var(--fg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

/* 菱形徽记(board.html .logo 同款) */
.brand-mark {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--accent);
  transform: rotate(45deg);
}

.brand-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--dim);
  border: 1px solid var(--line);
  padding: 3px 6px;
}

.spacer {
  flex: 1;
}

.uid-chip {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--mut);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 5px 14px;
}

.tbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--mut);
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.tbtn:hover:not(:disabled) {
  color: var(--fg);
  background: var(--accent-wash);
}

.tbtn:disabled {
  opacity: 0.45;
  cursor: default;
}

.tbtn.accent {
  background: var(--btn);
  color: var(--btn-ink);
  font-weight: 700;
  padding: 0 16px;
}

.tbtn.accent:hover:not(:disabled) {
  color: var(--btn-ink);
  filter: brightness(1.07);
}

.caret {
  font-size: 9px;
  color: var(--dim);
}

.menu-wrap {
  position: relative;
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 168px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 10px;
  background: var(--raise);
  border: 1px solid var(--raise-border);
  box-shadow: 0 24px 60px -30px rgba(0, 0, 0, 0.7);
}

.menu-item {
  border: none;
  background: none;
  text-align: left;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: var(--mut);
  padding: 8px 12px;
  border-radius: 7px;
  cursor: pointer;
}

.menu-item:hover {
  color: var(--fg);
  background: var(--accent-wash);
}
</style>
