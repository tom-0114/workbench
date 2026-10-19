<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Draggable } from "@fullcalendar/interaction";
import { GripVertical, Inbox, Plus, X } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import { parseDate } from "@/lib/date";
import { parseQuickAdd } from "@/lib/nl-parse";
import type { Occurrence, Task } from "@/lib/types";

defineProps<{ dropActive: boolean }>();
const emit = defineEmits<{ (e: "open-task", occ: Occurrence): void; (e: "close"): void }>();
const store = useTaskStore();

const listEl = ref<HTMLElement>();
const input = ref("");
const inputEl = ref<HTMLInputElement>();
const busy = ref(false);
const toOcc = (task: Task): Occurrence => ({ task, date: "", completed: task.completed, isVirtual: false });

// FullCalendar 的外部拖拽：落到日历上由 MonthView 的 drop 回调处理，这里只声明可拖的元素
let draggable: Draggable | null = null;
onMounted(() => {
  if (!listEl.value) return;
  draggable = new Draggable(listEl.value, {
    itemSelector: ".wb-inbox-item",
    eventData: (el) => ({ title: el.dataset.title, create: false }),
  });
});
onBeforeUnmount(() => draggable?.destroy());

async function add() {
  const raw = input.value.trim();
  if (!raw || busy.value) return;
  const p = parseQuickAdd(raw, parseDate(store.currentDate));
  busy.value = true;
  try {
    // 只写时间没写日期按今天；什么都没写就留在收集箱
    await store.addTask({
      title: p.title,
      dueDate: p.dueDate ?? (p.dueTime ? store.currentDate : ""),
      dueTime: p.dueTime ?? "",
      repeatRule: p.repeatRule ?? "none",
    });
    input.value = "";
  } catch {
    // Store 负责错误提示，保留输入方便重试。
  } finally {
    busy.value = false;
    await nextTick();
    inputEl.value?.focus();
  }
}

async function complete(task: Task) {
  try {
    await store.toggleOccurrence(toOcc(task));
  } catch {
    // Store 负责错误提示。
  }
}
</script>

<template>
  <aside class="wb-cal-inbox" :class="{ 'is-drop-target': dropActive }" aria-label="收集箱">
    <header class="wb-cal-inbox-head">
      <Inbox aria-hidden="true" />
      <h2>收集箱</h2>
      <span class="wb-cal-inbox-count">{{ store.inboxTasks.length }}</span>
      <button type="button" class="wb-control" aria-label="收起收集箱" title="收起" @click="emit('close')"><X /></button>
    </header>
    <form class="wb-cal-inbox-add" @submit.prevent="add">
      <Plus aria-hidden="true" />
      <input
        ref="inputEl"
        v-model="input"
        aria-label="记到收集箱"
        placeholder="记一件事，稍后安排"
        :disabled="busy"
        @keydown.enter="($event as KeyboardEvent).isComposing && $event.preventDefault()"
      />
    </form>
    <ul ref="listEl" class="wb-cal-inbox-list">
      <li
        v-for="task in store.inboxTasks"
        :key="task.id"
        class="wb-inbox-item"
        :class="`wb-p${task.priority}`"
        :data-task-id="task.id"
        :data-title="task.title"
        :title="`${task.title}（拖到日历上安排日期）`"
      >
        <button
          type="button"
          class="wb-event-check"
          :aria-label="`完成：${task.title}`"
          @click.stop="complete(task)"
          @mousedown.stop
          @touchstart.stop
        >✓</button>
        <button type="button" class="wb-inbox-title" @click="emit('open-task', toOcc(task))">{{ task.title }}</button>
        <GripVertical class="wb-inbox-grip" aria-hidden="true" />
      </li>
    </ul>
    <p v-if="!store.inboxTasks.length" class="wb-cal-inbox-empty">收集箱是空的</p>
    <p class="wb-cal-inbox-hint">
      {{ dropActive ? "松开即取消日期，放回收集箱" : "拖到日历上安排日期；把日历上的事项拖回这里可取消日期" }}
    </p>
  </aside>
</template>
