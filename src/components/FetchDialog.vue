<script setup lang="ts">
import { computed } from 'vue'
import { poolLabel } from '@/domain/pools'
import { SYNC_ALL_POOL_CODES } from '@/domain/syncAll'
import { describeFetchError, useAppStore } from '@/stores/app'

/**
 * 一键获取/粘贴/文件导入三入口共用的进行中弹窗(spec 02 §6 进度回调 + §7 错误文案):
 * 目录选择(多目录时)→ 探测段文案 → 分池进度(+限速说明)→ 错误(按类型映射,可重试)
 * → 完成报告。多 UID 选择/切换确认/哨兵并入是叠在其上的独立弹窗,挂起时本弹窗让位。
 */
const store = useAppStore()

const visible = computed(
  () =>
    store.fetchOpen &&
    store.pendingCandidates === null &&
    store.pendingMismatch === null &&
    store.pendingSentinelMerge === null,
)

const errorView = computed(() =>
  store.fetchError === null ? null : describeFetchError(store.fetchError),
)

/** 分池进度行(spec 02 §6 SyncAllProgress;五池固定顺序) */
const progress = computed(() => {
  const p = store.syncProgress
  if (p === null) return null
  return {
    poolNo: p.poolIndex + 1,
    poolTotal: SYNC_ALL_POOL_CODES.length,
    poolName: poolLabel(p.poolCode),
    page: p.page,
    fetched: p.fetchedThisPool,
    added: p.addedThisPool,
  }
})

function regionLabel(region: 'cn' | 'global'): string {
  return region === 'cn' ? '国服' : '国际服'
}
</script>

<template>
  <div
    v-if="visible"
    class="dialog-backdrop"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="获取祈愿记录"
    >
      <h3 class="dialog-title">获取祈愿记录</h3>

      <!-- 多游戏目录选择(单目录直取,不进此视图) -->
      <template v-if="store.pendingDirs !== null">
        <p class="dialog-hint">检测到多个游戏目录,请选择要读取的客户端:</p>
        <ul class="pick-list">
          <li
            v-for="dir in store.pendingDirs"
            :key="dir.gameDir"
          >
            <button
              type="button"
              class="pick-row"
              @click="store.chooseGameDir(dir.gameDir)"
            >
              <span class="row-name">{{ regionLabel(dir.region) }}</span>
              <span class="row-meta">{{ dir.gameDir }}</span>
            </button>
          </li>
        </ul>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn"
            @click="store.cancelDirSelection()"
          >
            取消
          </button>
        </div>
      </template>

      <!-- 错误(spec 02 §7 按类型映射;S7 过期文案不展示错误码) -->
      <template v-else-if="errorView !== null">
        <p
          class="error-text"
          role="alert"
        >
          {{ errorView.text }}
        </p>
        <p
          v-if="errorView.note !== undefined"
          class="retain-note"
        >
          {{ errorView.note }}
        </p>
        <p
          v-if="errorView.hint !== null"
          class="dialog-hint"
        >
          {{ errorView.hint }}
        </p>
        <div class="dialog-actions">
          <button
            v-if="errorView.retryable"
            type="button"
            class="btn accent"
            @click="store.retryFetch()"
          >
            重试
          </button>
          <button
            type="button"
            class="btn"
            @click="store.closeFetch()"
          >
            关闭
          </button>
        </div>
      </template>

      <!-- 完成报告(本次拉取/新增总数 + 分池明细) -->
      <template v-else-if="store.fetchResult !== null">
        <p class="done-line">
          同步完成:拉取 {{ store.fetchResult.fetched }} 条,新增
          {{ store.fetchResult.added }} 条,档案 UID {{ store.fetchResult.uid }}。
        </p>
        <ul class="pool-report">
          <li
            v-for="pool in store.fetchResult.pools"
            :key="pool.poolCode"
          >
            <span>{{ poolLabel(pool.poolCode) }}</span>
            <span class="pool-nums">拉取 {{ pool.fetched }} · 新增 {{ pool.added }}</span>
          </li>
        </ul>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn accent"
            @click="store.closeFetch()"
          >
            完成
          </button>
        </div>
      </template>

      <!-- 进行中:探测段文案 / 分池进度 + 限速说明(spec 02 D13/D14) -->
      <template v-else>
        <p
          v-if="store.fetchStage !== null"
          class="stage-line"
        >
          {{ store.fetchStage }}
        </p>
        <template v-if="store.syncing">
          <p
            v-if="progress !== null"
            class="progress-line"
          >
            正在获取 {{ progress.poolName }}(第 {{ progress.poolNo }} /
            {{ progress.poolTotal }} 池)· 第 {{ progress.page }} 页:已拉取
            {{ progress.fetched }} 条,新增 {{ progress.added }} 条
          </p>
          <p
            v-else
            class="stage-line"
          >
            正在连接官方祈愿接口…
          </p>
          <p class="rate-note">
            为不影响官方接口,每页间隔 0.5 秒、每 10 页额外休息 1 秒;网络波动会自动重试(最多
            3 次)。
          </p>
        </template>
        <div
          class="progress-track"
          aria-hidden="true"
        >
          <div class="progress-thumb" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pool-report {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--mut);
}

.pool-report li {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed var(--line-soft);
  padding-bottom: 6px;
}

.pool-nums {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.progress-line {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--fg);
}

.rate-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--dim);
}

/* 不定长进度走线(探测段与分页间隙) */
.progress-track {
  position: relative;
  height: 3px;
  border-radius: 2px;
  background: var(--line-soft);
  overflow: hidden;
}

.progress-thumb {
  position: absolute;
  width: 34%;
  height: 100%;
  border-radius: 2px;
  background: var(--accent-2);
  animation: sweep 1.4s ease-in-out infinite;
}

@keyframes sweep {
  0% {
    left: -34%;
  }

  100% {
    left: 100%;
  }
}
</style>
