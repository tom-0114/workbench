<script setup lang="ts">
import { computed } from "vue";
import dayjs from "dayjs";
import { DatePicker } from "ant-design-vue";
import { useMediaQuery } from "@vueuse/core";
import { useTaskStore } from "@/stores/tasks";
import { CalendarDays } from "lucide-vue-next";
import { lunarCellText, lunarText } from "@/lib/lunar";

const props = withDefaults(
  defineProps<{
    id?: string; label: string; disabled?: boolean; placeholder?: string; clearable?: boolean;
    /** false 不显示快捷项；传数组则替换默认的“今天/明天…” */
    presets?: boolean | { label: string; value: string }[];
    /** 早于该日期（YYYY-MM-DD）的日子不可选 */
    min?: string;
  }>(),
  { placeholder: "选择日期", clearable: true, presets: true },
);
const model = defineModel<string>({ required: true });
const store = useTaskStore();
// 手机上点开不弹键盘，直接在面板里选
const touch = useMediaQuery("(pointer: coarse)");

const presetList = computed(() => {
  if (Array.isArray(props.presets)) return props.presets.map((p) => ({ label: p.label, value: dayjs(p.value) }));
  const today = dayjs(store.currentDate);
  const nextMonday = today.add(((8 - today.day()) % 7) || 7, "day");
  return [
    { label: "今天", value: today },
    { label: "明天", value: today.add(1, "day") },
    { label: "后天", value: today.add(2, "day") },
    { label: "下周一", value: nextMonday },
  ];
});
// 清空时组件给 null，外部统一用空串
const disabledDate = (d: dayjs.Dayjs) => !!props.min && d.format("YYYY-MM-DD") < props.min;
const value = computed({
  get: () => model.value || undefined,
  set: (v: string | null | undefined) => (model.value = v ?? ""),
});
</script>

<template>
  <DatePicker
    :id="id"
    v-model:value="value"
    class="wb-picker"
    popup-class-name="wb-picker-pop"
    value-format="YYYY-MM-DD"
    :format="touch ? 'YYYY/M/D ddd' : 'YYYY年M月D日 ddd'"
    :placeholder="placeholder"
    :aria-label="label"
    :disabled="disabled"
    :allow-clear="clearable"
    :presets="presets ? presetList : undefined"
    :disabled-date="min ? disabledDate : undefined"
    :input-read-only="touch"
    :show-today="false"
  >
    <!-- 农历放在后缀里：format 写成函数会让输入框无法手输日期 -->
    <template #suffixIcon>
      <span v-if="model" class="wb-picker-lunar">{{ lunarText(model) }}</span>
      <CalendarDays class="wb-picker-icon" aria-hidden="true" />
    </template>
    <template #dateRender="{ current }">
      <div class="ant-picker-cell-inner wb-picker-cell">
        <span>{{ current.date() }}</span>
        <small :class="{ 'is-special': lunarCellText(current.format('YYYY-MM-DD')).special }">
          {{ lunarCellText(current.format("YYYY-MM-DD")).text }}
        </small>
      </div>
    </template>
  </DatePicker>
</template>
