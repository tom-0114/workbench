<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ date: string; x: number; y: number }>();
const emit = defineEmits<{ (e: "create", title: string): void; (e: "close"): void }>();

const title = ref("");
const inputEl = ref<HTMLInputElement>();
const cardEl = ref<HTMLDivElement>();

/** 弹层位置：不超出视口 */
const style = computed(() => ({
  left: Math.min(props.x, window.innerWidth - 280) + "px",
  top: Math.min(props.y + 6, window.innerHeight - 90) + "px",
}));

function submit() {
  const t = title.value.trim();
  if (t) emit("create", t);
  emit("close");
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
    <div
      ref="cardEl"
      class="fixed z-50 w-64 rounded-[12px] border bg-popover p-2"
      :style="{ ...style, boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)' }"
    >
      <div class="mb-1.5 px-1 text-[11px]" style="color: var(--text-tertiary)">
        添加到 {{ props.date }}
      </div>
      <input
        ref="inputEl"
        v-model="title"
        class="w-full rounded-[8px] border bg-background px-2.5 py-1.5 text-[13px] outline-none transition-shadow duration-150 focus:ring-2 focus:ring-ring/60"
        placeholder="输入事项，回车保存"
        @keydown.enter.prevent="submit"
        @keydown.esc="emit('close')"
      />
    </div>
  </Teleport>
</template>
