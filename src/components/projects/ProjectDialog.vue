<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Project, ProjectColor, ProjectStatus } from "@/lib/project-types";
import { COLOR_META, ICON_CHOICES, STATUS_META } from "@/lib/project-types";

const props = defineProps<{
  open: boolean;
  /** 传入则为编辑，否则为新建 */
  project?: Project | null;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "submit", value: { name: string; description: string; icon: string; color: ProjectColor; status: ProjectStatus; tags: string[] }): void;
}>();

const form = reactive({
  name: "",
  description: "",
  icon: "💡",
  color: "blue" as ProjectColor,
  status: "organizing" as ProjectStatus,
  tagsText: "",
});

const nameInput = ref<HTMLInputElement>();
const validated = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    validated.value = false;
    const p = props.project;
    form.name = p?.name ?? "";
    form.description = p?.description ?? "";
    form.icon = p?.icon ?? "💡";
    form.color = p?.color ?? "blue";
    form.status = p?.status ?? "organizing";
    form.tagsText = p?.tags.join(" / ") ?? "";
    setTimeout(() => nameInput.value?.focus(), 50);
  },
);

function submit() {
  validated.value = true;
  if (!form.name.trim()) return;
  emit("submit", {
    name: form.name.trim(),
    description: form.description.trim(),
    icon: form.icon,
    color: form.color,
    status: form.status,
    tags: form.tagsText
      .split(/[/,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 6),
  });
  emit("update:open", false);
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-lg gap-0 p-5">
      <DialogHeader>
        <DialogTitle>{{ project ? "编辑项目" : "新建项目" }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ project ? "修改项目的基本信息" : "填写项目的基本信息，之后可以随时修改" }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 space-y-4">
        <div class="flex gap-3">
          <!-- 图标预览与选择 -->
          <div class="flex flex-col items-center gap-2">
            <div
              class="wpb-icon-tile"
              :style="{ width: '52px', height: '52px', fontSize: '26px', background: COLOR_META[form.color].soft }"
            >
              {{ form.icon }}
            </div>
          </div>
          <div class="min-w-0 flex-1 space-y-3">
            <label class="block">
              <span class="wpb-field-label">项目名称</span>
              <input
                ref="nameInput"
                v-model="form.name"
                class="wpb-input mt-1"
                placeholder="例如：智能笔记助手"
                maxlength="30"
                :aria-invalid="validated && !form.name.trim()"
                @keydown.enter.prevent="submit"
              />
              <span v-if="validated && !form.name.trim()" class="mt-1 block text-[11px] text-destructive">
                请填写项目名称
              </span>
            </label>
            <label class="block">
              <span class="wpb-field-label">一句话介绍</span>
              <input
                v-model="form.description"
                class="wpb-input mt-1"
                placeholder="这个项目要做什么？"
                maxlength="80"
              />
            </label>
          </div>
        </div>

        <div>
          <span class="wpb-field-label">图标</span>
          <div class="mt-1.5 flex flex-wrap gap-1">
            <button
              v-for="icon in ICON_CHOICES"
              :key="icon"
              type="button"
              class="wpb-icon-choice"
              :class="form.icon === icon ? 'is-picked' : ''"
              :aria-pressed="form.icon === icon"
              @click="form.icon = icon"
            >
              {{ icon }}
            </button>
          </div>
        </div>

        <div class="flex gap-6">
          <div>
            <span class="wpb-field-label">底色</span>
            <div class="mt-1.5 flex gap-2">
              <button
                v-for="(meta, key) in COLOR_META"
                :key="key"
                type="button"
                class="wpb-color-choice"
                :class="form.color === key ? 'is-picked' : ''"
                :style="{ background: meta.soft }"
                :title="meta.label"
                :aria-pressed="form.color === key"
                :aria-label="meta.label"
                @click="form.color = key"
              >
                <span class="h-3 w-3 rounded-full" :style="{ background: meta.dot }" />
              </button>
            </div>
          </div>
          <div>
            <span class="wpb-field-label">状态</span>
            <div class="wpb-seg mt-1.5">
              <button
                v-for="(meta, key) in STATUS_META"
                :key="key"
                type="button"
                :class="form.status === key ? 'is-active' : ''"
                :aria-pressed="form.status === key"
                @click="form.status = key"
              >
                {{ meta.label }}
              </button>
            </div>
          </div>
        </div>

        <label class="block">
          <span class="wpb-field-label">标签</span>
          <input
            v-model="form.tagsText"
            class="wpb-input mt-1"
            placeholder="用空格或 / 分隔，例如：AI 效率工具"
          />
        </label>
      </div>

      <DialogFooter class="mt-5">
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="submit">{{ project ? "保存修改" : "创建项目" }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
