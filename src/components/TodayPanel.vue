<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ChevronRight, FolderKanban, Inbox, LogOut, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-vue-next";
import { useMediaQuery } from "@vueuse/core";
import { useTaskStore } from "@/stores/tasks";
import { isTauri } from "@/lib/repo";
import type { Appearance } from "@/lib/appearance";
import { loadAppearance, setAppearance } from "@/lib/appearance";
import { parseQuickAdd } from "@/lib/nl-parse";
import { parseDate } from "@/lib/date";
import {
  checkedManually,
  checking,
  checkUpdate,
  currentVersion,
  installUpdate,
  updateAvailable,
  updateError,
  updateProgress,
  updateVersion,
  updating,
} from "@/lib/updater";
import type { Occurrence, Task } from "@/lib/types";
import { getDayMark } from "@/lib/cn-holidays";
import { searchTasks } from "@/lib/search";
import { endTaskDrag, getDraggedTaskId, hasDraggedTask, TASK_DRAG_END_EVENT } from "@/lib/task-drag";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SidebarTaskRow from "@/components/SidebarTaskRow.vue";
import RecycleTaskRow from "@/components/RecycleTaskRow.vue";

const emit = defineEmits<{
  (e: "open-task", occ: Occurrence): void;
  (e: "logout"): void;
  (e: "open-projects"): void;
}>();
const store = useTaskStore();
const isMobile = useMediaQuery("(max-width: 767px)");

function readSectionState() {
  try {
    const stored = JSON.parse(localStorage.getItem("wb.sidebarSections") || "{}");
    return { todo: true, done: true, overdue: true, inbox: true, recycle: false, ...stored };
  } catch {
    return { todo: true, done: true, overdue: true, inbox: true, recycle: false };
  }
}

const sectionOpen = reactive<{ todo: boolean; done: boolean; overdue: boolean; inbox: boolean; recycle: boolean }>(readSectionState());
watch(
  sectionOpen,
  (value) => localStorage.setItem("wb.sidebarSections", JSON.stringify(value)),
  { deep: true },
);

