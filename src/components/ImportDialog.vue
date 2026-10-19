<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Download, FileJson, LoaderCircle, TriangleAlert } from "lucide-vue-next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/stores/tasks";
import { downloadTaskBackup, parseTaskBackup, type TaskBackup } from "@/lib/backup";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();
const store = useTaskStore();

const fileInput = ref<HTMLInputElement>();
const backup = ref<TaskBackup | null>(null);
const fileName = ref("");
const error = ref("");
const busy = ref(false);
const done = ref("");

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    backup.value = null;
    fileName.value = "";
    error.value = "";
    done.value = "";
  },
);

const summary = computed(() => {
  const b = backup.value;
  if (!b) return null;
  const active = b.tasks.filter((t) => !t.deletedAt).length;
  return {
    active,
    deleted: b.tasks.length - active,
    completions: b.completions.length,
    exportedAt: Number.isNaN(Date.parse(b.exportedAt))
      ? "未知"
      : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(b.exportedAt)),
  };
});

async function pick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  backup.value = null;
  done.value = "";
  fileName.value = file.name;
  const result = parseTaskBackup(await file.text());
  if (typeof result === "string") error.value = result;
  else {
    error.value = "";
    backup.value = result;
  }
}

async function confirmImport() {
  if (!backup.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await store.importBackup(backup.value);
    done.value = `已恢复 ${result.tasks} 个任务、${result.completions} 条打卡记录`;
    backup.value = null;
  } catch {
    error.value = "恢复失败，当前数据没有改动，请检查网络后重试";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="!busy && emit('update:open', $event)">
    <DialogContent class="max-w-md gap-4 p-5">
      <DialogHeader>
        <DialogTitle>导入备份</DialogTitle>
        <DialogDescription>用之前导出的 JSON 文件恢复任务、回收站和打卡记录。</DialogDescription>
      </DialogHeader>

      <input ref="fileInput" type="file" accept="application/json,.json" class="sr-only" aria-label="选择备份文件" @change="pick" />
      <Button variant="outline" class="justify-start" :disabled="busy" @click="fileInput?.click()">
        <FileJson data-icon="inline-start" aria-hidden="true" />
        {{ fileName || "选择备份文件" }}
      </Button>

      <div v-if="summary" class="wb-import-summary">
        <p>备份时间：{{ summary.exportedAt }}</p>
        <p>{{ summary.active }} 个任务<span v-if="summary.deleted">、回收站 {{ summary.deleted }} 个</span>、{{ summary.completions }} 条打卡</p>
        <p class="wb-import-warning" role="note">
          <TriangleAlert aria-hidden="true" />
          会用备份<strong>替换</strong>当前账号的全部任务（现有 {{ store.tasks.length }} 个），无法撤销。
        </p>
        <button type="button" class="wb-import-export" @click="downloadTaskBackup(store.tasks, store.completions)">
          <Download aria-hidden="true" />先导出当前数据
        </button>
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <p v-if="done" class="text-sm" role="status" style="color: var(--text-secondary)">{{ done }}</p>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">{{ done ? "完成" : "取消" }}</Button>
        <Button v-if="!done" variant="destructive" :disabled="!backup || busy" @click="confirmImport">
          <LoaderCircle v-if="busy" data-icon="inline-start" class="animate-spin" aria-hidden="true" />
          {{ busy ? "恢复中" : "替换并恢复" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
