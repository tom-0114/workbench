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

onMounted(() => {
  store.init();
  // 启动后静默检查更新（有新版会在设置齿轮上显示红点）
  loadVersion();
  checkUpdate(true);
});
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <TodayPanel
      class="w-72 shrink-0 border-r"
      style="background: var(--bg-secondary); border-color: var(--border-subtle)"
      @open-task="openTask"
    />
    <MonthView class="min-w-0 flex-1" @open-task="openTask" />
    <TaskSheet v-model:open="sheetOpen" :occurrence="currentOcc" />
  </div>
</template>
