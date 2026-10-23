<script setup lang="ts">
import { computed, ref } from "vue";
import dayjs from "dayjs";
import { Bell, Flame, LoaderCircle, X } from "lucide-vue-next";
import type { Task } from "@/lib/types";
import { PRIORITY_LABELS, REPEAT_LABELS } from "@/lib/types";
import { useTaskStore } from "@/stores/tasks";
import { pushState } from "@/lib/push";
import { REMIND_OFFSET_MAX, REMIND_OFFSET_MIN, reminderBase, reminderTime } from "@/lib/reminders";
import { fmtDate } from "@/lib/date";
import { completionKey, expandOccurrences } from "@/lib/recurrence";
import { HOLIDAY_DATA_LAST_YEAR } from "@/lib/cn-holidays";
import { lunarText } from "@/lib/lunar";
import DateField from "@/components/DateField.vue";
import TimeField from "@/components/TimeField.vue";
import SubtaskList from "@/components/SubtaskList.vue";
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
  /** 打开的是哪一天的实例：重复任务的子任务按天勾选 */
  occurrenceDate?: string;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "remove"): void;
  (e: "cancel"): void;
}>();

const tagsInput = defineModel<string>("tagsInput", { required: true });

const priorityOptions: (Task["priority"])[] = [0, 1, 2, 3];
const store = useTaskStore();

const pad = (n: number) => String(n).padStart(2, "0");
// 提醒 = 日期 + 时间，存成相对任务当天 09:00 的提前量，重复任务每一次按同样的间隔提醒
const fire = computed(() =>
  props.draft.dueDate && props.draft.remindOffset != null
    ? reminderTime(props.draft.dueDate, props.draft.dueTime, props.draft.remindOffset)
    : null,
);
function setFire(date: string, time: string) {
  if (!date || !time || !props.draft.dueDate) return;
  const base = reminderBase(props.draft.dueDate, props.draft.dueTime).getTime();
  const offset = Math.round((base - new Date(`${date}T${time}`).getTime()) / 60_000);
  props.draft.remindOffset = Math.min(REMIND_OFFSET_MAX, Math.max(REMIND_OFFSET_MIN, offset));
}
const remindDate = computed({
  get: () => (fire.value ? fmtDate(fire.value) : ""),
  set: (value: string) => setFire(value, remindTime.value),
});
const remindTime = computed({
  get: () => (fire.value ? `${pad(fire.value.getHours())}:${pad(fire.value.getMinutes())}` : ""),
  set: (value: string) => setFire(remindDate.value, value),
});
// 默认任务当天 09:00；今天已经过了 9 点就取下一个整点
function addReminder() {
  if (!props.draft.dueDate) return;
  const now = new Date();
  const nextHour = now.getHours() + 1;
  const useNextHour = props.draft.dueDate === fmtDate(now) && now.getHours() >= 9 && nextHour <= 23;
  setFire(props.draft.dueDate, useNextHour ? `${pad(nextHour)}:00` : "09:00");
}
const remindHint = computed(() => {
  if (!props.draft.dueDate) return "先选日期，才能设置提醒";
  if (!fire.value) return "";
  if (fire.value.getTime() < Date.now()) return "这个时间已经过去，不会再提醒";
  return props.draft.repeatRule === "none" ? "" : "重复任务的每一次都按同样的间隔提醒";
});
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
const repeatUntil = computed({
  get: () => props.draft.repeatUntil ?? "",
  set: (value: string) => (props.draft.repeatUntil = value),
});
const untilPresets = computed(() => {
  const start = dayjs(props.draft.dueDate);
  return [
    { label: "本月底", value: start.endOf("month") },
    { label: "3 个月后", value: start.add(3, "month") },
    { label: "今年底", value: start.endOf("year") },
  ]
    .filter((p) => !p.value.isSame(start, "day"))
    .map((p) => ({ label: p.label, value: p.value.format("YYYY-MM-DD") }));
});
const untilHint = computed(() => {
  const { dueDate } = props.draft;
  const until = repeatUntil.value;
  if (!until || !dueDate) return "";
  if (until < dueDate) return "截止日期不能早于开始日期";
  const count = expandOccurrences([{ ...props.draft, dateOverrides: {} }], new Set(), dueDate, until).length;
  return `到这天为止，共 ${count} 次`;
});

// 节假日数据只到已公布的年份，之后的工作日暂按周一到周五
const workdayHint = computed(() => {
  const { repeatRule, dueDate } = props.draft;
  if (repeatRule !== "workday" || !dueDate) return "";
  const lastYear = Number((repeatUntil.value || "9999").slice(0, 4));
  if (lastYear <= HOLIDAY_DATA_LAST_YEAR) return "跳过法定节假日，调休上班日照常";
  return `跳过法定节假日，调休上班日照常；${HOLIDAY_DATA_LAST_YEAR + 1} 年起的安排还没公布，暂按周一到周五`;
});

