<script setup lang="ts">
import { ref } from "vue";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTaskStore } from "@/stores/tasks";
import { addDays } from "@/lib/date";

// 手机上拖拽不好用：点按钮或选日期直接安排
const open = defineModel<boolean>("open", { default: false });
const store = useTaskStore();
const busyId = ref<number | null>(null);

async function schedule(id: number, date: string) {
  if (!date || busyId.value) return;
  busyId.value = id;
  try {
    await store.moveTask(id, date);
  } catch {
    // Store 负责错误提示。
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent side="bottom" class="wb-inbox-sheet gap-0 p-0">
      <div class="mx-auto mt-2.5 h-1 w-9 flex-none rounded-full" style="background: var(--border-subtle)" aria-hidden="true" />
      <SheetHeader class="border-b px-5 pb-3 pt-2 text-left">
        <SheetTitle>收集箱 · {{ store.inboxTasks.length }}</SheetTitle>
        <SheetDescription>给事项选个日期，它就会出现在日历上</SheetDescription>
      </SheetHeader>
      <ul class="wb-inbox-sheet-list">
        <li v-for="task in store.inboxTasks" :key="task.id" :aria-busy="busyId === task.id">
          <span class="wb-inbox-sheet-title">{{ task.title }}</span>
          <div class="wb-inbox-sheet-actions">
            <button type="button" :disabled="busyId !== null" @click="schedule(task.id, store.currentDate)">今天</button>
            <button type="button" :disabled="busyId !== null" @click="schedule(task.id, addDays(store.currentDate, 1))">明天</button>
            <label>
              <span class="sr-only">为「{{ task.title }}」选择日期</span>
              <input type="date" :disabled="busyId !== null" @change="schedule(task.id, ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </li>
      </ul>
      <p v-if="!store.inboxTasks.length" class="wb-cal-inbox-empty">收集箱是空的</p>
    </SheetContent>
  </Sheet>
</template>
