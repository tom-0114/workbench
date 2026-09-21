<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ArrowRight, CalendarCheck2, LoaderCircle } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const props = defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{
  (event: "submit", credentials: { username: string; password: string }): void;
}>();

const username = ref("admin");
const password = ref("");
const errorEl = ref<HTMLElement>();

const todayLabel = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date()),
);
const dayNumber = computed(() => String(new Date().getDate()).padStart(2, "0"));

watch(
  () => props.error,
  async (value) => {
    if (!value) return;
    await nextTick();
    errorEl.value?.focus();
  },
);

function submit() {
  if (props.busy) return;
  emit("submit", { username: username.value.trim(), password: password.value });
}
</script>

<template>
  <main class="wb-login-shell">
    <section class="wb-login-panel" aria-labelledby="wb-login-title">
      <div class="wb-login-date" aria-hidden="true">
        <span>{{ dayNumber }}</span>
        <i />
      </div>

      <div class="wb-login-heading">
        <span class="wb-login-mark"><CalendarCheck2 aria-hidden="true" /></span>
        <div>
          <p>{{ todayLabel }}</p>
          <h1 id="wb-login-title">回到工作台</h1>
        </div>
      </div>

      <p class="wb-login-intro">你的任务、日历和收集箱只对登录用户开放。</p>

      <form class="wb-login-form" :aria-busy="busy" @submit.prevent="submit">
        <div class="wb-login-field">
          <Label for="wb-username">账号</Label>
          <Input
            id="wb-username"
            v-model="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            :disabled="busy"
            :aria-invalid="!!error"
          />
        </div>

        <div class="wb-login-field">
          <Label for="wb-password">密码</Label>
          <Input
            id="wb-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            autofocus
            :disabled="busy"
            :aria-invalid="!!error"
            :aria-describedby="error ? 'wb-login-error' : undefined"
          />
        </div>

        <p
          v-if="error"
          id="wb-login-error"
          ref="errorEl"
          class="wb-login-error"
          role="alert"
          tabindex="-1"
        >
          <span aria-hidden="true">!</span>
          {{ error }}
        </p>

        <Button type="submit" size="lg" class="w-full" :disabled="busy || !username || !password">
          <LoaderCircle v-if="busy" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
          <template v-if="busy">正在验证</template>
          <template v-else>
            进入工作台
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </template>
        </Button>
      </form>

      <p class="wb-login-footnote">会话会在此设备保留 7 天</p>
    </section>
  </main>
</template>
