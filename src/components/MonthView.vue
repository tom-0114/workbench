<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Plus } from "lucide-vue-next";
import FullCalendar from "@fullcalendar/vue3";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import { useMediaQuery } from "@vueuse/core";
import zhCn from "@fullcalendar/core/locales/zh-cn";
import type {
  CalendarOptions,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import { useTaskStore } from "@/stores/tasks";
import type { Occurrence, RepeatRule } from "@/lib/types";
import { fmtDate } from "@/lib/date";
import { getDayMark } from "@/lib/cn-holidays";
import {
  endTaskDrag,
  getDraggedTaskId,
  hasDraggedTask,
  TASK_DRAG_END_EVENT,
} from "@/lib/task-drag";
import QuickAddPopover from "./QuickAddPopover.vue";

const emit = defineEmits<{ (e: "open-task", occ: Occurrence): void }>();
const store = useTaskStore();

// 保持引用稳定，避免 options 重算时触发日历整体重建
const PLUGINS = [dayGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin];
const isMobile = useMediaQuery("(max-width: 767px)");

const quickAdd = ref<{ date: string; x: number; y: number } | null>(null);
const quickAdding = ref(false);
const range = ref<{ start: string; end: string } | null>(null);
const calRef = ref<InstanceType<typeof FullCalendar>>();

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

/** FullCalendar 的 list formatter 拿到的是 ExpandedZonedMarker，真正的 Date 在 .marker 上 */
function toRuntimeDate(marker: unknown): Date {
  if (marker instanceof Date) return marker;
  const m = marker as { marker?: unknown; year: number; month: number; day: number };
  if (m.marker instanceof Date) return m.marker;
  return new Date(m.year, m.month, m.day);
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
    try {
      await store.toggleOccurrence(occ);
    } catch {
      // Store 会显示全局错误提示；事项保持原状态。
    }
  } else {
    emit("open-task", occ);
  }
}

async function onEventDrop(arg: EventDropArg) {
  const occurrence = arg.event.extendedProps.occ as Occurrence;
  if (occurrence.isVirtual || !arg.event.start) {
    arg.revert();
    return;
  }

  try {
    await store.moveTask(occurrence.task.id, fmtDate(arg.event.start));
  } catch {
    // 保存失败时恢复日历中的临时位置，避免界面与数据不一致。
    arg.revert();
  }
}

let highlightedDropElement: HTMLElement | null = null;

function clearCalendarDropTarget() {
  highlightedDropElement?.classList.remove("wb-native-drop-active");
  highlightedDropElement = null;
}

function findCalendarDropTarget(target: EventTarget | null): { element: HTMLElement; date: string } | null {
  const element = target instanceof Element
    ? target.closest<HTMLElement>(".fc-daygrid-day[data-date]") ??
      target.closest<HTMLElement>("[data-wb-drop-date]")
    : null;
  const date = element?.dataset.wbDropDate || element?.dataset.date;
  return element && date ? { element, date: date.slice(0, 10) } : null;
}

function highlightCalendarDropTarget(element: HTMLElement) {
  if (highlightedDropElement === element) return;
  clearCalendarDropTarget();
  highlightedDropElement = element;
  element.classList.add("wb-native-drop-active");
}

