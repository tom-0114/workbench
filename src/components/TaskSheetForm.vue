<script setup lang="ts">
import { computed, watch } from "vue";
import { Flame, LoaderCircle } from "lucide-vue-next";
import type { Task } from "@/lib/types";
import { PRIORITY_LABELS, REMIND_OPTIONS_ALLDAY, REMIND_OPTIONS_TIMED, REPEAT_LABELS } from "@/lib/types";
import { useTaskStore } from "@/stores/tasks";
import { pushState } from "@/lib/push";
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

const props = defineProps<{
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
const store = useTaskStore();

// Select 的值不能为空串，用 "none" 表示不提醒
const remindOptions = computed(() => (props.draft.dueTime ? REMIND_OPTIONS_TIMED : REMIND_OPTIONS_ALLDAY));
const remindValue = computed({
  get: () => (props.draft.remindOffset == null ? "none" : String(props.draft.remindOffset)),
  set: (value: string) => {
    props.draft.remindOffset = value === "none" ? null : Number(value);
  },
});
// 去掉时间后，“提前 15 分钟”这类选项不再适用，退回当天 09:00
watch(
  () => props.draft.dueTime,
  () => {
    const offset = props.draft.remindOffset;
    if (offset != null && !remindOptions.value.some(([v]) => v === offset)) props.draft.remindOffset = 0;
  },
);
const pushHint = computed(() => {
  if (props.draft.remindOffset == null) return "";
  return ({ off: "此设备还没开启通知，可在 设置 → 提醒通知 里开启", denied: "浏览器已拦截通知，需要在浏览器设置里允许", "needs-install": "iPhone 需先添加到主屏幕，并从主屏幕打开后开启通知", "server-off": "服务器还没配置推送，暂时不会发出提醒", unsupported: "这个浏览器不支持通知" } as Record<string, string>)[pushState.status] ?? "";
});

const stats = computed(() => {
  const t = props.draft;
  if (t.repeatRule !== "none") {
    const total = [...store.completions].filter((key) => key.startsWith(`${t.id}:`)).length;
    return total ? { streak: store.streaks.get(t.id) ?? 0, total } : null;
  }
  return null;
});
const completedLabel = computed(() => {
  const at = props.draft.completed ? props.draft.completedAt : null;
  if (!at) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
});

// Enter 直接保存；Shift+Enter 在备注里换行；输入法选词中的 Enter 不触发
function onEnterKey(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey) return;
  event.preventDefault();
  emit("save");
}
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
    <fieldset :disabled="saving || removing" class="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <div class="wb-form-field">
        <Label for="wb-title">标题</Label>
        <Input id="wb-title" v-model="draft.title" placeholder="事项标题" @keydown.enter="onEnterKey" />
      </div>

      <p v-if="stats" class="wb-task-stats">
        <Flame aria-hidden="true" />
        <span v-if="stats.streak >= 2">已连续完成 {{ stats.streak }} 次 · </span>累计完成 {{ stats.total }} 次
      </p>

      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] gap-3">
        <div class="wb-form-field">
          <Label for="wb-date">日期</Label>
          <Input id="wb-date" v-model="draft.dueDate" type="date" class="min-w-0" />
        </div>
        <div class="wb-form-field">
          <Label for="wb-time">时间</Label>
          <Input id="wb-time" v-model="draft.dueTime" type="time" class="min-w-0" :disabled="!draft.dueDate" />
        </div>
        <p class="col-span-2 -mt-2 text-[13px]" style="color: var(--text-secondary)">
          清空日期将移入收集箱；不填时间为全天
        </p>
      </div>

      <div class="wb-form-field">
        <Label>提醒</Label>
        <!-- 有无时间对应两套选项，Select 会缓存选项文字，切换时重新挂载 -->
        <Select :key="draft.dueTime ? 'timed' : 'allday'" v-model="remindValue" :disabled="saving || removing || !draft.dueDate">
          <SelectTrigger class="w-full" aria-label="提醒">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="none">不提醒</SelectItem>
              <SelectItem v-for="[value, label] in remindOptions" :key="value" :value="String(value)">
                {{ label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p v-if="pushHint" class="text-[13px]" style="color: var(--text-secondary)">{{ pushHint }}</p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="wb-form-field">
          <Label>优先级</Label>
          <Select v-model="draft.priority" :disabled="saving || removing">
            <SelectTrigger class="w-full" aria-label="优先级">
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

        <div class="wb-form-field">
          <Label>重复</Label>
          <Select v-model="draft.repeatRule" :disabled="saving || removing">
            <SelectTrigger class="w-full" aria-label="重复">
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

      <div class="wb-form-field">
        <Label for="wb-tags">标签（逗号分隔）</Label>
        <Input id="wb-tags" v-model="tagsInput" placeholder="如：工作, 学习" @keydown.enter="onEnterKey" />
      </div>

      <div class="wb-form-field">
        <Label for="wb-notes">备注</Label>
        <Textarea
          id="wb-notes"
          v-model="draft.notes"
          rows="4"
          placeholder="添加备注…"
          @keydown.enter="onEnterKey"
        />
      </div>

      <label
        v-if="draft.repeatRule === 'none'"
        class="flex cursor-pointer items-center gap-2 text-sm"
      >
        <input v-model="draft.completed" type="checkbox" class="h-4 w-4" />
        已完成
        <span v-if="completedLabel" class="text-[13px]" style="color: var(--text-secondary)">· {{ completedLabel }}</span>
      </label>
    </fieldset>

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
