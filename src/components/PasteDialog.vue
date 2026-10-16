<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useAppStore()

const text = ref('')
const busy = computed(() => store.busy)

/** 提交:先本地规范化(失败行内提示),有效链接进入共用探底→拉取管线后让位 FetchDialog */
async function submit(): Promise<void> {
  const raw = text.value
  if (raw.trim() === '' || busy.value) return
  const ok = await store.pasteImport(raw)
  if (ok) {
    text.value = ''
    emit('close')
  }
}

// —— 浮层无障碍:ESC 关闭 + 焦点往返,打开时聚焦输入框 ——
let lastFocused: HTMLElement | null = null
const input = ref<HTMLTextAreaElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      store.pasteError = null // 打开即清上次残留的行内错误(#7)
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      input.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      lastFocused?.focus()
      lastFocused = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <template v-if="open">
    <div
      class="dialog-backdrop"
      @click="emit('close')"
    />
    <div
      class="dialog paste-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="粘贴链接导入"
    >
      <h3 class="dialog-title">粘贴链接导入</h3>
      <p class="dialog-hint">
        在游戏内打开「祈愿-历史记录」页后,复制浏览器地址栏的完整链接粘贴到下面(可多行;macOS
        的唯一自动获取途径)。
      </p>
      <textarea
        ref="input"
        v-model="text"
        class="dialog-input"
        rows="4"
        placeholder="https://…?auth_appid=webview_gacha&authkey=…"
      />
      <p
        v-if="store.pasteError !== null"
        class="error-text"
        role="alert"
      >
        {{ store.pasteError }}
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="btn accent"
          :disabled="busy || text.trim() === ''"
          @click="submit"
        >
          导入
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.paste-dialog {
  width: 560px;
}
</style>
