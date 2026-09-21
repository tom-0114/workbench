<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { RepeatRule } from "@/lib/types";
import { parseQuickAdd } from "@/lib/nl-parse";

const props = withDefaults(defineProps<{ date: string; x: number; y: number; busy?: boolean }>(), {
  busy: false,
});
const emit = defineEmits<{
  (e: "create", title: string, applied?: { dueDate?: string; repeatRule?: RepeatRule }): void;
  (e: "close"): void;
}>();

const title = ref("");
const inputEl = ref<HTMLInputElement>();
const cardEl = ref<HTMLFormElement>();

/** 移动端判定只取挂载时刻，弹层生命周期内视口不会跨断点变化 */
const isMobileViewport = window.innerWidth < 768;

/** 自然语言解析（明天/周五/每天…），实时预览 */
const parsed = computed(() => parseQuickAdd(title.value));
const hasApplied = computed(() => !!(parsed.value.dueDate || parsed.value.repeatRule));

/** 弹层位置：桌面跟随点击；移动端贴底（避让底部导航与安全区），像迷你抽屉 */
const style = computed(() => {
  if (isMobileViewport) {
    return {
      left: "12px",
      right: "12px",
      width: "auto",
      top: "auto",
      bottom: "calc(env(safe-area-inset-bottom) + 72px)",
    };
  }
  return {
    left: Math.max(8, Math.min(props.x, window.innerWidth - 272)) + "px",
    top: Math.max(8, Math.min(props.y + 6, window.innerHeight - 126)) + "px",
    width: "256px",
  };
});

function submit() {
  if (props.busy) return;
  const t = parsed.value.title.trim();
  if (!t) return;
  emit(
    "create",
    t,
    hasApplied.value
      ? { dueDate: parsed.value.dueDate, repeatRule: parsed.value.repeatRule }
      : undefined,
  );
}

/** 点击弹层外部关闭；延迟注册，避免吃掉打开弹层的那次点击 */
function onDocPointerDown(e: PointerEvent) {
  if (cardEl.value && !cardEl.value.contains(e.target as Node)) emit("close");
}

let listenerTimer: ReturnType<typeof setTimeout>;
onMounted(() => {
  inputEl.value?.focus();
  listenerTimer = setTimeout(() => {
    document.addEventListener("pointerdown", onDocPointerDown, true);
  }, 0);
});
onBeforeUnmount(() => {
  clearTimeout(listenerTimer);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
});
</script>

<template>
  <Teleport to="body">
    <form
      ref="cardEl"
      class="wb-quick-add fixed z-50 rounded-[12px] border bg-popover p-2 animate-in fade-in duration-150"
      :class="isMobileViewport ? 'slide-in-from-bottom-2' : 'zoom-in-95'"
      :style="{ ...style, boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)' }"
      @submit.prevent="submit"
    >
      <div class="mb-1.5 flex items-baseline justify-between gap-2 px-1 text-[11px]">
        <span style="color: var(--text-tertiary)">添加到 {{ props.date }}</span>
        <span v-if="hasApplied" style="color: var(--accent-color)">{{ parsed.hint }}</span>
      </div>
      <div class="flex gap-2">
        <input
          ref="inputEl"
          v-model="title"
          class="min-w-0 flex-1 rounded-[8px] border bg-background px-2.5 py-1.5 text-[13px] outline-none transition-shadow duration-150 focus:ring-2 focus:ring-ring/60"
          placeholder="输入事项，支持 明天 / 周五 / 每天"
          :disabled="busy"
          @keydown.esc="emit('close')"
        />
        <button
          type="submit"
          class="min-h-9 rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground"
          :disabled="busy || !parsed.title.trim()"
        >
          {{ busy ? "保存中" : "保存" }}
        </button>
      </div>
      <div
        v-if="hasApplied"
        class="mt-1 px-1 text-[11px]"
        style="color: var(--text-tertiary)"
      >
        将创建到 {{ parsed.dueDate ?? props.date }}<template v-if="parsed.repeatRule"> · {{ parsed.hint }}</template>
      </div>
    </form>
  </Teleport>
</template>
