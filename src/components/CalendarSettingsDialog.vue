<script setup lang="ts">
import { ref, watch } from "vue";
import { LoaderCircle, Plus, Trash2 } from "lucide-vue-next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DateField from "@/components/DateField.vue";
import { loadSchoolBreaks, saveSchoolBreaks, schoolBreaks, type SchoolBreak } from "@/lib/school-breaks";
import { calendarPrefs, loadCalendarPrefs, saveCalendarPrefs, type CalendarPrefs } from "@/lib/calendar-prefs";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const prefs = ref<CalendarPrefs>({ ...calendarPrefs });
const toggles: [key: "lunar" | "holidayMarks" | "showCompleted" | "yearTasks", label: string][] = [
  ["lunar", "显示农历、传统节日和节气"],
  ["holidayMarks", "显示法定节假日（休/班）"],
  ["showCompleted", "显示已完成的任务"],
  ["yearTasks", "年视图里显示任务"],
];
const enabled = ref(true);
const rows = ref<SchoolBreak[]>([]);
const saving = ref(false);
const error = ref("");

// 每次打开都从后端取最新的，编辑的是副本，点保存才生效
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    error.value = "";
    await Promise.all([loadSchoolBreaks(), loadCalendarPrefs()]);
    prefs.value = { ...calendarPrefs };
    enabled.value = schoolBreaks.enabled;
    rows.value = schoolBreaks.breaks.map((b) => ({ ...b }));
  },
);

function addRow() {
  const last = rows.value[rows.value.length - 1];
  rows.value.push({ name: last?.name === "寒假" ? "暑假" : "寒假", start: "", end: "" });
}

async function save() {
  const breaks = rows.value.map((r) => ({ ...r, name: r.name.trim() }));
  const bad = breaks.find((b) => !b.name || !b.start || (b.end && b.end < b.start));
  if (bad) {
    error.value = !bad.name ? "请填写假期名称" : !bad.start ? `「${bad.name}」还没选开始日期` : `「${bad.name}」的结束日期早于开始日期`;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await Promise.all([saveCalendarPrefs(prefs.value), saveSchoolBreaks({ enabled: enabled.value, breaks })]);
    emit("update:open", false);
  } catch {
    error.value = "没有保存成功，请检查网络后重试";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[min(720px,calc(100dvh-32px))] flex-col sm:max-w-[680px] gap-4 p-5">
      <DialogHeader>
        <DialogTitle>日历设置</DialogTitle>
        <DialogDescription>这些设置只影响日历页，换设备登录同一账号也一样。</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto">
        <section class="wb-cal-section" aria-labelledby="wb-cal-display">
          <h3 id="wb-cal-display">显示</h3>
          <label v-for="[key, label] in toggles" :key="key" class="wb-cal-toggle">
            <input v-model="prefs[key]" type="checkbox" class="h-4 w-4" />{{ label }}
          </label>
          <div class="wb-cal-toggle" role="radiogroup" aria-label="每周从哪天开始">
            <span>每周从</span>
            <label><input v-model="prefs.firstDay" type="radio" :value="1" />周一</label>
            <label><input v-model="prefs.firstDay" type="radio" :value="0" />周日</label>
            <span>开始</span>
          </div>
        </section>

        <section class="wb-cal-section" aria-labelledby="wb-cal-breaks">
          <h3 id="wb-cal-breaks">幼儿园寒暑假</h3>
          <label class="wb-cal-toggle">
            <input v-model="enabled" type="checkbox" class="h-4 w-4" />在日历上每天打“寒假/暑假”标签
          </label>
          <div class="wb-break-rows" :class="{ 'opacity-50': !enabled }">
            <div v-for="(row, i) in rows" :key="i" class="wb-break-row">
              <Input v-model="row.name" maxlength="10" placeholder="名称" :aria-label="`第 ${i + 1} 个假期的名称`" />
              <DateField v-model="row.start" :label="`${row.name || '假期'}开始日期`" placeholder="开始日期" :clearable="false" :presets="false" />
              <DateField v-model="row.end" :label="`${row.name || '假期'}结束日期`" placeholder="结束日期待定" :min="row.start" :presets="false" />
              <button type="button" class="wb-control" :aria-label="`删除${row.name || '这个假期'}`" title="删除" @click="rows.splice(i, 1)">
                <Trash2 aria-hidden="true" />
              </button>
            </div>
            <p v-if="!rows.length" class="text-sm" style="color: var(--text-tertiary)">还没有假期，点下面添加。</p>
          </div>
          <Button variant="outline" size="sm" class="self-start" @click="addRow"><Plus data-icon="inline-start" aria-hidden="true" />添加假期</Button>
          <p class="text-[12px]" style="color: var(--text-tertiary)">
            结束日期未定时只标开始那天。苏州市中小学和幼儿园用同一份校历，新学期校历发布后在这里补上。
          </p>
        </section>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="saving" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="saving" @click="save">
          <LoaderCircle v-if="saving" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
          保存
        </Button>
      </div>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </DialogContent>
  </Dialog>
</template>
