<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { CalendarClock, Check, Inbox, LoaderCircle, Pencil, Trash2, X } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import type { Occurrence } from "@/lib/types";
import { endTaskDrag, startTaskDrag } from "@/lib/task-drag";

const props = withDefaults(
  defineProps<{
    occurrence: Occurrence;
    inlineEdit?: boolean;
    meta?: string;
    canMoveToday?: boolean;
    canMoveInbox?: boolean;
    draggable?: boolean;
  }>(),
  {
    inlineEdit: true,
    meta: "",
    canMoveToday: false,
    canMoveInbox: false,
    draggable: false,
  },
);

const emit = defineEmits<{ (event: "open-task", occurrence: Occurrence): void }>();
const store = useTaskStore();

const mode = ref<"idle" | "edit" | "delete">("idle");
const draftTitle = ref(props.occurrence.task.title);
const busy = ref(false);
const inputEl = ref<HTMLInputElement>();

watch(
  () => props.occurrence.task.title,
  (title) => {
    if (mode.value === "idle") draftTitle.value = title;
  },
);

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
  const circle = event.currentTarget as HTMLElement | null;
  circle?.classList.add("wb-pop");
  setTimeout(() => circle?.classList.remove("wb-pop"), 300);
  try {
    await store.toggleOccurrence(props.occurrence);
  } catch {
    // Store 会保留原状态并显示全局错误提示。
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
    ]"
    :data-task-id="draggable ? occurrence.task.id : undefined"
    :draggable="draggable && mode === 'idle' && !occurrence.isVirtual"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <button
      type="button"
      class="wb-check"
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
        @keydown.enter.prevent="saveEdit"
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
      <button type="button" class="wb-sidebar-title" @click="beginEdit">
        <span :class="occurrence.completed ? 'line-through' : ''" :title="occurrence.task.title">
          {{ occurrence.task.title }}
        </span>
        <span
          v-if="occurrence.isVirtual"
          class="wb-repeat-mark"
          aria-label="重复事项"
          title="重复任务实例：不支持拖拽，编辑将作用于整个系列"
        >↻</span>
      </button>
      <span v-if="occurrence.task.priority > 0" class="wb-pri" :class="`wb-pri-${occurrence.task.priority}`" />
      <span v-if="meta" class="wb-row-meta">{{ meta }}</span>

      <div class="wb-row-actions">
        <button
          v-if="inlineEdit"
          type="button"
          aria-label="编辑事项"
          title="行内编辑"
          @click="beginEdit"
        >
          <Pencil aria-hidden="true" />
        </button>
        <button
          v-if="canMoveToday"
          type="button"
          aria-label="移到今天"
          title="移到今天"
          @click="moveToday"
        >
          <CalendarClock aria-hidden="true" />
        </button>
        <button
          v-if="canMoveInbox"
          type="button"
          aria-label="移到收集箱"
          title="移到收集箱"
          @click="moveInbox"
        >
          <Inbox aria-hidden="true" />
        </button>
        <button
          type="button"
          class="is-destructive"
          aria-label="删除事项"
          title="删除"
          @click="mode = 'delete'"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </template>
  </li>
</template>
