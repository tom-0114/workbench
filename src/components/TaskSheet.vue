<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
import { X } from "lucide-vue-next";

const props = defineProps<{ occurrence: Occurrence | null; inlineDesktop?: boolean }>();
const open = defineModel<boolean>("open", { default: false });

const store = useTaskStore();
const isMobile = useMediaQuery("(max-width: 767px)");
const isWide = useMediaQuery("(min-width: 1100px)");

const draft = ref<Task | null>(null);
const tagsInput = ref("");
const saving = ref(false);
const removing = ref(false);
const confirmingDelete = ref(false);
const actionError = ref("");
const guardedOpen = computed({get:()=>open.value,set:(value:boolean)=>{if(!saving.value&&!removing.value)open.value=value;}});
const original = ref('');
const dirty = computed(() => !!draft.value && JSON.stringify({task:draft.value,tags:tagsInput.value}) !== original.value);
function canSwitch() {
  if (saving.value || removing.value) return false;
  if (dirty.value) {actionError.value='请先保存或取消当前修改，再切换任务。';return false;}
  return true;
}
defineExpose({ canSwitch });

watch(
  () => [props.occurrence, open.value] as const,
  () => {
    if (open.value && props.occurrence) {
      const task = props.occurrence.task;
      draft.value = { ...task, dueTime: task.dueTime ?? "", remindOffset: task.remindOffset ?? null, tags: [...task.tags] };
      tagsInput.value = props.occurrence.task.tags.join(", ");
      original.value = JSON.stringify({task:draft.value,tags:tagsInput.value});
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
  if (!draft.value.title.trim()) return; // 标题为空时 Enter 不触发保存
  draft.value.tags = tagsInput.value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!draft.value.dueDate) draft.value.repeatRule = "none"; // 无日期无法重复
  saving.value = true;
  actionError.value = "";
  try {
    const latest = store.tasks.find(task => task.id === draft.value?.id);
    // Completion may change in the list while the detail panel is open.
    const completionWasEdited = draft.value.completed !== props.occurrence?.task.completed;
    await store.updateTask({ ...draft.value, completed:completionWasEdited ? draft.value.completed : (latest?.completed ?? draft.value.completed) });
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
  <aside v-if="inlineDesktop && isWide && open && draft" class="wb-detail-panel" aria-labelledby="wb-detail-title">
    <header class="wb-detail-heading"><h2 id="wb-detail-title">任务详情</h2><button class="wb-control" aria-label="关闭任务详情" :disabled="saving || removing" @click="open=false"><X /></button></header>
    <p v-if="draft.repeatRule !== 'none'" class="wb-series-notice">{{ REPEAT_LABELS[draft.repeatRule] }}重复 · 编辑将作用于整个系列</p>
    <TaskSheetForm v-model:tags-input="tagsInput" :draft="draft" :saving="saving" :removing="removing" :confirming-delete="confirmingDelete" :action-error="actionError" @save="save" @remove="remove" @cancel="open=false" />
  </aside>
  <!-- 中等宽度使用对话框，手机使用底部抽屉 -->
  <Dialog v-else-if="!isMobile" v-model:open="guardedOpen">
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
  <Sheet v-else v-model:open="guardedOpen">
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
        <SheetDescription v-else class="sr-only">编辑任务标题、日期和备注。</SheetDescription>
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