function onCalendarDragOver(event: DragEvent) {
  if (!hasDraggedTask(event.dataTransfer)) return;
  const target = findCalendarDropTarget(event.target);
  if (!target) {
    clearCalendarDropTarget();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  highlightCalendarDropTarget(target.element);
}

function onCalendarDragLeave(event: DragEvent) {
  const calendar = event.currentTarget as HTMLElement;
  const next = event.relatedTarget as Node | null;
  if (next && calendar.contains(next)) return;
  clearCalendarDropTarget();
}

async function onCalendarDrop(event: DragEvent) {
  if (!hasDraggedTask(event.dataTransfer)) return;
  const target = findCalendarDropTarget(event.target);
  if (!target) return;
  event.preventDefault();
  const taskId = getDraggedTaskId(event.dataTransfer);
  clearCalendarDropTarget();
  endTaskDrag();
  if (!taskId) return;
  try {
    await store.moveTask(taskId, target.date);
  } catch {
    // Store 负责错误提示。
  }
}

async function onQuickCreate(
  title: string,
  applied?: { dueDate?: string; repeatRule?: RepeatRule },
) {
  if (!quickAdd.value || quickAdding.value) return;
  quickAdding.value = true;
  try {
    await store.addTask({
      title,
      dueDate: applied?.dueDate ?? quickAdd.value.date,
      repeatRule: applied?.repeatRule ?? "none",
    });
    quickAdd.value = null;
  } catch {
    // 全局错误提示由 store 负责；保留输入方便重试。
  } finally {
    quickAdding.value = false;
  }
}

/** 全局快捷键（T / ← / → / N）通过窗口事件驱动日历导航 */
function onCalendarNav(event: Event) {
  const detail = (event as CustomEvent<string>).detail;
  const api = calRef.value?.getApi();
  if (detail === "quickadd") {
    openMobileQuickAdd();
    return;
  }
  if (!api) return;
  if (detail === "prev") api.prev();
  else if (detail === "next") api.next();
  else if (detail === "today") api.today();
}

onMounted(() => {
  window.addEventListener(TASK_DRAG_END_EVENT, clearCalendarDropTarget);
  window.addEventListener("wb:calendar-nav", onCalendarNav);
});
onBeforeUnmount(() => {
  window.removeEventListener(TASK_DRAG_END_EVENT, clearCalendarDropTarget);
  window.removeEventListener("wb:calendar-nav", onCalendarNav);
});

function openMobileQuickAdd() {
  quickAdd.value = {
    date: store.currentDate,
    x: Math.max(16, window.innerWidth - 300),
    y: Math.min(window.innerHeight * 0.32, 240),
  };
}

const options = computed<CalendarOptions>(() => ({
  plugins: PLUGINS,
  initialView: isMobile.value ? "listWeek" : "dayGridMonth",
  locale: zhCn,
  firstDay: 1,
  height: "100%",
  headerToolbar: isMobile.value
    ? {
        left: "title",
        center: "prev,today,next",
        right: "listWeek,dayGridMonth",
      }
    : {
        left: "title",
        center: "",
        right: "listWeek,dayGridMonth,multiMonthYear prev,today,next",
      },
  buttonText: { listWeek: "周", dayGridMonth: "月", multiMonthYear: "年" },
  multiMonthMaxColumns: 3,
  fixedWeekCount: false,
  dayMaxEvents: isMobile.value ? 2 : true,
  dayHeaderFormat: { weekday: "short" },
  // 周列表：短区间标题（窄屏放得下），今天分组用「今天」强调，日期省略年份
  views: {
    listWeek: { titleFormat: { month: "long", day: "numeric" } },
  },
  listDayFormat: (arg) => {
    const d = toRuntimeDate(arg.date);
    return fmtDate(d) === store.currentDate
      ? "今天"
      : ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
  },
  listDaySideFormat: (arg) => {
    const d = toRuntimeDate(arg.date);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },
  dayHeaderDidMount: (arg) => {
    if (!arg.view.type.startsWith("list")) return;
    arg.el.dataset.wbDropDate = fmtDate(arg.date);
    if (fmtDate(arg.date) === store.currentDate) arg.el.classList.add("wb-list-today");
  },
  noEventsContent: "本周没有待办",
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
  // 同一天内：未完成在前，已完成沉底；其次按优先级降序
  eventOrder: (a: any, b: any) => {
    const oa = (a.extendedProps ?? a).occ as Occurrence | undefined;
    const ob = (b.extendedProps ?? b).occ as Occurrence | undefined;
    const ca = oa?.completed ? 1 : 0;
    const cb = ob?.completed ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const pa = oa?.task.priority ?? 0;
    const pb = ob?.task.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return (oa?.task.id ?? 0) - (ob?.task.id ?? 0);
  },
  eventOrderStrict: true,
  // 日历事项使用 FullCalendar 自带的拖拽；收集箱事项仍由外层原生 drop 处理。
  editable: true,
  droppable: false,
  events: events.value,
  datesSet: onDatesSet,
  dateClick: onDateClick,
  eventClick: onEventClick,
  eventDrop: onEventDrop,
  eventContent: (arg) => {
    const o = arg.event.extendedProps.occ as Occurrence;
    const content = document.createElement("span");
    content.className = "wb-event-content";

    const doneButton = document.createElement("button");
    doneButton.type = "button";
    doneButton.className = "wb-event-check";
    doneButton.dataset.doneBtn = "";
    doneButton.title = o.completed ? "取消完成" : "标记完成";
    doneButton.setAttribute("aria-label", `${o.completed ? "取消完成" : "完成"}：${o.task.title}`);
    doneButton.setAttribute("aria-pressed", String(o.completed));
    doneButton.textContent = "✓";
    // 勾选时轻量 pop 一下（120-220ms 量级，符合全局动效规范）
    doneButton.addEventListener("click", () => {
      doneButton.classList.add("wb-pop");
      setTimeout(() => doneButton.classList.remove("wb-pop"), 300);
    });

    const title = document.createElement("span");
    title.className = "wb-title";
    title.title = o.task.title;
    title.textContent = o.task.title;

    content.append(doneButton, title);
    if (o.isVirtual) {
      const repeat = document.createElement("span");
      repeat.className = "wb-rep";
      repeat.textContent = "↻";
      repeat.setAttribute("aria-label", "重复事项");
      content.append(repeat);
    }
    return { domNodes: [content] };
  },
}));
</script>

<template>
  <div
    class="wb-calendar h-full"
    @dragover="onCalendarDragOver"
    @dragleave="onCalendarDragLeave"
    @drop="onCalendarDrop"
  >
    <!-- key 绑定日期：跨零点时重建日历，让“今天”的蓝圈移动到新的一天 -->
    <FullCalendar ref="calRef" :key="`${store.currentDate}:${isMobile ? 'mobile' : 'desktop'}`" :options="options" />
    <QuickAddPopover
      v-if="quickAdd"
      :date="quickAdd.date"
      :x="quickAdd.x"
      :y="quickAdd.y"
      :busy="quickAdding"
      @create="onQuickCreate"
      @close="quickAdd = null"
    />
    <button
      v-if="isMobile"
      type="button"
      class="wb-calendar-add"
      aria-label="新建今天的待办"
      @click="openMobileQuickAdd"
    >
      <Plus aria-hidden="true" />
      <span>新建</span>
    </button>
  </div>
</template>
