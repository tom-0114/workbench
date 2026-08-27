<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Inbox, Plus, Settings2 } from "lucide-vue-next";
import { Draggable } from "@fullcalendar/interaction";
import { useTaskStore } from "@/stores/tasks";
import { isTauri } from "@/lib/repo";
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
import { parseDate } from "@/lib/date";
import { getDayMark } from "@/lib/cn-holidays";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const emit = defineEmits<{ (e: "open-task", occ: Occurrence): void }>();
const store = useTaskStore();

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

/* 新建待办（内联输入） */
const adding = ref(false);
const newTitle = ref("");
const addInput = ref<HTMLInputElement>();

async function startAdd() {
  adding.value = true;
  await nextTick();
  addInput.value?.focus();
}
async function submitAdd() {
  const t = newTitle.value.trim();
  if (t) await store.addTask({ title: t, dueDate: todayStr.value });
  newTitle.value = "";
  adding.value = false;
}

/* 收集箱：内联添加 + 拖到日历排期 */
const inboxAdding = ref(false);
const inboxTitle = ref("");
const inboxInput = ref<HTMLInputElement>();
const inboxList = ref<HTMLElement>();
let draggable: Draggable | null = null;

async function startInboxAdd() {
  inboxAdding.value = true;
  await nextTick();
  inboxInput.value?.focus();
}
async function submitInboxAdd() {
  const t = inboxTitle.value.trim();
  if (t) await store.addTask({ title: t, dueDate: "" });
  inboxTitle.value = "";
  inboxAdding.value = false;
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
onMounted(async () => {
  // 收集箱条目可拖到月历的某一天
  if (inboxList.value) {
    draggable = new Draggable(inboxList.value, {
      itemSelector: "[data-task-id]",
      eventData: (el) => ({
        title: el.querySelector(".wb-inbox-title")?.textContent ?? "",
        create: false,
      }),
    });
  }
  if (isTauri) {
    const auto = await import("@tauri-apps/plugin-autostart");
    autostartEnabled.value = await auto.isEnabled();
  }
});
onBeforeUnmount(() => draggable?.destroy());
</script>

<template>
  <aside class="flex h-full flex-col">
    <!-- 标题区 -->
    <div class="px-5 pb-1 pt-6">
      <h1 class="text-2xl font-semibold tracking-tight">今天</h1>
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

    <!-- 列表区 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      <!-- 待办 -->
      <div class="wb-section">
        <span>待办</span>
        <span>{{ pending.length }}</span>
      </div>
      <div
        v-if="pending.length === 0 && !adding"
        class="px-2 py-1 text-[13px]"
        style="color: var(--text-tertiary)"
      >
        今天没有待办事项
      </div>
      <ul>
        <li v-for="occ in pending" :key="occ.task.id + occ.date" class="wb-item group">
          <button class="wb-check" title="完成" @click="store.toggleOccurrence(occ)">✓</button>
          <button
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[14px]"
            @click="emit('open-task', occ)"
          >
            <span class="truncate" :title="occ.task.title">{{ occ.task.title }}</span>
            <span
              v-if="occ.isVirtual"
              class="text-[10px]"
              style="color: var(--text-tertiary)"
              >↻</span
            >
            <span v-if="occ.task.priority > 0" class="wb-pri" :class="`wb-pri-${occ.task.priority}`" />
          </button>
        </li>
      </ul>

      <!-- 逾期 -->
      <template v-if="store.overdueTasks.length > 0">
        <div class="wb-section">
          <span style="color: #ff3b30">逾期</span>
          <span>{{ store.overdueTasks.length }}</span>
        </div>
        <ul>
          <li v-for="t in store.overdueTasks" :key="t.id" class="wb-item group">
            <button class="wb-check" title="完成" @click="store.toggleOccurrence(taskToOcc(t))">
              ✓
            </button>
            <button
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[14px]"
              @click="emit('open-task', taskToOcc(t))"
            >
              <span class="truncate" :title="t.title">{{ t.title }}</span>
              <span class="text-[11px]" style="color: var(--text-tertiary)">{{
                t.dueDate.slice(5).replace("-", "/")
              }}</span>
            </button>
            <button
              class="hidden shrink-0 rounded-md px-1.5 py-0.5 text-[11px] transition-colors group-hover:block"
              style="color: var(--text-secondary)"
              @click="store.moveTask(t.id, todayStr)"
            >
              移到今天
            </button>
          </li>
        </ul>
      </template>

      <!-- 已完成 -->
      <template v-if="done.length > 0">
        <div class="wb-section">
          <span>已完成</span>
          <span>{{ done.length }}</span>
        </div>
        <ul>
          <li
            v-for="occ in done"
            :key="occ.task.id + occ.date"
            class="wb-item wb-item-done"
          >
            <button class="wb-check done" title="取消完成" @click="store.toggleOccurrence(occ)">
              ✓
            </button>
            <button
              class="min-w-0 flex-1 truncate text-left text-[14px] line-through"
              :title="occ.task.title"
              style="color: var(--text-secondary)"
              @click="emit('open-task', occ)"
            >
              {{ occ.task.title }}
            </button>
          </li>
        </ul>
      </template>

      <!-- 收集箱 -->
      <div class="wb-section">
        <span class="flex items-center gap-1"><Inbox :size="11" /> 收集箱</span>
        <span>{{ store.inboxTasks.length }}</span>
      </div>
      <div ref="inboxList">
        <ul>
          <li
            v-for="t in store.inboxTasks"
            :key="t.id"
            class="wb-item cursor-grab active:cursor-grabbing"
            :data-task-id="t.id"
            title="拖到日历上可安排日期"
          >
            <button class="wb-check" title="完成" @click="store.toggleOccurrence(taskToOcc(t))">
              ✓
            </button>
            <button
              class="wb-inbox-title min-w-0 flex-1 truncate text-left text-[14px]"
              :title="t.title"
              @click="emit('open-task', taskToOcc(t))"
            >
              {{ t.title }}
            </button>
            <span v-if="t.priority > 0" class="wb-pri" :class="`wb-pri-${t.priority}`" />
          </li>
        </ul>
      </div>
      <div v-if="inboxAdding" class="wb-item">
        <span class="wb-check" style="border-style: dashed" />
        <input
          ref="inboxInput"
          v-model="inboxTitle"
          class="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          placeholder="记点什么…"
          @keydown.enter.prevent="submitInboxAdd"
          @keydown.esc="inboxAdding = false; inboxTitle = ''"
          @blur="submitInboxAdd"
        />
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

      <!-- 内联新建输入 -->
      <div v-if="adding" class="wb-item">
        <span class="wb-check" style="border-style: dashed" />
        <input
          ref="addInput"
          v-model="newTitle"
          class="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          placeholder="添加到今天…"
          @keydown.enter.prevent="submitAdd"
          @keydown.esc="adding = false; newTitle = ''"
          @blur="submitAdd"
        />
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
            class="relative rounded-md p-1.5 transition-colors hover:bg-black/[0.035]"
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
              <button
                v-else-if="updateAvailable"
                class="rounded-md px-2 py-0.5 text-[12px] text-white transition-opacity hover:opacity-90"
                style="background: var(--accent-color)"
                @click="installUpdate"
              >
                更新到 v{{ updateVersion }}
              </button>
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
          <div v-else class="text-[12px]" style="color: var(--text-tertiary)">
            浏览器预览模式，数据存 localStorage
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </aside>
</template>
