<script setup lang="ts">
import { ref } from "vue";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import type { Task } from "@/lib/types";

const props = defineProps<{ task: Task }>();
const store = useTaskStore();
const confirming = ref(false);
const busyAction = ref<"restore" | "delete" | null>(null);

async function restore() {
  if (busyAction.value) return;
  busyAction.value = "restore";
  try {
    await store.restoreTask(props.task.id);
  } catch {
    // Store 负责错误提示。
  } finally {
    busyAction.value = null;
  }
}

async function permanentlyDelete() {
  if (busyAction.value) return;
  busyAction.value = "delete";
  try {
    await store.permanentlyDeleteTask(props.task.id);
  } catch {
    // 保留确认状态，方便直接重试。
  } finally {
    busyAction.value = null;
  }
}
</script>

<template>
  <li class="wb-item wb-sidebar-row wb-recycle-row" :class="confirming ? 'is-active' : ''">
    <Trash2 class="wb-recycle-leading" aria-hidden="true" />

    <div v-if="confirming" class="wb-inline-delete" role="group" aria-label="确认永久删除">
      <span>永久删除后无法恢复</span>
      <button type="button" :disabled="!!busyAction" @click="confirming = false">取消</button>
      <button type="button" class="is-destructive" :disabled="!!busyAction" @click="permanentlyDelete">
        <LoaderCircle v-if="busyAction === 'delete'" class="animate-spin" aria-hidden="true" />
        {{ busyAction === "delete" ? "删除中" : "永久删除" }}
      </button>
    </div>

    <template v-else>
      <span class="wb-sidebar-title" :title="task.title">
        <span>{{ task.title }}</span>
      </span>
      <span class="wb-row-meta">{{ task.dueDate ? task.dueDate.slice(5).replace("-", "/") : "收集箱" }}</span>
      <div class="wb-row-actions">
        <button type="button" aria-label="恢复事项" title="恢复" :disabled="!!busyAction" @click="restore">
          <LoaderCircle v-if="busyAction === 'restore'" class="animate-spin" aria-hidden="true" />
          <RotateCcw v-else aria-hidden="true" />
        </button>
        <button
          type="button"
          class="is-destructive"
          aria-label="永久删除事项"
          title="永久删除"
          :disabled="!!busyAction"
          @click="confirming = true"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </template>
  </li>
</template>
