<script setup lang="ts">
import { ref, watch } from "vue";
import { useTaskStore } from "@/stores/tasks";
import type { Occurrence, Priority, RepeatRule, Task } from "@/lib/types";
import { PRIORITY_LABELS, REPEAT_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const props = defineProps<{ occurrence: Occurrence | null }>();
const open = defineModel<boolean>("open", { default: false });

const store = useTaskStore();

const draft = ref<Task | null>(null);
const tagsInput = ref("");

watch(
  () => [props.occurrence, open.value] as const,
  () => {
    if (open.value && props.occurrence) {
      draft.value = { ...props.occurrence.task, tags: [...props.occurrence.task.tags] };
      tagsInput.value = props.occurrence.task.tags.join(", ");
    }
  },
  { immediate: true },
);

async function save() {
  if (!draft.value) return;
  draft.value.tags = tagsInput.value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!draft.value.dueDate) draft.value.repeatRule = "none"; // 无日期无法重复
  await store.updateTask(draft.value);
  open.value = false;
}

async function remove() {
  if (!draft.value) return;
  await store.deleteTask(draft.value.id);
  open.value = false;
}

const priorityOptions: Priority[] = [0, 1, 2, 3];
const repeatOptions: RepeatRule[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "yearly-lunar",
];
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent v-if="draft" class="flex w-96 flex-col gap-0 sm:max-w-96">
      <SheetHeader>
        <SheetTitle>编辑事项</SheetTitle>
        <SheetDescription v-if="draft.repeatRule !== 'none'">
          重复任务（{{ REPEAT_LABELS[draft.repeatRule] }}）：编辑将作用于整个系列
        </SheetDescription>
      </SheetHeader>

      <div class="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div class="space-y-1.5">
          <Label for="wb-title">标题</Label>
          <Input id="wb-title" v-model="draft.title" placeholder="事项标题" />
        </div>

        <div class="space-y-1.5">
          <Label for="wb-date">日期</Label>
          <Input id="wb-date" v-model="draft.dueDate" type="date" />
          <p class="text-[11px]" style="color: var(--text-tertiary)">
            清空日期将移入收集箱
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label>优先级</Label>
            <Select v-model="draft.priority">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in priorityOptions" :key="p" :value="p">
                  {{ PRIORITY_LABELS[p] }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <Label>重复</Label>
            <Select v-model="draft.repeatRule">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in repeatOptions" :key="r" :value="r">
                  {{ REPEAT_LABELS[r] }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label for="wb-tags">标签（逗号分隔）</Label>
          <Input id="wb-tags" v-model="tagsInput" placeholder="如：工作, 学习" />
        </div>

        <div class="space-y-1.5">
          <Label for="wb-notes">备注</Label>
          <Textarea id="wb-notes" v-model="draft.notes" rows="5" placeholder="详情备注…" />
        </div>

        <label
          v-if="draft.repeatRule === 'none'"
          class="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input v-model="draft.completed" type="checkbox" class="h-4 w-4" />
          已完成
        </label>
      </div>

      <SheetFooter class="flex-row justify-between border-t pt-4">
        <Button variant="destructive" @click="remove">删除</Button>
        <div class="flex gap-2">
          <Button variant="outline" @click="open = false">取消</Button>
          <Button @click="save">保存</Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
