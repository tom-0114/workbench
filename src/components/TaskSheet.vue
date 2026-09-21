<script setup lang="ts">
import { ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { useTaskStore } from "@/stores/tasks";
import type { Occurrence, Task } from "@/lib/types";
import { REPEAT_LABELS } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import TaskSheetForm from "@/components/TaskSheetForm.vue";

const props = defineProps<{ occurrence: Occurrence | null }>();
const open = defineModel<boolean>("open", { default: false });

const store = useTaskStore();
const isMobile = useMediaQuery("(max-width: 767px)");

const draft = ref<Task | null>(null);
const tagsInput = ref("");
const saving = ref(false);
const removing = ref(false);
const confirmingDelete = ref(false);
const actionError = ref("");

watch(
  () => [props.occurrence, open.value] as const,
  () => {
    if (open.value && props.occurrence) {
      draft.value = { ...props.occurrence.task, tags: [...props.occurrence.task.tags] };
      tagsInput.value = props.occurrence.task.tags.join(", ");
      saving.value = false;
      removing.value = false;
      confirmingDelete.value = false;
      actionError.value = "";
    }
  },
  { immediate: true },
);

async function save() {
  if (!draft.value || saving.value || removing.value) return;
  draft.value.tags = tagsInput.value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!draft.value.dueDate) draft.value.repeatRule = "none"; // 无日期无法重复
  saving.value = true;
  actionError.value = "";
  try {
    await store.updateTask(draft.value);
    open.value = false;
  } catch {
    actionError.value = "没有保存成功，请检查网络后重试。";
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!draft.value || saving.value || removing.value) return;
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    return;
  }
  removing.value = true;
  actionError.value = "";
  try {
    await store.deleteTask(draft.value.id);
    open.value = false;
  } catch {
    actionError.value = "没有删除成功，请检查网络后重试。";
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <!-- 桌面端：居中 Dialog -->
  <Dialog v-if="!isMobile" v-model:open="open">
    <DialogContent
      v-if="draft"
      class="wb-task-dialog flex max-h-[min(760px,calc(100dvh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
    >
      <DialogHeader class="border-b px-6 py-5 pr-14 text-left">
        <DialogTitle>编辑事项</DialogTitle>
        <DialogDescription v-if="draft.repeatRule !== 'none'">
          重复任务（{{ REPEAT_LABELS[draft.repeatRule] }}）：编辑将作用于整个系列
        </DialogDescription>
        <DialogDescription v-else>修改标题、日期与事项细节。</DialogDescription>
      </DialogHeader>

      <TaskSheetForm
        v-model:tags-input="tagsInput"
        :draft="draft"
        :saving="saving"
        :removing="removing"
        :confirming-delete="confirmingDelete"
        :action-error="actionError"
        @save="save"
        @remove="remove"
        @cancel="open = false"
      />
    </DialogContent>
  </Dialog>

  <!-- 移动端：底部抽屉（shadcn Sheet） -->
  <Sheet v-else v-model:open="open">
    <SheetContent
      v-if="draft"
      side="bottom"
      class="wb-task-sheet gap-0 p-0"
    >
      <div class="mx-auto mt-2.5 h-1 w-9 flex-none rounded-full" style="background: var(--border-subtle)" aria-hidden="true" />
      <SheetHeader class="border-b px-5 pb-3 pt-2 text-left">
        <SheetTitle>编辑事项</SheetTitle>
        <SheetDescription v-if="draft.repeatRule !== 'none'">
          重复任务（{{ REPEAT_LABELS[draft.repeatRule] }}）：编辑将作用于整个系列
        </SheetDescription>
        <SheetDescription v-else>修改标题、日期与事项细节。</SheetDescription>
      </SheetHeader>

      <TaskSheetForm
        v-model:tags-input="tagsInput"
        :draft="draft"
        :saving="saving"
        :removing="removing"
        :confirming-delete="confirmingDelete"
        :action-error="actionError"
        @save="save"
        @remove="remove"
        @cancel="open = false"
      />
    </SheetContent>
  </Sheet>
</template>
