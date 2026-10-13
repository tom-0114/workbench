<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CalendarArrowDown, CalendarClock, CalendarDays, Check, Flag, Inbox, Info, LoaderCircle, MoreHorizontal, Repeat2, Trash2, X } from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTaskStore } from "@/stores/tasks";
import { PRIORITY_LABELS, type Occurrence, type Priority } from "@/lib/types";
import { addDays, parseDate } from "@/lib/date";
import { endTaskDrag, startTaskDrag } from "@/lib/task-drag";

const props = withDefaults(
  defineProps<{
    occurrence: Occurrence;
    inlineEdit?: boolean;
    canMoveToday?: boolean;
    canMoveInbox?: boolean;
    canPostpone?: boolean;
    draggable?: boolean;
    selected?: boolean;
  }>(),
  {
    inlineEdit: true,
    canMoveToday: false,
    canMoveInbox: false,
    canPostpone: false,
    draggable: false,
    selected: false,
  },
);

const emit = defineEmits<{ (event: "open-task", occurrence: Occurrence): void }>();
const store = useTaskStore();

const mode = ref<"idle" | "edit" | "delete">("idle");
const draftTitle = ref(props.occurrence.task.title);
const busy = ref(false);
const inputEl = ref<HTMLInputElement>();
const actionsOpen = ref(false);
const dateOpen = ref(false);
const dateBusy = ref(false);
// 默认“仅这一次”：快捷改期最常见的意图是挪某一天，整体改期是更重的决定，让用户显式选择
const scope = ref<"once" | "series">("once");
const dateDraft = ref(props.occurrence.date);
const priorityOpen = ref(false);

watch(
  () => props.occurrence.task.title,
  (title) => {
    if (mode.value === "idle") draftTitle.value = title;
  },
);

/** 行内日期标签：今天/明天/昨天/M月D日（跨年带年份），无日期为“未安排” */
const dateLabel = computed(() => {
  const date = props.occurrence.date;
  if (!date) return "未安排";
  if (date === store.currentDate) return "今天";
  if (date === addDays(store.currentDate, 1)) return "明天";
  if (date === addDays(store.currentDate, -1)) return "昨天";
  const d = parseDate(date);
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === parseDate(store.currentDate).getFullYear() ? base : `${d.getFullYear()}年${base}`;
});
const isOverdue = computed(
  () => !!props.occurrence.date && props.occurrence.date < store.currentDate && !props.occurrence.completed,
);

watch(dateOpen, (open) => {
  if (!open) return;
  dateDraft.value = props.occurrence.date;
  scope.value = "once";
});

async function applyDate(newDate: string) {
  // 重复任务的“仅这一次”必须落到一个明确日期；清空只对普通任务开放
  if (dateBusy.value || (props.occurrence.isVirtual && !newDate)) return;
  dateBusy.value = true;
  try {
    await store.rescheduleOccurrence(props.occurrence, newDate, scope.value);
    dateOpen.value = false;
  } catch {
    // Store 负责错误提示，弹窗保持打开便于重试。
  } finally {
    dateBusy.value = false;
  }
}

async function applyPriority(priority: Priority) {
  if (busy.value) return;
  priorityOpen.value = false;
  if (priority === props.occurrence.task.priority) return;
  busy.value = true;
  try {
    await store.setPriority(props.occurrence, priority);
  } catch {
    // Store 负责错误提示。
  } finally {
    busy.value = false;
  }
}

async function beginEdit() {
  if (!props.inlineEdit) {
    emit("open-task", props.occurrence);
    return;
  }
  draftTitle.value = props.occurrence.task.title;
  mode.value = "edit";
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function cancelEdit() {
  draftTitle.value = props.occurrence.task.title;
  mode.value = "idle";
}

// Enter 直接保存；输入法选词中的 Enter 不触发，也不拦截默认行为
function onEditorEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  void saveEdit();
}

async function saveEdit() {
  const title = draftTitle.value.trim();
  if (!title || busy.value) return;
  if (title === props.occurrence.task.title) {
    mode.value = "idle";
    return;
  }
  busy.value = true;
  try {
    await store.updateTask({ ...props.occurrence.task, title });
    mode.value = "idle";
  } catch {
    await nextTick();
    inputEl.value?.focus();
  } finally {
    busy.value = false;
  }
}

async function toggleCompletion(event: MouseEvent) {
  if (busy.value) return;
  busy.value = true;
  const circle = event.currentTarget as HTMLElement | null;
  circle?.classList.add("wb-pop");
  setTimeout(() => circle?.classList.remove("wb-pop"), 300);
  try {
    await store.toggleOccurrence(props.occurrence);
  } catch {
    // Store 会保留原状态并显示全局错误提示。
  } finally {
    busy.value = false;
  }
}

