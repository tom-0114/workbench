<script setup lang="ts">
import { computed, ref } from "vue";
import FullCalendar from "@fullcalendar/vue3";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import zhCn from "@fullcalendar/core/locales/zh-cn";
import type {
  CalendarOptions,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import { useTaskStore } from "@/stores/tasks";
import type { Occurrence } from "@/lib/types";
import { fmtDate } from "@/lib/date";
import { getDayMark } from "@/lib/cn-holidays";
import QuickAddPopover from "./QuickAddPopover.vue";

const emit = defineEmits<{ (e: "open-task", occ: Occurrence): void }>();
const store = useTaskStore();

// 保持引用稳定，避免 options 重算时触发日历整体重建
const PLUGINS = [dayGridPlugin, interactionPlugin];

const quickAdd = ref<{ date: string; x: number; y: number } | null>(null);
const range = ref<{ start: string; end: string } | null>(null);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function occToEvent(o: Occurrence): EventInput {
  return {
    id: `${o.task.id}:${o.date}`,
    title: o.task.title,
    start: o.date,
    allDay: true,
    editable: !o.isVirtual,
    classNames: [
      "wb-event",
      `wb-p${o.task.priority}`,
      o.completed ? "wb-done" : "wb-todo",
    ],
    extendedProps: { occ: o },
  };
}

const events = computed<EventInput[]>(() => {
  if (!range.value || !store.ready) return [];
  return store.occurrencesInRange(range.value.start, range.value.end).map(occToEvent);
});

function onDatesSet(arg: DatesSetArg) {
  const end = new Date(arg.end);
  end.setDate(end.getDate() - 1); // FullCalendar 的 end 是开区间
  range.value = { start: fmtDate(arg.start), end: fmtDate(end) };
}

function onDateClick(arg: DateClickArg) {
  quickAdd.value = { date: arg.dateStr, x: arg.jsEvent.clientX, y: arg.jsEvent.clientY };
}

async function onEventClick(arg: EventClickArg) {
  const occ = arg.event.extendedProps.occ as Occurrence;
  const target = arg.jsEvent.target as HTMLElement;
  if (target.closest("[data-done-btn]")) {
    await store.toggleOccurrence(occ);
  } else {
    emit("open-task", occ);
  }
}

async function onEventDrop(arg: EventDropArg) {
  const occ = arg.event.extendedProps.occ as Occurrence;
  if (occ.isVirtual || !arg.event.start) {
    arg.revert();
    return;
  }
  await store.moveTask(occ.task.id, fmtDate(arg.event.start));
}

async function onQuickCreate(title: string) {
  if (quickAdd.value) await store.addTask({ title, dueDate: quickAdd.value.date });
}

const options = computed<CalendarOptions>(() => ({
  plugins: PLUGINS,
  initialView: "dayGridMonth",
  locale: zhCn,
  firstDay: 1,
  height: "100%",
  headerToolbar: { left: "title", center: "", right: "prev today next" },
  fixedWeekCount: false,
  dayMaxEvents: true,
  dayHeaderFormat: { weekday: "short" },
  // 日期数字 + 节假日角标（如 国庆·休 / 班）
  dayCellContent: (arg) => {
    const num = arg.dayNumberText.replace("日", "");
    const mark = getDayMark(fmtDate(arg.date));
    const badge = mark
      ? `<span class="wb-day-badge">${mark.type === "holiday" ? `${mark.name}·休` : "班"}</span>`
      : "";
    return { html: `<span class="wb-daynum">${num}</span>${badge}` };
  },
  // 节假日(休)/调休上班(班)/周末 背景区分
  dayCellClassNames: (arg) => {
    const mark = getDayMark(fmtDate(arg.date));
    if (mark) return [mark.type === "holiday" ? "wb-holiday" : "wb-workday"];
    const dow = arg.date.getDay();
    return dow === 0 || dow === 6 ? ["wb-weekend"] : [];
  },
  editable: true,
  droppable: true,
  // 收集箱条目拖入某天 → 设为该天任务
  drop: (info) => {
    const id = Number(info.draggedEl.getAttribute("data-task-id"));
    if (id) store.moveTask(id, info.dateStr);
  },
  events: events.value,
  datesSet: onDatesSet,
  dateClick: onDateClick,
  eventClick: onEventClick,
  eventDrop: onEventDrop,
  eventContent: (arg) => {
    const o = arg.event.extendedProps.occ as Occurrence;
    const rep = o.isVirtual ? `<span class="wb-rep">↻</span>` : "";
    return {
      html:
        `<span class="wb-dot" data-done-btn title="点击切换完成"></span>` +
        `<span class="wb-title">${escapeHtml(o.task.title)}</span>${rep}`,
    };
  },
}));
</script>

<template>
  <div class="wb-calendar h-full">
    <!-- key 绑定日期：跨零点时重建日历，让“今天”的蓝圈移动到新的一天 -->
    <FullCalendar :key="store.currentDate" :options="options" />
    <QuickAddPopover
      v-if="quickAdd"
      :date="quickAdd.date"
      :x="quickAdd.x"
      :y="quickAdd.y"
      @create="onQuickCreate"
      @close="quickAdd = null"
    />
  </div>
</template>
