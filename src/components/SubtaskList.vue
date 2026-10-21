<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Plus, X } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import type { Task } from "@/lib/types";

const props = withDefaults(
  defineProps<{ parentId: number; date: string; editable?: boolean; autofocus?: boolean }>(),
  { editable: false, autofocus: false },
);
const emit = defineEmits<{ (e: "open-parent"): void }>();
const store = useTaskStore();

const parent = computed(() => store.tasks.find((t) => t.id === props.parentId));
const subtasks = computed(() => store.subtasksByParent.get(props.parentId) ?? []);
const isDone = (sub: Task) => (parent.value ? store.isSubtaskDone(sub, parent.value, props.date) : false);

const newTitle = ref("");
const adding = ref(false);
const addEl = ref<HTMLInputElement>();
const busyId = ref<number | null>(null);

async function toggle(sub: Task) {
  if (busyId.value) return;
  busyId.value = sub.id;
  try {
    await store.toggleSubtask(sub, props.parentId, props.date);
  } catch {
    // Store 显示错误提示。
  } finally {
    busyId.value = null;
  }
}

async function add(event?: KeyboardEvent) {
  if (event?.isComposing || adding.value || !newTitle.value.trim()) return;
  adding.value = true;
  try {
    await store.addSubtask(props.parentId, newTitle.value, props.date);
    newTitle.value = "";
  } catch {
    // 保留输入方便重试。
  } finally {
    adding.value = false;
    await nextTick();
    addEl.value?.focus();
  }
}

// 弹窗里改子任务标题：回车或失焦即保存，清空则恢复原标题
async function rename(sub: Task, event: Event) {
  const input = event.target as HTMLInputElement;
  const title = input.value.trim();
  if (!title) {
    input.value = sub.title;
    return;
  }
  if (title === sub.title) return;
  try {
    await store.updateTask({ ...sub, title });
  } catch {
    input.value = sub.title;
  }
}

async function remove(sub: Task) {
  try {
    await store.removeSubtask(sub);
  } catch {
    // Store 显示错误提示。
  }
}

defineExpose({ focusAdd: () => addEl.value?.focus() });
</script>

<template>
  <div class="wb-subtasks" :class="{ 'is-editable': editable }">
    <ul v-if="subtasks.length" class="wb-subtask-items">
      <li v-for="sub in subtasks" :key="sub.id" class="wb-subtask" :class="{ 'is-done': isDone(sub) }">
        <button
          type="button"
          class="wb-subtask-check"
          role="checkbox"
          :aria-checked="isDone(sub)"
          :aria-label="`${isDone(sub) ? '取消完成' : '完成'}子任务：${sub.title}`"
          :disabled="busyId === sub.id"
          @click.stop="toggle(sub)"
        >
          ✓
        </button>
        <input
          v-if="editable"
          class="wb-subtask-input"
          :value="sub.title"
          :aria-label="`子任务标题：${sub.title}`"
          @keydown.enter.prevent="!($event as KeyboardEvent).isComposing && ($event.target as HTMLInputElement).blur()"
          @blur="rename(sub, $event)"
        />
        <button v-else type="button" class="wb-subtask-title" @click="emit('open-parent')">{{ sub.title }}</button>
        <button v-if="editable" type="button" class="wb-subtask-remove" :aria-label="`删除子任务：${sub.title}`" @click="remove(sub)">
          <X aria-hidden="true" />
        </button>
      </li>
    </ul>
    <label class="wb-subtask-add">
      <Plus aria-hidden="true" />
      <input
        ref="addEl"
        v-model="newTitle"
        :autofocus="autofocus"
        aria-label="添加子任务"
        placeholder="添加子任务，回车保存"
        :disabled="adding"
        @keydown.enter.prevent="add($event as KeyboardEvent)"
      />
    </label>
  </div>
</template>