async function moveToday() {
  try {
    await store.moveTask(props.occurrence.task.id, store.currentDate);
  } catch {
    // Store 负责错误提示。
  }
}

async function moveInbox() {
  try {
    await store.moveTask(props.occurrence.task.id, "");
  } catch {
    // Store 负责错误提示。
  }
}

async function postpone() {
  try {
    await store.moveTask(props.occurrence.task.id, addDays(store.currentDate, 1));
  } catch {
    // Store 负责错误提示。
  }
}

function onDragStart(event: DragEvent) {
  // 重复任务的实例不能拖：拖拽按 taskId 移动，会整个系列搬家
  if (
    props.occurrence.isVirtual ||
    !props.draggable ||
    mode.value !== "idle" ||
    !startTaskDrag(event, props.occurrence.task.id)
  ) {
    event.preventDefault();
    return;
  }
  (event.currentTarget as HTMLElement).classList.add("is-drag-source");
}

function onDragEnd(event: DragEvent) {
  (event.currentTarget as HTMLElement).classList.remove("is-drag-source");
  endTaskDrag();
}

async function confirmDelete() {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.deleteTask(props.occurrence.task.id);
    mode.value = "idle";
  } catch {
    // 保留确认状态，方便用户重试。
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li
    class="wb-item wb-sidebar-row"
    :class="[
      occurrence.completed ? 'wb-item-done' : '',
      draggable ? 'is-draggable' : '',
      mode !== 'idle' ? 'is-active' : '',
      selected ? 'is-selected' : '',
      occurrence.task.priority === 3 && !occurrence.completed ? 'is-pri-high' : '',
    ]"
    :data-task-id="occurrence.task.id"
    :draggable="draggable && mode === 'idle' && !occurrence.isVirtual"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <button
      type="button"
      class="wb-check"
      role="checkbox"
      :aria-checked="occurrence.completed"
      :disabled="busy"
      :class="occurrence.completed ? 'done' : ''"
      :aria-label="occurrence.completed ? `取消完成：${occurrence.task.title}` : `完成：${occurrence.task.title}`"
      :title="occurrence.completed ? '取消完成' : '完成'"
      @click.stop="toggleCompletion"
    >
      ✓
    </button>

    <div v-if="mode === 'edit'" class="wb-inline-editor">
      <input
        ref="inputEl"
        v-model="draftTitle"
        :aria-label="`编辑：${occurrence.task.title}`"
        :disabled="busy"
        @keydown.enter="onEditorEnter"
        @keydown.esc.prevent="cancelEdit"
      />
      <button
        type="button"
        class="is-save"
        aria-label="保存修改"
        title="保存（Enter）"
        :disabled="busy || !draftTitle.trim()"
        @click="saveEdit"
      >
        <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
        <Check v-else aria-hidden="true" />
      </button>
      <button type="button" aria-label="取消编辑" title="取消（Esc）" :disabled="busy" @click="cancelEdit">
        <X aria-hidden="true" />
      </button>
    </div>

    <div v-else-if="mode === 'delete'" class="wb-inline-delete" role="group" aria-label="确认删除">
      <span>
        {{ occurrence.task.repeatRule === "none" ? "删除此事项？" : "删除整个重复系列？" }}
      </span>
      <button type="button" :disabled="busy" @click="mode = 'idle'">取消</button>
      <button type="button" class="is-destructive" :disabled="busy" @click="confirmDelete">
        <LoaderCircle v-if="busy" class="animate-spin" aria-hidden="true" />
        {{ busy ? "删除中" : "确认" }}
      </button>
    </div>

    <template v-else>
      <button type="button" class="wb-sidebar-title" :title="occurrence.task.title" @click="beginEdit">
        <span class="wb-row-copy"><span class="wb-task-name" :class="occurrence.completed ? 'line-through' : ''">{{ occurrence.task.title }}</span><span v-if="occurrence.task.tags.length" class="wb-row-tags"><span v-for="tag in occurrence.task.tags" :key="tag">#{{ tag }}</span></span></span>
        <Repeat2 v-if="occurrence.isVirtual" class="wb-repeat-mark" aria-label="重复任务" />
      </button>

      <Popover v-model:open="priorityOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="wb-task-priority wb-pri-btn"
            :class="`wb-pri-${occurrence.task.priority}`"
            :aria-label="`优先级：${PRIORITY_LABELS[occurrence.task.priority]}，点击修改`"
            title="设置优先级"
          >
            <Flag aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent class="wb-task-actions-menu wb-pri-menu" side="bottom" align="start" :align-offset="-8">
          <button
            v-for="p in [0, 1, 2, 3] as Priority[]"
            :key="p"
            type="button"
            :class="{ 'is-current': occurrence.task.priority === p }"
            :aria-label="`设为${PRIORITY_LABELS[p]}优先级`"
            @click="applyPriority(p)"
          >
            <Flag aria-hidden="true" :class="p > 0 ? `wb-pri-${p}` : ''" />
            {{ PRIORITY_LABELS[p] }}
            <Check v-if="occurrence.task.priority === p" class="wb-menu-check" aria-hidden="true" />
          </button>
        </PopoverContent>
      </Popover>

      <Popover v-model:open="dateOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="wb-row-date"
            :class="{ 'is-overdue': isOverdue, 'is-empty': !occurrence.date }"
            :disabled="occurrence.completed"
            :aria-label="`日期：${dateLabel}，点击修改`"
            title="修改日期"
          >
            <CalendarDays aria-hidden="true" />
            <span>{{ dateLabel }}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent class="wb-date-pop" side="bottom" align="end" :align-offset="-4">
          <label class="wb-date-pop-field">
            <span>日期</span>
            <input
              type="date"
              :value="dateDraft"
              :disabled="dateBusy"
              :aria-label="`选择日期：${occurrence.task.title}`"
              @change="applyDate(($event.target as HTMLInputElement).value)"
            />
          </label>
          <div
            v-if="occurrence.isVirtual"
            class="wb-date-scope"
            role="radiogroup"
            :aria-label="`改期范围：${occurrence.task.title}`"
          >
            <button type="button" role="radio" :aria-checked="scope === 'once'" :class="{ 'is-current': scope === 'once' }" @click="scope = 'once'">仅这一次</button>
            <button type="button" role="radio" :aria-checked="scope === 'series'" :class="{ 'is-current': scope === 'series' }" @click="scope = 'series'">整个系列</button>
          </div>
          <p v-if="occurrence.isVirtual" class="wb-date-hint">
            {{ scope === "once" ? "只移动这一天，后续重复不变" : "整个系列将从所选日期重新开始" }}
          </p>
          <div class="wb-date-quick">
            <button type="button" :disabled="dateBusy" @click="applyDate(store.currentDate)">今天</button>
            <button type="button" :disabled="dateBusy" @click="applyDate(addDays(store.currentDate, 1))">明天</button>
            <button type="button" :disabled="dateBusy" @click="applyDate(addDays(store.currentDate, 2))">后天</button>
            <button type="button" :disabled="dateBusy" @click="applyDate(addDays(store.currentDate, 7))">一周后</button>
          </div>
          <button
            v-if="!occurrence.isVirtual && occurrence.date"
            type="button"
            class="wb-date-clear"
            :disabled="dateBusy"
            title="清除后移入收集箱"
            @click="applyDate('')"
          >
            清除日期
          </button>
        </PopoverContent>
      </Popover>

      <Popover v-model:open="actionsOpen">
        <PopoverTrigger as-child><button class="wb-control wb-task-more" :aria-label="`更多操作：${occurrence.task.title}`"><MoreHorizontal /></button></PopoverTrigger>
        <PopoverContent class="wb-task-actions-menu" side="bottom" align="end" @click="actionsOpen=false">
        <button
          type="button"
          aria-label="详细信息"
          title="打开任务详情"
          @click="emit('open-task', props.occurrence)"
        >
          <Info aria-hidden="true" />
          详细信息
        </button>
        <!-- 改期类操作会移动整个系列，重复任务实例不显示 -->
        <button
          v-if="canMoveToday && !occurrence.isVirtual"
          type="button"
          aria-label="移到今天"
          title="移到今天"
          @click="moveToday"
        >
          <CalendarClock aria-hidden="true" />
          移到今天
        </button>
        <button
          v-if="canPostpone && !occurrence.isVirtual"
          type="button"
          aria-label="推迟到明天"
          title="推迟到明天"
          @click="postpone"
        >
          <CalendarArrowDown aria-hidden="true" />
          推迟到明天
        </button>
        <button
          v-if="canMoveInbox && !occurrence.isVirtual"
          type="button"
          aria-label="移到收集箱"
          title="移到收集箱"
          @click="moveInbox"
        >
          <Inbox aria-hidden="true" />
          移到收集箱
        </button>
        <button
          type="button"
          class="is-destructive"
          aria-label="删除事项"
          title="删除"
          @click="mode = 'delete'"
        >
          <Trash2 aria-hidden="true" />
          删除任务
        </button>
        </PopoverContent>
      </Popover>
    </template>
  </li>
</template>
