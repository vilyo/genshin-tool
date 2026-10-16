<script setup lang="ts">
import { computed } from 'vue'
import type { ExcelSheetPreview } from '@/domain/excelImport'
import { useAppStore } from '@/stores/app'

/**
 * Excel 历史迁入预览页(spec 03 §5 交互契约,S3 场景):
 * 每表一块(池名/gacha_type 重建/条数/时间范围/五星数)→ 校验报告(ERROR 逐条可展开、
 * WARNING 分类计数可展开)→ 与当前档案的重叠预览 → 确认按钮携带总量;取消零写入。
 * 完成报告与预览数字同源(applyExcelImport 重跑同一确定性解析,G8)。
 */
const store = useAppStore()

const preview = computed(() => store.excelPreview)
/** 确认按钮总量:导入行数(不含 ERROR 行)与新增数 */
const totalCount = computed(() =>
  preview.value === null ? 0 : preview.value.records.length,
)
const addedCount = computed(() => preview.value?.overlap?.added ?? 0)

function timeRange(sheet: ExcelSheetPreview): string {
  if (sheet.timeRange.start === null || sheet.timeRange.end === null) return '无数据行'
  return `${sheet.timeRange.start} ~ ${sheet.timeRange.end}`
}

function gachaTypeSummary(sheet: ExcelSheetPreview): string {
  if (sheet.gachaTypeCounts.length === 0) return '—'
  return sheet.gachaTypeCounts
    .map((item) => `${item.gachaType}×${item.count}`)
    .join(' / ')
}
</script>

<template>
  <div
    v-if="store.excelOpen"
    class="dialog-backdrop"
  >
    <div
      class="dialog excel-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Excel 历史迁入"
    >
      <h3 class="dialog-title">Excel 历史迁入</h3>

      <template v-if="store.excelLoading">
        <p class="stage-line">正在解析工作簿…</p>
      </template>

      <template v-else-if="store.excelError !== null">
        <p
          class="error-text"
          role="alert"
        >
          {{ store.excelError }}
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn"
            @click="store.closeExcel()"
          >
            关闭
          </button>
        </div>
      </template>

      <!-- 导入完成报告(数字与预览一致,spec 03 §5 钉住) -->
      <template v-else-if="store.excelResult !== null">
        <p class="done-line">
          导入完成:新增 {{ store.excelResult.summary.added }} 条,重叠跳过
          {{ store.excelResult.summary.skipped }} 条,身份回填
          {{ store.excelResult.summary.upgraded }} 条(档案 UID
          {{ store.excelResult.archiveUid }})。
        </p>
        <p class="dialog-hint">
          共迁入 {{ store.excelResult.parse.records.length }} 条,校验 ERROR
          {{ store.excelResult.parse.issues.errors.length }} 行未导入;原文件只读未修改。
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn accent"
            @click="store.closeExcel()"
          >
            完成
          </button>
        </div>
      </template>

      <!-- 预览页 -->
      <template v-else-if="preview !== null">
        <div class="excel-body">
          <section
            v-for="sheet in preview.sheets"
            :key="sheet.sheetName"
            class="sheet-block"
          >
            <header class="sheet-head">
              <span class="sheet-name">{{ sheet.sheetName }}</span>
              <span
                v-if="sheet.poolLabel !== null"
                class="sheet-pool"
              >{{ sheet.poolLabel }}</span>
              <span
                v-else
                class="sheet-pool unknown"
              >未识别工作表(不导入)</span>
            </header>
            <p class="sheet-meta">
              gacha_type {{ gachaTypeSummary(sheet) }} · {{ sheet.rowCount }} 条 ·
              {{ timeRange(sheet) }} · 五星 {{ sheet.fiveStarCount }}
            </p>
          </section>

          <section
            v-if="preview.issues.errors.length > 0 || preview.issues.warnings.length > 0"
            class="issue-summary"
          >
            <details
              v-if="preview.issues.errors.length > 0"
              class="issue-group is-error"
            >
              <summary>ERROR {{ preview.issues.errors.length }} 行(不导入,点击展开)</summary>
              <ul>
                <li
                  v-for="(issue, index) in preview.issues.errors"
                  :key="index"
                >
                  {{ issue.sheetName }}<template v-if="issue.row !== null"> 第 {{ issue.row }} 行</template>:{{ issue.message }}
                </li>
              </ul>
            </details>
            <p
              v-else
              class="issue-ok"
            >
              校验无 ERROR
            </p>
            <details
              v-for="group in preview.issues.warnings"
              :key="group.kind"
              class="issue-group"
            >
              <summary>{{ group.label }} {{ group.count }} 条(点击展开)</summary>
              <ul>
                <li
                  v-for="(issue, index) in group.issues"
                  :key="index"
                >
                  {{ issue.sheetName }}<template v-if="issue.row !== null"> 第 {{ issue.row }} 行</template>:{{ issue.message }}
                </li>
              </ul>
            </details>
          </section>

          <p
            v-if="preview.overlap !== null"
            class="overlap-line"
          >
            将新增 {{ preview.overlap.added }} 条 · 与现有记录重叠
            {{ preview.overlap.skipped }} 条 · 身份回填 {{ preview.overlap.upgraded }} 条
          </p>
        </div>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn"
            @click="store.cancelExcelImport()"
          >
            取消
          </button>
          <button
            type="button"
            class="btn accent"
            :disabled="store.excelApplying"
            @click="store.confirmExcelImport()"
          >
            {{ store.excelApplying ? '导入中…' : `导入 ${totalCount} 条(新增 ${addedCount})` }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.excel-dialog {
  width: 620px;
}

.excel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sheet-block {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--seal-bg);
}

.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.sheet-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--fg);
}

.sheet-pool {
  font-size: 11.5px;
  letter-spacing: 0.08em;
  color: var(--accent);
  border: 1px solid var(--seal-inner);
  border-radius: 999px;
  padding: 2px 10px;
}

.sheet-pool.unknown {
  color: var(--cinnabar);
}

.sheet-meta {
  margin: 8px 0 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--mut);
}

.issue-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.issue-ok {
  margin: 0;
  font-size: 12.5px;
  color: var(--jade);
}

.overlap-line {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
</style>
