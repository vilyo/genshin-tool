<script setup lang="ts">
// 占位根组件:项目初始化阶段的可编译骨架,正式界面待设计定稿后实现
const __version = __APP_VERSION__
</script>

<template>
  <div class="app-shell">
    <h1>原神工具箱</h1>
    <p>祈愿记录本地统计助手 · 项目初始化 v{{ __version }}</p>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--t-fg);
}
</style>
