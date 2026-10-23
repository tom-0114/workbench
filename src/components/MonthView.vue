<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Inbox, Plus } from "lucide-vue-next";
import FullCalendar from "@fullcalendar/vue3";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import multiMonthPlugin from "@fullcalendar/multimonth";
import interactionPlugin, { type DateClickArg, type DropArg, type EventDragStopArg } from "@fullcalendar/interaction";
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
import { reminderLabel, reminderTime } from "@/lib/reminders";
import QuickAddPopover from "./QuickAddPopover.vue";
import CalendarInbox from "./CalendarInbox.vue";
import InboxSheet from "./InboxSheet.vue";

const props = defineProps<{ inboxOpen?: boolean }>();
const emit = defineEmits<{ (e: "open-task", occ: Occurrence): void; (e: "close-inbox"): void }>();
const store = useTaskStore();

// 保持引用稳定，避免 options 重算时触发日历整体重建
const BELL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';
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

/** 收集箱事项拖到日历某天：FullCalendar 外部拖拽（create: false，只回调不建事件） */
async function onExternalDrop(arg: DropArg) {
  const id = Number(arg.draggedEl.dataset.taskId);
  if (!id) return;
  try {
    await store.moveTask(id, arg.dateStr.slice(0, 10));
  } catch {
    // Store 负责错误提示。
  }
}

// 日历事项拖回收集箱：落点在日历之外，FullCalendar 会自动回弹，这里按松手位置判断
const inboxDropActive = ref(false);
function isOverInbox(x: number, y: number) {
  return !!document.elementFromPoint(x, y)?.closest(".wb-cal-inbox");
}
function trackInboxHover(event: PointerEvent) {
  inboxDropActive.value = isOverInbox(event.clientX, event.clientY);
}
function onEventDragStart() {
  if (props.inboxOpen) document.addEventListener("pointermove", trackInboxHover);
}
async function onEventDragStop(arg: EventDragStopArg) {
  document.removeEventListener("pointermove", trackInboxHover);
  const wasOver = inboxDropActive.value;
  inboxDropActive.value = false;
  const point = arg.jsEvent as MouseEvent;
  if (!props.inboxOpen || !(wasOver || isOverInbox(point.clientX, point.clientY))) return;
  const occ = arg.event.extendedProps.occ as Occurrence;
  try {
    await store.moveTask(occ.task.id, "");
  } catch {
    // Store 负责错误提示。
  }
}

const inboxSheetOpen = ref(false);

// 侧栏开合会改变日历宽度，FullCalendar 只监听窗口尺寸，需要手动通知
watch(
  () => props.inboxOpen,
  async () => {
    await nextTick();
    calRef.value?.getApi().updateSize();
  },
);

