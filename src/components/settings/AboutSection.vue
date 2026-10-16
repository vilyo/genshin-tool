<script setup lang="ts">
/** 构建期注入的版本号(vite define,与状态栏同源) */
const appVersion = __APP_VERSION__
</script>

<template>
  <div class="about">
    <p class="about-line">
      原神工具箱 · 版本 <span class="mono">{{ appVersion }}</span>
    </p>
    <p class="privacy">
      全本地统计 · 除官方祈愿接口外零出网 · 无遥测无账号。祈愿记录仅保存在这台电脑上。
    </p>
    <p class="credit">
      © miHoYo / HoYoverse. 本工具与米哈游无隶属关系。游戏内素材版权归米哈游所有(ADR-0005:构建期内置,运行时不取图)。
    </p>
  </div>
</template>

<style scoped>
.about {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about-line {
  margin: 0;
  font-size: 12.5px;
  letter-spacing: 0.04em;
  color: var(--mut);
}

.mono {
  font-family: var(--font-mono);
  color: var(--fg);
}

.privacy,
.credit {
  margin: 0;
  padding: 9px 12px;
  border-left: 3px solid var(--accent);
  background: var(--seal-bg);
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--mut);
}

.credit {
  border-left-color: var(--dim);
  color: var(--dim);
}
</style>
