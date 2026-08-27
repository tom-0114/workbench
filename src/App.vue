<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useTaskStore } from "@/stores/tasks";
import { checkUpdate, loadVersion } from "@/lib/updater";
import type { Occurrence } from "@/lib/types";
import MonthView from "@/components/MonthView.vue";
import TodayPanel from "@/components/TodayPanel.vue";
import TaskSheet from "@/components/TaskSheet.vue";

const store = useTaskStore();

const sheetOpen = ref(false);
const currentOcc = ref<Occurrence | null>(null);

function openTask(occ: Occurrence) {
  currentOcc.value = occ;
  sheetOpen.value = true;
}

/* 侧边栏宽度：可拖拽调节并记忆 */
const sidebarWidth = ref(
  Math.min(420, Math.max(220, Number(localStorage.getItem("wb.sidebarWidth")) || 288)),
);
const resizing = ref(false);

function startResize(e: PointerEvent) {
  e.preventDefault();
  resizing.value = true;
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  const move = (ev: PointerEvent) => {
    sidebarWidth.value = Math.min(420, Math.max(220, startW + ev.clientX - startX));
  };
  const up = () => {
    resizing.value = false;
    localStorage.setItem("wb.sidebarWidth", String(sidebarWidth.value));
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

onMounted(() => {
  store.init();
  // 启动后静默检查更新（有新版会在设置齿轮上显示红点）
  loadVersion();
  checkUpdate(true);
});
</script>

<template>
  <div class="flex h-screen overflow-hidden" :class="resizing ? 'select-none' : ''">
    <TodayPanel
      class="shrink-0"
      :style="{ width: sidebarWidth + 'px', background: 'var(--bg-secondary)' }"
      @open-task="openTask"
    />
    <!-- 侧边栏宽度拖拽手柄 -->
    <div
      class="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize transition-colors"
      :style="{ background: resizing ? 'var(--accent-color)' : 'var(--border-subtle)' }"
      title="拖动调整侧栏宽度"
      @pointerdown="startResize"
    />
    <MonthView class="min-w-0 flex-1" @open-task="openTask" />
    <TaskSheet v-model:open="sheetOpen" :occurrence="currentOcc" />
  </div>
</template>