async function onQuickCreate(
  title: string,
  applied?: { dueDate?: string; repeatRule?: RepeatRule; repeatUntil?: string; dueTime?: string },
) {
  if (!quickAdd.value || quickAdding.value) return;
  quickAdding.value = true;
  try {
    await store.addTask({
      title,
      dueDate: applied?.dueDate ?? quickAdd.value.date,
      dueTime: applied?.dueTime ?? "",
      repeatRule: applied?.repeatRule ?? "none",
      repeatUntil: applied?.repeatUntil ?? "",
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

onMounted(() => window.addEventListener("wb:calendar-nav", onCalendarNav));
onBeforeUnmount(() => {
  window.removeEventListener("wb:calendar-nav", onCalendarNav);
  document.removeEventListener("pointermove", trackInboxHover);
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
    if (arg.view.type.startsWith("list") && fmtDate(arg.date) === store.currentDate) arg.el.classList.add("wb-list-today");
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
  // 同一天内：未完成在前，已完成沉底；设了提醒的按提醒时间排在前面，其次按优先级降序
  eventOrder: (a: any, b: any) => {
    const oa = (a.extendedProps ?? a).occ as Occurrence | undefined;
    const ob = (b.extendedProps ?? b).occ as Occurrence | undefined;
    const ca = oa?.completed ? 1 : 0;
    const cb = ob?.completed ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const ra = oa?.task.remindOffset != null ? reminderTime(oa.date, oa.task.dueTime, oa.task.remindOffset).getTime() : Infinity;
    const rb = ob?.task.remindOffset != null ? reminderTime(ob.date, ob.task.dueTime, ob.task.remindOffset).getTime() : Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    const pa = oa?.task.priority ?? 0;
    const pb = ob?.task.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return (oa?.task.id ?? 0) - (ob?.task.id ?? 0);
  },
  eventOrderStrict: true,
  // 日历事项与收集箱事项都走 FullCalendar 的拖拽（收集箱见 CalendarInbox 的 Draggable）
  editable: true,
  // 任务只有单个日期，禁止拉伸成跨天事件
  eventDurationEditable: false,
  // 拖拽镜像是 fixed 定位，挂在日历内时会被祖先的 transform（视图入场动画）带偏
  fixedMirrorParent: document.body,
  droppable: true,
  drop: onExternalDrop,
  eventDragStart: onEventDragStart,
  eventDragStop: onEventDragStop,
  events: events.value,
  datesSet: onDatesSet,
  dateClick: onDateClick,
  eventClick: onEventClick,
  eventDrop: onEventDrop,
  eventContent: (arg) => {
    const o = arg.event.extendedProps.occ as Occurrence;
    const content = document.createElement("span");
    content.className = "wb-event-content";

    // 手机月视图格子只有几十像素宽：不放打卡按钮和重复标记，标题独占宽度换行两行；
    // 完成与详情操作走默认的周列表或详情抽屉
    const compactMonthGrid = isMobile.value && arg.view.type === "dayGridMonth";

    if (!compactMonthGrid) {
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
      content.append(doneButton);
    }

    const title = document.createElement("span");
    title.className = "wb-title";
    title.title = o.task.title;
    title.textContent = o.task.title;
    content.append(title);

    const subs = store.subtasksByParent.get(o.task.id);
    if (subs?.length && !compactMonthGrid) {
      const done = subs.filter((sub) => store.isSubtaskDone(sub, o.task, o.date)).length;
      const chip = document.createElement("span");
      chip.className = "wb-event-subs";
      chip.textContent = `${done}/${subs.length}`;
      chip.setAttribute("aria-label", `子任务完成 ${done}/${subs.length}`);
      content.append(chip);
    }

    // 提醒时间放在标题后面，标题过长时被省略的是标题而不是提醒
    const remind = o.completed ? "" : reminderLabel(o.task, o.date, store.currentDate);
    if (remind) {
      const tag = document.createElement("span");
      tag.className = "wb-event-remind";
      tag.title = `提醒 ${remind}`;
      tag.setAttribute("aria-label", `提醒 ${remind}`);
      tag.innerHTML = BELL_SVG;
      // 手机月视图格子太窄，只留铃铛
      if (!compactMonthGrid) tag.append(remind);
      content.append(tag);
    }

    if (o.isVirtual && !compactMonthGrid) {
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
  <div class="wb-calendar h-full" :class="{ 'has-inbox': inboxOpen && !isMobile }">
    <div class="wb-calendar-main">
      <!-- key 绑定日期：跨零点时重建日历，让“今天”的蓝圈移动到新的一天 -->
      <FullCalendar ref="calRef" :key="`${store.currentDate}:${isMobile ? 'mobile' : 'desktop'}`" :options="options" />
    </div>
    <CalendarInbox
      v-if="inboxOpen && !isMobile"
      :drop-active="inboxDropActive"
      @open-task="emit('open-task', $event)"
      @close="emit('close-inbox')"
    />
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
      class="wb-calendar-inbox-btn"
      :aria-label="`收集箱，${store.inboxTasks.length} 项`"
      @click="inboxSheetOpen = true"
    >
      <Inbox aria-hidden="true" />
      <span>收集箱</span>
      <span v-if="store.inboxTasks.length" class="wb-calendar-inbox-badge">{{ store.inboxTasks.length }}</span>
    </button>
    <InboxSheet v-if="isMobile" v-model:open="inboxSheetOpen" />
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
