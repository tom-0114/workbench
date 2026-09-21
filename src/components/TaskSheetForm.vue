<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next";
import type { Task } from "@/lib/types";
import { PRIORITY_LABELS, REPEAT_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

defineProps<{
  draft: Task;
  saving: boolean;
  removing: boolean;
  confirmingDelete: boolean;
  actionError: string;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "remove"): void;
  (e: "cancel"): void;
}>();

const tagsInput = defineModel<string>("tagsInput", { required: true });

const priorityOptions: (Task["priority"])[] = [0, 1, 2, 3];
const repeatOptions: Task["repeatRule"][] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "yearly-lunar",
];
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden">
    <div class="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
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
              <SelectGroup>
                <SelectItem v-for="p in priorityOptions" :key="p" :value="p">
                  {{ PRIORITY_LABELS[p] }}
                </SelectItem>
              </SelectGroup>
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
              <SelectGroup>
                <SelectItem v-for="r in repeatOptions" :key="r" :value="r">
                  {{ REPEAT_LABELS[r] }}
                </SelectItem>
              </SelectGroup>
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
        <Textarea id="wb-notes" v-model="draft.notes" rows="4" placeholder="详情备注…" />
      </div>

      <label
        v-if="draft.repeatRule === 'none'"
        class="flex cursor-pointer items-center gap-2 text-sm"
      >
        <input v-model="draft.completed" type="checkbox" class="h-4 w-4" />
        已完成
      </label>
    </div>

    <div
      class="flex flex-row items-center justify-between border-t px-6 py-3"
      style="border-color: var(--border-subtle)"
    >
      <Button variant="destructive" :disabled="saving || removing" @click="emit('remove')">
        <LoaderCircle v-if="removing" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
        {{ removing ? "删除中" : confirmingDelete ? "确认删除" : "删除" }}
      </Button>
      <div class="flex gap-2">
        <Button variant="outline" :disabled="saving || removing" @click="emit('cancel')">取消</Button>
        <Button :disabled="saving || removing || !draft.title.trim()" @click="emit('save')">
          <LoaderCircle v-if="saving" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
          {{ saving ? "保存中" : "保存" }}
        </Button>
      </div>
    </div>
    <p v-if="actionError" class="px-6 pb-3 text-sm text-destructive" role="alert">
      {{ actionError }}
    </p>
  </div>
</template>
