<script setup lang="ts">
import { computed, watch } from "vue";
import { BellOff, BellRing, LoaderCircle, Send, Smartphone } from "lucide-vue-next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, pushState, refreshPushStatus, sendTestPush } from "@/lib/push";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    pushState.message = "";
    void refreshPushStatus();
  },
);

const copy = computed(() => ({
  on: "此设备会收到任务提醒。每台手机、电脑需要分别开启。",
  off: "开启后，设了提醒的任务到点会推送到这台设备，不用打开页面。",
  denied: "浏览器拦截了本站的通知。请在浏览器的网站设置里把通知改为“允许”，再回来开启。",
  "needs-install": "iPhone 只有从主屏幕打开时才能收通知：在 Safari 点“分享 → 添加到主屏幕”，然后从主屏幕图标打开，再来这里开启。",
  "server-off": "服务器还没配置推送密钥（VAPID），暂时无法开启。",
  unsupported: "这个浏览器不支持网页通知，可以换用 Chrome、Edge 或 Safari。",
  unknown: "正在检查此设备的通知状态…",
}[pushState.status]));
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-md gap-4 p-5">
      <DialogHeader>
        <DialogTitle>提醒通知</DialogTitle>
        <DialogDescription>{{ copy }}</DialogDescription>
      </DialogHeader>

      <div class="wb-notify-state" :data-status="pushState.status">
        <BellRing v-if="pushState.status === 'on'" aria-hidden="true" />
        <Smartphone v-else-if="pushState.status === 'needs-install'" aria-hidden="true" />
        <BellOff v-else aria-hidden="true" />
        <span>{{ pushState.status === "on" ? "此设备已开启" : "此设备未开启" }}</span>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button v-if="pushState.status === 'off'" :disabled="pushState.busy" @click="enablePush">
          <LoaderCircle v-if="pushState.busy" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
          在此设备开启
        </Button>
        <template v-if="pushState.status === 'on'">
          <Button variant="outline" :disabled="pushState.busy" @click="sendTestPush">
            <Send data-icon="inline-start" aria-hidden="true" />发送测试通知
          </Button>
          <Button variant="ghost" :disabled="pushState.busy" @click="disablePush">关闭</Button>
        </template>
      </div>
      <p v-if="pushState.message" class="text-sm" role="status" style="color: var(--text-secondary)">{{ pushState.message }}</p>
      <p class="text-[12px]" style="color: var(--text-tertiary)">
        提醒在任务详情里设置。全天任务在当天 09:00 提醒；超过 35 天没打开过应用，更远的提醒会暂停，打开一次即恢复。
      </p>
    </DialogContent>
  </Dialog>
</template>
