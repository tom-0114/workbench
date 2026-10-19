<script setup lang="ts">
import { computed } from "vue";
import { TimePicker } from "ant-design-vue";
import { useMediaQuery } from "@vueuse/core";

withDefaults(defineProps<{ id?: string; label: string; disabled?: boolean; placeholder?: string }>(), {
  placeholder: "选择时间",
});
const model = defineModel<string>({ required: true });
const touch = useMediaQuery("(pointer: coarse)");
const value = computed({
  get: () => model.value || undefined,
  set: (v: string | null | undefined) => (model.value = v ?? ""),
});
// antdv 4 的时间面板要点“确定”才生效、点外面会丢弃；选中时就写回，点外面也不丢
function onSelect(v: { format: (f: string) => string } | string | null) {
  if (v) model.value = typeof v === "string" ? v : v.format("HH:mm");
}
</script>

<template>
  <!-- 电脑上也可以直接输入 14:30 回车 -->
  <TimePicker
    :id="id"
    v-model:value="value"
    class="wb-picker"
    popup-class-name="wb-picker-pop"
    value-format="HH:mm"
    format="HH:mm"
    :placeholder="placeholder"
    :aria-label="label"
    :disabled="disabled"
    :allow-clear="false"
    :show-now="false"
    :input-read-only="touch"
    @select="onSelect"
  />
</template>
