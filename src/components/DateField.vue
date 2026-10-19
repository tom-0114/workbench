<script setup lang="ts">
import { computed } from "vue";
import dayjs from "dayjs";
import { DatePicker } from "ant-design-vue";
import { useMediaQuery } from "@vueuse/core";
import { useTaskStore } from "@/stores/tasks";

withDefaults(
  defineProps<{ id?: string; label: string; disabled?: boolean; placeholder?: string; clearable?: boolean; presets?: boolean }>(),
  { placeholder: "选择日期", clearable: true, presets: true },
);
const model = defineModel<string>({ required: true });
const store = useTaskStore();
// 手机上点开不弹键盘，直接在面板里选
const touch = useMediaQuery("(pointer: coarse)");

const presetList = computed(() => {
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
    :input-read-only="touch"
    :show-today="false"
  />
</template>