// 单次完成：按打开的那一天打卡，即时保存，不影响系列里的其他日子
const savedTask = computed(() => store.tasks.find((t) => t.id === props.draft.id));
const canCompleteOnce = computed(
  () => !!props.occurrenceDate && props.draft.repeatRule !== "none" && !!savedTask.value && savedTask.value.repeatRule !== "none",
);
const occurrenceDone = computed(() => !!props.occurrenceDate && store.completions.has(completionKey(props.draft.id, props.occurrenceDate)));
const occurrenceLabel = computed(() => (props.occurrenceDate ? `${dayjs(props.occurrenceDate).format("M月D日")}（${lunarText(props.occurrenceDate)}）` : ""));
const togglingOnce = ref(false);
async function toggleOnce() {
  if (!savedTask.value || !props.occurrenceDate || togglingOnce.value) return;
  togglingOnce.value = true;
  try {
    await store.toggleOccurrence({ task: savedTask.value, date: props.occurrenceDate, completed: occurrenceDone.value, isVirtual: true });
  } catch {
    // Store 显示错误提示
  } finally {
    togglingOnce.value = false;
  }
}

const completedLabel = computed(() => {
  const at = props.draft.completed ? props.draft.completedAt : null;
  if (!at) return "";
  const d = new Date(at);
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${d.getMonth() + 1}月${d.getDate()}日（${lunarText(fmtDate(d))}）${time}`;
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
  "workday",
  "weekly",
  "monthly",
  "yearly",
  "yearly-lunar",
];
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- 滚动放在外层 div：Chrome 里 fieldset 自己做滚动容器时溢出内容不裁剪，会压到底部按钮上 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
    <fieldset :disabled="saving || removing" class="flex min-w-0 flex-col gap-4">
      <div class="wb-form-field">
        <Label for="wb-title">标题</Label>
        <Input id="wb-title" v-model="draft.title" placeholder="事项标题" @keydown.enter="onEnterKey" />
      </div>

      <p v-if="stats" class="wb-task-stats">
        <Flame aria-hidden="true" />
        <span v-if="stats.streak >= 2">已连续完成 {{ stats.streak }} 次 · </span>累计完成 {{ stats.total }} 次
      </p>

      <div class="wb-form-field">
        <Label for="wb-date">日期</Label>
        <DateField id="wb-date" v-model="draft.dueDate" label="日期" placeholder="不设日期（放进收集箱）" />
      </div>

      <div class="wb-form-field">
        <Label :for="draft.remindOffset != null ? 'wb-remind-date' : undefined">提醒</Label>
        <div v-if="draft.dueDate && draft.remindOffset != null" class="wb-remind-row">
          <DateField id="wb-remind-date" v-model="remindDate" label="提醒日期" :clearable="false" :presets="false" />
          <TimeField id="wb-remind-time" v-model="remindTime" label="提醒时间" />
          <button type="button" class="wb-control" aria-label="取消提醒" title="取消提醒" @click="draft.remindOffset = null">
            <X aria-hidden="true" />
          </button>
        </div>
        <button v-else type="button" class="wb-remind-add" :disabled="!draft.dueDate" @click="addReminder">
          <Bell aria-hidden="true" />添加提醒
        </button>
        <p v-if="remindHint" class="text-[13px]" style="color: var(--text-secondary)">{{ remindHint }}</p>
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

      <div v-if="draft.repeatRule !== 'none' && draft.dueDate" class="wb-form-field">
        <Label for="wb-repeat-until">重复至</Label>
        <DateField
          id="wb-repeat-until"
          v-model="repeatUntil"
          label="重复截止日期"
          placeholder="一直重复"
          :min="draft.dueDate"
          :presets="untilPresets"
        />
        <p v-if="untilHint" class="text-[13px]" style="color: var(--text-secondary)">{{ untilHint }}</p>
        <p v-if="workdayHint" class="text-[13px]" style="color: var(--text-secondary)">{{ workdayHint }}</p>
      </div>

      <div v-if="!draft.parentId" class="wb-form-field">
        <Label>子任务<span class="wb-label-hint">改动即时保存</span></Label>
        <SubtaskList :parent-id="draft.id" :date="occurrenceDate || draft.dueDate" editable />
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
      <label v-else-if="canCompleteOnce" class="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" class="h-4 w-4" :checked="occurrenceDone" :disabled="togglingOnce" @change="toggleOnce" />
        {{ occurrenceLabel }} 这一次已完成
        <span class="text-[13px]" style="color: var(--text-secondary)">· 只影响这一天，即时保存</span>
      </label>
    </fieldset>
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