const todayStr = computed(() => store.currentDate);
const dateLabel = computed(() => {
  const d = parseDate(todayStr.value);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${week}`;
});

const todayMark = computed(() => getDayMark(todayStr.value));

const pending = computed(() => store.todayOccurrences.filter((o) => !o.completed));
const done = computed(() => store.todayOccurrences.filter((o) => o.completed));

function taskToOcc(t: Task): Occurrence {
  return { task: t, date: t.dueDate, completed: t.completed, isVirtual: false };
}

/* 新建待办（内联输入 + 自然语言日期/重复解析） */
const adding = ref(false);
const newTitle = ref("");
const addInput = ref<HTMLInputElement>();

const addParsed = computed(() =>
  adding.value && newTitle.value.trim() ? parseQuickAdd(newTitle.value, parseDate(todayStr.value)) : null,
);

async function startAdd() {
  adding.value = true;
  await nextTick();
  addInput.value?.focus();
}
async function submitAdd() {
  const t = newTitle.value.trim();
  if (!t) {
    adding.value = false;
    return;
  }
  const p = parseQuickAdd(t, parseDate(todayStr.value));
  try {
    await store.addTask({
      title: p.title,
      dueDate: p.dueDate ?? todayStr.value,
      repeatRule: p.repeatRule ?? "none",
    });
    newTitle.value = "";
    adding.value = false;
  } catch {
    await nextTick();
    addInput.value?.focus();
  }
}

/* 收集箱：内联添加 + 拖到日历排期（支持自然语言日期） */
const inboxAdding = ref(false);
const inboxTitle = ref("");
const inboxInput = ref<HTMLInputElement>();

const inboxParsed = computed(() =>
  inboxAdding.value && inboxTitle.value.trim() ? parseQuickAdd(inboxTitle.value, new Date()) : null,
);

async function startInboxAdd() {
  inboxAdding.value = true;
  await nextTick();
  inboxInput.value?.focus();
}
async function submitInboxAdd() {
  const t = inboxTitle.value.trim();
  if (!t) {
    inboxAdding.value = false;
    return;
  }
  const p = parseQuickAdd(t, new Date());
  try {
    await store.addTask({
      title: p.title,
      dueDate: p.dueDate ?? "",
      repeatRule: p.repeatRule ?? "none",
    });
    inboxTitle.value = "";
    inboxAdding.value = false;
  } catch {
    await nextTick();
    inboxInput.value?.focus();
  }
}

/* 搜索：Ctrl+F 或点放大镜进入，Esc 退出 */
const searching = ref(false);
const searchQuery = ref("");
const searchInput = ref<HTMLInputElement>();

const searchResults = computed(() => searchTasks(store.activeTasks, searchQuery.value));

async function openSearch() {
  searching.value = true;
  await nextTick();
  searchInput.value?.focus();
}
function closeSearch() {
  searching.value = false;
  searchQuery.value = "";
}
function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  const typing =
    !!target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable);

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openSearch();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

  // T：回到今天（侧栏日期滚动 + 日历跳转）
  if (e.key === "t" || e.key === "T") {
    e.preventDefault();
    store.refreshDate();
    window.dispatchEvent(new CustomEvent("wb:calendar-nav", { detail: "today" }));
    return;
  }
  // N：新建待办（桌面聚焦侧栏输入；移动端唤起日历快速添加）
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    if (isMobile.value) {
      window.dispatchEvent(new CustomEvent("wb:calendar-nav", { detail: "quickadd" }));
    } else {
      void startAdd();
    }
    return;
  }
  // ←/→：上/下一期（月、周或年，跟随当前视图）
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent("wb:calendar-nav", { detail: e.key === "ArrowLeft" ? "prev" : "next" }),
    );
  }
}
onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));

/* 外观（深色模式） */
const appearance = ref<Appearance>(loadAppearance());
function changeAppearance(a: Appearance) {
  appearance.value = a;
  setAppearance(a);
}
const appearanceOptions: Array<[Appearance, string]> = [
  ["system", "跟随"],
  ["light", "浅色"],
  ["dark", "深色"],
];

function fmtDueLabel(t: Task): string {
  if (!t.dueDate) return "收集箱";
  return t.dueDate.replace(/-/g, "/");
}

/* 开机自启（设置弹层内） */
const autostartEnabled = ref(false);
const dataDir = ref("");
onMounted(async () => {
  if (isTauri) {
    try {
      const { appConfigDir } = await import("@tauri-apps/api/path");
      dataDir.value = await appConfigDir();
    } catch (e) {
      dataDir.value = `获取失败: ${String(e)}`;
    }
  }
});
async function toggleAutostart() {
  if (!isTauri) return;
  const auto = await import("@tauri-apps/plugin-autostart");
  if (await auto.isEnabled()) {
    await auto.disable();
    autostartEnabled.value = false;
  } else {
    await auto.enable();
    autostartEnabled.value = true;
  }
}
type DropTarget = "todo" | "inbox";
const activeDropTarget = ref<DropTarget | null>(null);

function onDropZoneEnter(event: DragEvent, target: DropTarget) {
  if (!hasDraggedTask(event.dataTransfer)) return;
  event.preventDefault();
  activeDropTarget.value = target;
}

function onDropZoneOver(event: DragEvent, target: DropTarget) {
  if (!hasDraggedTask(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  activeDropTarget.value = target;
}

function onDropZoneLeave(event: DragEvent, target: DropTarget) {
  const zone = event.currentTarget as HTMLElement;
  const next = event.relatedTarget as Node | null;
  if (next && zone.contains(next)) return;
  if (activeDropTarget.value === target) activeDropTarget.value = null;
}

async function onDropZoneDrop(event: DragEvent, target: DropTarget) {
  if (!hasDraggedTask(event.dataTransfer)) return;
  event.preventDefault();
  const taskId = getDraggedTaskId(event.dataTransfer);
  activeDropTarget.value = null;
  endTaskDrag();
  if (!taskId) return;
  try {
    await store.moveTask(taskId, target === "todo" ? todayStr.value : "");
  } catch {
    // Store 负责错误提示。
  }
}

function resetDropTarget() {
  activeDropTarget.value = null;
}

onMounted(async () => {
  window.addEventListener(TASK_DRAG_END_EVENT, resetDropTarget);
  if (isTauri) {
    const auto = await import("@tauri-apps/plugin-autostart");
    autostartEnabled.value = await auto.isEnabled();
  }
});
onBeforeUnmount(() => window.removeEventListener(TASK_DRAG_END_EVENT, resetDropTarget));
</script>

<template>
  <aside class="flex h-full flex-col">
    <!-- 标题区 -->
    <div class="px-5 pb-1 pt-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">今天</h1>
        <div class="flex items-center gap-0.5">
          <button
            class="wb-icon-button rounded-md p-1.5 transition-colors hover:bg-black/[0.045]"
            style="color: var(--text-tertiary)"
            title="切换到项目工作台"
            @click="emit('open-projects')"
          >
            <FolderKanban :size="16" />
          </button>
          <button
            class="wb-icon-button rounded-md p-1.5 transition-colors hover:bg-black/[0.045]"
            style="color: var(--text-tertiary)"
            title="搜索全部任务 (Ctrl+F)"
            @click="searching ? closeSearch() : openSearch()"
          >
            <Search :size="16" />
          </button>
        </div>
      </div>
      <div
        class="mt-0.5 flex items-center gap-1.5 text-[13px]"
        style="color: var(--text-secondary)"
      >
        {{ dateLabel }}
        <span
          v-if="todayMark"
          class="rounded px-1 py-px text-[10px] font-medium"
          :style="
            todayMark.type === 'holiday'
              ? 'color:#248a3d;background:rgba(52,199,89,0.14)'
              : 'color:#cc7700;background:rgba(255,149,0,0.16)'
          "
        >
          {{ todayMark.type === "holiday" ? `${todayMark.name} 休` : "班" }}
        </span>
      </div>
    </div>

    <!-- 搜索输入 -->
    <div v-if="searching" class="px-3 pb-1 pt-2">
      <div
        class="flex items-center gap-2 rounded-[8px] border bg-white px-2.5 py-1.5"
        style="border-color: var(--border-subtle)"
      >
        <Search :size="13" style="color: var(--text-tertiary)" class="shrink-0" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          placeholder="搜索标题、备注、标签…"
          @keydown.esc="closeSearch"
        />
        <button
          class="wb-icon-button shrink-0 rounded p-0.5 transition-colors hover:bg-black/[0.045]"
          style="color: var(--text-tertiary)"
          title="关闭 (Esc)"
          @click="closeSearch"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <!-- 列表区 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      <!-- 搜索结果 -->
      <div v-if="searching">
        <div v-if="!searchQuery.trim()" class="px-2 py-3 text-[12px]" style="color: var(--text-tertiary)">
          输入关键词搜索全部 {{ store.activeTasks.length }} 条任务；多个关键词用空格分隔
        </div>
        <template v-else>
          <div class="wb-section">
            <span>搜索结果</span>
            <span>{{ searchResults.length >= 100 ? "前 100" : searchResults.length }}</span>
          </div>
          <div
            v-if="searchResults.length === 0"
            class="px-2 py-2 text-[13px]"
            style="color: var(--text-tertiary)"
          >
            没有匹配的任务
          </div>
          <ul>
            <SidebarTaskRow
              v-for="t in searchResults"
              :key="t.id"
              :occurrence="taskToOcc(t)"
              :inline-edit="!isMobile"
              :meta="fmtDueLabel(t)"
              @open-task="emit('open-task', $event)"
            />
          </ul>
        </template>
      </div>

      <div v-show="!searching">
      <!-- 待办 -->
      <div
        class="wb-drop-zone"
        :class="activeDropTarget === 'todo' ? 'is-drop-active' : ''"
        @dragenter="onDropZoneEnter($event, 'todo')"
        @dragover="onDropZoneOver($event, 'todo')"
        @dragleave="onDropZoneLeave($event, 'todo')"
        @drop="onDropZoneDrop($event, 'todo')"
      >
      <Collapsible v-model:open="sectionOpen.todo">
        <CollapsibleTrigger as-child>
          <button type="button" class="wb-section wb-section-toggle" :aria-expanded="sectionOpen.todo">
            <ChevronRight :class="sectionOpen.todo ? 'is-open' : ''" aria-hidden="true" />
            <span>待办</span>
            <span class="wb-section-count">{{ pending.length }}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            v-if="pending.length === 0 && !adding"
            class="px-2 py-1 text-[13px]"
            style="color: var(--text-tertiary)"
          >
            今天没有待办事项
          </div>
          <ul>
            <SidebarTaskRow
              v-for="occ in pending"
              :key="occ.task.id + occ.date"
              :occurrence="occ"
              :inline-edit="!isMobile"
              :draggable="!isMobile"
              can-move-inbox
              @open-task="emit('open-task', $event)"
            />
          </ul>
        </CollapsibleContent>
      </Collapsible>
      </div>

      <!-- 逾期 -->
      <Collapsible v-if="store.overdueTasks.length > 0" v-model:open="sectionOpen.overdue">
        <CollapsibleTrigger as-child>
          <button type="button" class="wb-section wb-section-toggle" :aria-expanded="sectionOpen.overdue">
            <ChevronRight :class="sectionOpen.overdue ? 'is-open' : ''" aria-hidden="true" />
            <span class="text-destructive">逾期</span>
            <span class="wb-section-count">{{ store.overdueTasks.length }}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul>
            <SidebarTaskRow
              v-for="t in store.overdueTasks"
              :key="t.id"
              :occurrence="taskToOcc(t)"
              :inline-edit="!isMobile"
              :meta="t.dueDate.slice(5).replace('-', '/')"
              :draggable="!isMobile"
              can-move-today
              can-move-inbox
              @open-task="emit('open-task', $event)"
            />
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <!-- 已完成（可折叠） -->
      <Collapsible v-if="done.length > 0" v-model:open="sectionOpen.done">
        <CollapsibleTrigger as-child>
          <button type="button" class="wb-section wb-section-toggle" :aria-expanded="sectionOpen.done">
            <ChevronRight :class="sectionOpen.done ? 'is-open' : ''" aria-hidden="true" />
            <span>已完成</span>
            <span class="wb-section-count">{{ done.length }}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul>
            <SidebarTaskRow
              v-for="occ in done"
              :key="occ.task.id + occ.date"
              :occurrence="occ"
              :inline-edit="!isMobile"
              @open-task="emit('open-task', $event)"
            />
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <!-- 收集箱 -->
      <div
        class="wb-drop-zone"
        :class="activeDropTarget === 'inbox' ? 'is-drop-active' : ''"
        @dragenter="onDropZoneEnter($event, 'inbox')"
        @dragover="onDropZoneOver($event, 'inbox')"
        @dragleave="onDropZoneLeave($event, 'inbox')"
        @drop="onDropZoneDrop($event, 'inbox')"
      >
      <Collapsible v-model:open="sectionOpen.inbox">
        <CollapsibleTrigger as-child>
          <button type="button" class="wb-section wb-section-toggle" :aria-expanded="sectionOpen.inbox">
            <ChevronRight :class="sectionOpen.inbox ? 'is-open' : ''" aria-hidden="true" />
            <span class="flex items-center gap-1"><Inbox :size="11" /> 收集箱</span>
            <span class="wb-section-count">{{ store.inboxTasks.length }}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div>
            <ul>
              <SidebarTaskRow
                v-for="t in store.inboxTasks"
                :key="t.id"
                :occurrence="taskToOcc(t)"
                :inline-edit="!isMobile"
                :draggable="!isMobile"
                can-move-today
                @open-task="emit('open-task', $event)"
              />
            </ul>
          </div>
          <div v-if="inboxAdding" class="wb-item">
            <span class="wb-check" style="border-style: dashed" />
            <input
              ref="inboxInput"
              v-model="inboxTitle"
              class="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              placeholder="记点什么… 可写 明天/每周三"
              @keydown.enter.prevent="submitInboxAdd"
              @keydown.esc="inboxAdding = false; inboxTitle = ''"
              @blur="submitInboxAdd"
            />
            <span v-if="inboxParsed?.hint" class="wb-nl-hint">{{ inboxParsed.hint }}</span>
          </div>
          <button
            v-else
            class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-black/[0.035]"
            style="color: var(--text-tertiary)"
            @click="startInboxAdd"
          >
            <Plus :size="12" />
            添加
          </button>
        </CollapsibleContent>
      </Collapsible>
      </div>

      <!-- 回收站 -->
      <Collapsible v-model:open="sectionOpen.recycle">
        <CollapsibleTrigger as-child>
          <button type="button" class="wb-section wb-section-toggle" :aria-expanded="sectionOpen.recycle">
            <ChevronRight :class="sectionOpen.recycle ? 'is-open' : ''" aria-hidden="true" />
            <span class="flex items-center gap-1"><Trash2 :size="11" /> 回收站</span>
            <span class="wb-section-count">{{ store.recycleBinTasks.length }}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            v-if="store.recycleBinTasks.length === 0"
            class="px-2 py-1 text-[13px]"
            style="color: var(--text-tertiary)"
          >
            回收站为空
          </div>
          <ul v-else>
            <RecycleTaskRow v-for="task in store.recycleBinTasks" :key="task.id" :task="task" />
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <!-- 内联新建输入（支持自然语言日期/重复） -->
      <div v-if="adding" class="wb-item">
        <span class="wb-check" style="border-style: dashed" />
        <input
          ref="addInput"
          v-model="newTitle"
          class="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          placeholder="添加到今天… 支持 明天/周五/每天"
          @keydown.enter.prevent="submitAdd"
          @keydown.esc="adding = false; newTitle = ''"
          @blur="submitAdd"
        />
        <span v-if="addParsed?.hint" class="wb-nl-hint">{{ addParsed.hint }}</span>
      </div>
      </div>
    </div>

    <!-- 底部操作区 -->
    <div
      class="flex items-center justify-between border-t px-3 py-2"
      style="border-color: var(--border-subtle)"
    >
      <button
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors hover:bg-black/[0.035]"
        style="color: var(--text-secondary)"
        @click="startAdd"
      >
        <Plus :size="14" />
        新建待办
      </button>

      <Popover>
        <PopoverTrigger as-child>
          <button
            class="wb-icon-button relative rounded-md p-1.5 transition-colors hover:bg-black/[0.035]"
            style="color: var(--text-tertiary)"
            title="设置"
          >
            <Settings2 :size="15" />
            <span
              v-if="updateAvailable"
              class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
              style="background: #ff3b30"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" class="w-60 p-3">
          <div class="mb-2 text-[13px] font-medium">设置</div>

          <!-- 外观：跟随系统 / 浅色 / 深色 -->
          <div class="flex items-center justify-between text-[13px]">
            <span style="color: var(--text-secondary)">外观</span>
            <div class="flex items-center gap-0.5 rounded-md p-0.5" style="background: var(--secondary)">
              <button
                v-for="[value, label] in appearanceOptions"
                :key="value"
                type="button"
                class="rounded-[5px] px-2 py-0.5 text-[12px] transition-all duration-150"
                :style="
                  appearance === value
                    ? 'background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border-subtle), 0 1px 2px rgba(0,0,0,0.05)'
                    : 'color: var(--text-secondary)'
                "
                :aria-pressed="appearance === value"
                @click="changeAppearance(value)"
              >
                {{ label }}
              </button>
            </div>
          </div>
          <div class="my-2.5 border-t" style="border-color: var(--border-subtle)" />

          <template v-if="isTauri">
            <label class="flex cursor-pointer items-center justify-between text-[13px]">
              <span style="color: var(--text-secondary)">开机自启</span>
              <input
                type="checkbox"
                class="h-3.5 w-3.5"
                :checked="autostartEnabled"
                @change="toggleAutostart"
              />
            </label>

            <div class="my-2.5 border-t" style="border-color: var(--border-subtle)" />

            <!-- 更新 -->
            <div class="flex items-center justify-between text-[13px]">
              <span style="color: var(--text-secondary)">版本 v{{ currentVersion }}</span>
              <button
                v-if="updating"
                class="rounded-md px-2 py-0.5 text-[12px]"
                style="color: var(--text-tertiary)"
                disabled
              >
                更新中 {{ updateProgress }}%
              </button>
              <span v-else-if="updateAvailable" class="flex items-center gap-1">
                <button
                  class="rounded-md px-2 py-0.5 text-[12px] text-white transition-opacity hover:opacity-90"
                  style="background: var(--accent-color)"
                  @click="installUpdate"
                >
                  更新到 v{{ updateVersion }}
                </button>
                <button
                  class="rounded-md p-1 transition-colors hover:bg-black/[0.045]"
                  style="color: var(--text-tertiary)"
                  title="重新检查是否有更新版本"
                  :disabled="checking"
                  @click="checkUpdate(false)"
                >
                  <RefreshCw :size="12" :class="checking ? 'animate-spin' : ''" />
                </button>
              </span>
              <button
                v-else
                class="rounded-md px-2 py-0.5 text-[12px] transition-colors hover:bg-black/[0.045]"
                style="color: var(--text-secondary)"
                :disabled="checking"
                @click="checkUpdate(false)"
              >
                {{ checking ? "检查中…" : "检查更新" }}
              </button>
            </div>
            <p
              v-if="checkedManually && !updating && !updateAvailable && !checking && !updateError"
              class="mt-1 text-[11px]"
              style="color: var(--text-tertiary)"
            >
              已是最新版本
            </p>
            <p v-if="updateError" class="mt-1 text-[11px]" style="color: #ff3b30">
              {{ updateError }}
            </p>

            <div class="my-2.5 border-t" style="border-color: var(--border-subtle)" />

            <!-- 诊断信息 -->
            <div class="space-y-1 text-[11px]" style="color: var(--text-tertiary)">
              <div>已加载任务：{{ store.tasks.length }} 条</div>
              <div class="break-all">数据目录：{{ dataDir || "…" }}</div>
              <div v-if="store.initError" style="color: #ff3b30" class="break-all">
                数据层错误：{{ store.initError }}
              </div>
            </div>
          </template>
          <div v-else class="flex flex-col gap-3">
            <div class="text-[12px]" style="color: var(--text-tertiary)">
              Web 版 · 已载入 {{ store.tasks.length }} 条任务
            </div>
            <button
              type="button"
              class="flex min-h-9 w-full items-center justify-center gap-2 rounded-md border text-[13px] transition-colors hover:bg-accent"
              @click="emit('logout')"
            >
              <LogOut :size="14" aria-hidden="true" />
              退出登录
            </button>
          </div>

          <div
            class="mt-2.5 border-t pt-2 text-[11px] leading-5"
            style="border-color: var(--border-subtle); color: var(--text-tertiary)"
          >
            快捷键：N 新建 · T 今天 · ← → 切换 · Ctrl+F 搜索
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </aside>
</template>
