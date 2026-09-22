<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  Check,
  ExternalLink,
  FileText,
  History,
  Lightbulb,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Target,
  Trash2,
  X,
} from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjectStore } from "@/stores/projects";
import type { Project, ProjectRequirement } from "@/lib/project-types";
import { COLOR_META, STATUS_META, fmtTime } from "@/lib/project-types";

const props = defineProps<{ project: Project; isMobile?: boolean }>();
const emit = defineEmits<{
  (e: "edit", project: Project): void;
  (e: "trashed"): void;
  (e: "back"): void;
}>();

const store = useProjectStore();

const TABS = [
  { key: "info", label: "项目详情", icon: FileText },
  { key: "ideas", label: "灵感与需求", icon: Lightbulb },
  { key: "tasks", label: "任务规划", icon: ListChecks },
  { key: "files", label: "文件资料", icon: ExternalLink },
  { key: "activity", label: "项目动态", icon: History },
] as const;
const activeTab = ref<(typeof TABS)[number]["key"]>("ideas");
watch(
  () => props.project.id,
  () => {
    activeTab.value = "ideas";
  },
);

const statusMeta = computed(() => STATUS_META[props.project.status]);
const colorMeta = computed(() => COLOR_META[props.project.color]);

const taskDone = computed(() => props.project.tasks.filter((t) => t.done).length);

/* ---- 标签 ---- */
const addingTag = ref(false);
const tagDraft = ref("");
const tagInput = ref<HTMLInputElement>();

async function startAddTag() {
  addingTag.value = true;
  await nextTick();
  tagInput.value?.focus();
}
function commitTag() {
  const t = tagDraft.value.trim();
  if (t && !props.project.tags.includes(t) && props.project.tags.length < 8) {
    store.updateProject(props.project.id, { tags: [...props.project.tags, t] });
  }
  tagDraft.value = "";
  addingTag.value = false;
}
function removeTag(tag: string) {
  store.updateProject(props.project.id, { tags: props.project.tags.filter((t) => t !== tag) });
}

/* ---- 灵感速记 ---- */
const DRAFT_KEY = "wb.pwb.drafts";
type Drafts = Record<string, { idea?: string; req?: ReqDraft }>;

interface ReqDraft {
  targetUsers: string;
  coreNeeds: string;
  featuresText: string;
  notes: string;
}

function loadDrafts(): Drafts {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveDrafts(drafts: Drafts) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

const ideaDraft = ref("");
const reqDraft = reactive<ReqDraft>({ targetUsers: "", coreNeeds: "", featuresText: "", notes: "" });
const lastSavedAt = ref<string>("");
const justSaved = ref(false);
const ideaAdded = ref(false);
const reqAdded = ref(false);
const IDEA_LIMIT = 500;

function flashAdded(flag: { value: boolean }) {
  flag.value = true;
  window.setTimeout(() => (flag.value = false), 1200);
}

watch(
  () => props.project.id,
  () => {
    const draft = loadDrafts()[props.project.id] ?? {};
    ideaDraft.value = draft.idea ?? "";
    Object.assign(reqDraft, { targetUsers: "", coreNeeds: "", featuresText: "", notes: "" }, draft.req ?? {});
  },
  { immediate: true },
);

function persistDraft() {
  const drafts = loadDrafts();
  drafts[props.project.id] = {
    idea: ideaDraft.value,
    req: {
      targetUsers: reqDraft.targetUsers,
      coreNeeds: reqDraft.coreNeeds,
      featuresText: reqDraft.featuresText,
      notes: reqDraft.notes,
    },
  };
  saveDrafts(drafts);
  lastSavedAt.value = fmtTime(new Date().toISOString());
  justSaved.value = true;
  setTimeout(() => (justSaved.value = false), 1500);
}

const IDEA_CHIPS = ["AI 自动整理笔记", "支持多端同步", "更简洁的编辑体验", "数据可视化报表", "移动端适配", "社区分享"];
function applyChip(chip: string) {
  if (ideaDraft.value.length + chip.length > IDEA_LIMIT) return;
  if (ideaDraft.value && !ideaDraft.value.endsWith("\n")) ideaDraft.value += "\n";
  ideaDraft.value += chip;
}

function addIdea() {
  if (!ideaDraft.value.trim()) return;
  store.addInspiration(props.project.id, ideaDraft.value);
  ideaDraft.value = "";
  persistDraft();
  flashAdded(ideaAdded);
}

function ideaToRequirement(content: string) {
  reqDraft.coreNeeds = content.slice(0, 60);
  persistDraft();
  activeTab.value = "ideas";
}

/* ---- 需求整理 ---- */
function parseFeatures(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function requirementTitle(req: Pick<ProjectRequirement, "coreNeeds">): string {
  const firstLine = req.coreNeeds.split(/\n/)[0].trim();
  if (!firstLine) return "未命名需求";
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine;
}

const reqFormError = ref("");
function addRequirement() {
  if (!reqDraft.coreNeeds.trim()) {
    reqFormError.value = "请先填写核心需求";
    return;
  }
  reqFormError.value = "";
  store.addRequirement(props.project.id, {
    title: requirementTitle({ coreNeeds: reqDraft.coreNeeds }),
    targetUsers: reqDraft.targetUsers.trim(),
    coreNeeds: reqDraft.coreNeeds.trim(),
    features: parseFeatures(reqDraft.featuresText),
    notes: reqDraft.notes.trim(),
  });
  Object.assign(reqDraft, { targetUsers: "", coreNeeds: "", featuresText: "", notes: "" });
  persistDraft();
  flashAdded(reqAdded);
}

const editingReqId = ref<string | null>(null);
const editReq = reactive<ReqDraft>({ targetUsers: "", coreNeeds: "", featuresText: "", notes: "" });

function startEditRequirement(req: ProjectRequirement) {
  editingReqId.value = req.id;
  Object.assign(editReq, {
    targetUsers: req.targetUsers,
    coreNeeds: req.coreNeeds,
    featuresText: req.features.join("\n"),
    notes: req.notes,
  });
}
function saveEditRequirement(req: ProjectRequirement) {
  store.updateRequirement(props.project.id, req.id, {
    targetUsers: editReq.targetUsers.trim(),
    coreNeeds: editReq.coreNeeds.trim(),
    features: parseFeatures(editReq.featuresText),
    notes: editReq.notes.trim(),
  });
  editingReqId.value = null;
}

/* ---- 任务规划 ---- */
const taskDraft = ref("");
const taskInput = ref<HTMLInputElement>();

async function addTask() {
  if (!taskDraft.value.trim()) return;
  store.addTask(props.project.id, taskDraft.value);
  taskDraft.value = "";
  await nextTick();
  taskInput.value?.focus();
}

/* ---- 文件资料 ---- */
const fileDraft = reactive({ name: "", url: "" });
const fileFormError = ref("");
function addFile() {
  const url = fileDraft.url.trim();
  if (!url) {
    fileFormError.value = "请填写链接地址";
    return;
  }
  fileFormError.value = "";
  store.addFile(props.project.id, fileDraft.name, url);
  Object.assign(fileDraft, { name: "", url: "" });
}
function openFile(url: string) {
  window.open(url, "_blank", "noopener");
}
</script>

<template>
  <section class="wpb-detail min-h-0 flex min-w-0 flex-1 flex-col bg-[var(--bg-primary)]">
    <!-- 头部：图标 + 名称 + 状态 + 操作 -->
    <header class="shrink-0 px-6 pb-0 pt-5 max-md:px-4 max-md:pt-4">
      <div class="flex items-start gap-4">
        <button
          v-if="isMobile"
          type="button"
          class="wpb-back-btn"
          aria-label="返回项目列表"
          @click="emit('back')"
        >
          ←
        </button>
        <div
          class="wpb-icon-tile shrink-0"
          :style="{ background: colorMeta.soft, fontSize: '26px' }"
        >
          {{ project.icon }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-[20px] font-semibold tracking-tight max-md:text-[17px]">
              {{ project.name }}
            </h2>
            <span class="wpb-badge" :class="statusMeta.cls">
              <span class="wpb-badge-dot" />
              {{ statusMeta.label }}
            </span>
          </div>
          <p class="mt-1 line-clamp-2 text-[13px]" style="color: var(--text-secondary)">
            {{ project.description || "还没有介绍，点击「编辑项目」补充一句话介绍" }}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              v-for="tag in project.tags"
              :key="tag"
              type="button"
              class="wpb-tag group"
              :title="`删除标签 ${tag}`"
              @click="removeTag(tag)"
            >
              {{ tag }}
              <X :size="10" class="opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
            <button v-if="addingTag" type="button" class="wpb-tag is-ghost">
              <input
                ref="tagInput"
                v-model="tagDraft"
                class="w-20 bg-transparent text-[11px] outline-none"
                placeholder="标签名"
                maxlength="10"
                @keydown.enter.prevent="commitTag"
                @keydown.esc="addingTag = false; tagDraft = ''"
                @blur="commitTag"
              />
            </button>
            <button
              v-else
              type="button"
              class="wpb-tag is-ghost"
              :disabled="project.tags.length >= 8"
              @click="startAddTag"
            >
              <Plus :size="10" />
              添加标签
            </button>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="wpb-fav-btn"
            :class="project.favorite ? 'is-on' : ''"
            :title="project.favorite ? '取消收藏' : '收藏项目'"
            :aria-pressed="project.favorite"
            @click="store.toggleFavorite(project.id)"
          >
            <Star :size="15" :class="project.favorite ? 'fill-current' : ''" />
          </button>
          <button v-if="!isMobile" type="button" class="wpb-secondary-btn" @click="emit('edit', project)">
            <Pencil :size="13" />
            编辑项目
          </button>
          <Popover>
            <PopoverTrigger as-child>
              <button type="button" class="wpb-secondary-btn px-2" title="更多操作" aria-label="更多操作">
                <MoreHorizontal :size="15" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" class="w-44 p-1.5">
              <button
                v-if="isMobile"
                type="button"
                class="wpb-menu-item"
                @click="emit('edit', project)"
              >
                <Pencil :size="13" /> 编辑项目
              </button>
              <button type="button" class="wpb-menu-item" @click="store.toggleFavorite(project.id)">
                <Star :size="13" /> {{ project.favorite ? "取消收藏" : "收藏项目" }}
              </button>
              <button
                type="button"
                class="wpb-menu-item is-danger"
                @click="store.trashProject(project.id); emit('trashed')"
              >
                <Trash2 :size="13" /> 移入回收站
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <!-- Tabs -->
      <nav class="wpb-tabs mt-4" aria-label="项目内容分区">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          :class="activeTab === tab.key ? 'is-active' : ''"
          :aria-current="activeTab === tab.key ? 'page' : undefined"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span v-if="tab.key === 'ideas'" class="wpb-tab-count">{{ project.inspirations.length + project.requirements.length }}</span>
          <span v-else-if="tab.key === 'tasks'" class="wpb-tab-count">{{ project.tasks.length }}</span>
          <span v-else-if="tab.key === 'files'" class="wpb-tab-count">{{ project.files.length }}</span>
        </button>
      </nav>
    </header>

    <!-- 内容区 -->
    <div :key="activeTab" class="wpb-tab-pane min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 max-md:px-4">
      <!-- 项目详情 -->
      <div v-if="activeTab === 'info'" class="space-y-4">
        <div class="wpb-panel">
          <h3 class="wpb-panel-title">项目简介</h3>
          <p class="text-[13.5px] leading-6" style="color: var(--text-secondary)">
            {{ project.description || "暂无介绍" }}
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="tag in project.tags" :key="tag" class="wpb-tag">{{ tag }}</span>
            <span v-if="!project.tags.length" class="text-[12px]" style="color: var(--text-tertiary)">暂无标签</span>
          </div>
        </div>
        <div class="wpb-panel">
          <h3 class="wpb-panel-title">进展统计</h3>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="wpb-stat">
              <strong>{{ project.inspirations.length }}</strong><span>灵感</span>
            </div>
            <div class="wpb-stat">
              <strong>{{ project.requirements.length }}</strong><span>需求</span>
            </div>
            <div class="wpb-stat">
              <strong>{{ taskDone }}/{{ project.tasks.length }}</strong><span>任务完成</span>
            </div>
            <div class="wpb-stat">
              <strong>{{ project.files.length }}</strong><span>资料</span>
            </div>
          </div>
        </div>
        <div class="wpb-panel">
          <h3 class="wpb-panel-title">时间信息</h3>
          <dl class="space-y-1.5 text-[13px]" style="color: var(--text-secondary)">
            <div class="flex justify-between"><dt>创建时间</dt><dd>{{ fmtTime(project.createdAt) }}</dd></div>
            <div class="flex justify-between"><dt>最近更新</dt><dd>{{ fmtTime(project.updatedAt) }}</dd></div>
            <div class="flex justify-between"><dt>当前状态</dt><dd>{{ statusMeta.label }}</dd></div>
          </dl>
        </div>
      </div>

      <!-- 灵感与需求 -->
      <div v-else-if="activeTab === 'ideas'" class="space-y-4">
        <div class="wpb-panel">
          <div class="flex items-center gap-2">
            <span class="wpb-panel-icon" style="background: rgba(255, 204, 0, 0.18)">💡</span>
            <div class="min-w-0 flex-1">
              <h3 class="wpb-panel-title">灵感速记</h3>
              <p class="text-[12px]" style="color: var(--text-tertiary)">
                随时记录闪现的想法，不错过任何一个灵感
              </p>
            </div>
          </div>
          <div class="mt-3">
            <textarea
              v-model="ideaDraft"
              class="wpb-textarea"
              :maxlength="IDEA_LIMIT"
              rows="3"
              placeholder="快速记录你的灵感、想法、参考方向……"
            />
            <div class="mt-1 text-right text-[11px]" style="color: var(--text-tertiary)">
              {{ ideaDraft.length }}/{{ IDEA_LIMIT }}
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              v-for="chip in IDEA_CHIPS"
              :key="chip"
              type="button"
              class="wpb-chip"
              :title="`写入：${chip}`"
              @click="applyChip(chip)"
            >
              {{ chip }}
            </button>
          </div>
          <div class="mt-3 flex justify-end">
            <button type="button" class="wpb-primary-btn" :disabled="!ideaDraft.trim() && !ideaAdded" @click="addIdea">
              <Check v-if="ideaAdded" :size="14" />
              <Plus v-else :size="14" />
              {{ ideaAdded ? "已添加" : "添加灵感" }}
            </button>
          </div>
          <ul v-if="project.inspirations.length" class="mt-2 space-y-1.5">
            <li v-for="ins in project.inspirations" :key="ins.id" class="wpb-idea-row">
              <Lightbulb :size="13" class="shrink-0" style="color: #e6a700" />
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-[13px]">{{ ins.content }}</p>
                <span class="text-[11px]" style="color: var(--text-tertiary)">{{ fmtTime(ins.createdAt) }}</span>
              </div>
              <button
                type="button"
                class="wpb-mini-btn"
                title="把这个灵感整理成需求"
                @click="ideaToRequirement(ins.content)"
              >
                <Target :size="12" />
                转需求
              </button>
              <button
                type="button"
                class="wpb-mini-btn is-danger"
                title="删除灵感"
                @click="store.removeInspiration(project.id, ins.id)"
              >
                <Trash2 :size="12" />
              </button>
            </li>
          </ul>
          <p v-else class="mt-2 text-[12px]" style="color: var(--text-tertiary)">
            还没有灵感，想到什么就写下来吧
          </p>
        </div>

        <div class="wpb-panel">
          <div class="flex items-center gap-2">
            <span class="wpb-panel-icon" style="background: rgba(0, 122, 255, 0.1)">📋</span>
            <div class="min-w-0 flex-1">
              <h3 class="wpb-panel-title">需求整理</h3>
              <p class="text-[12px]" style="color: var(--text-tertiary)">
                把灵感沉淀为结构化需求，想清楚再做
              </p>
            </div>
          </div>

          <div class="mt-3 space-y-3">
            <div class="wpb-req-field">
              <label class="wpb-req-label"><span class="wpb-req-icon">👤</span> 目标用户</label>
              <input
                v-model="reqDraft.targetUsers"
                class="wpb-input"
                placeholder="例如：学生、职场人士、知识创作者……"
                @change="persistDraft"
              />
            </div>
            <div class="wpb-req-field">
              <label class="wpb-req-label"><span class="wpb-req-icon">🎯</span> 核心需求</label>
              <input
                v-model="reqDraft.coreNeeds"
                class="wpb-input"
                placeholder="例如：快速记录、知识整理、AI 辅助总结……"
                @change="persistDraft"
              />
            </div>
            <div class="wpb-req-field">
              <label class="wpb-req-label"><span class="wpb-req-icon">🧩</span> 功能点</label>
              <textarea
                v-model="reqDraft.featuresText"
                class="wpb-textarea"
                rows="4"
                placeholder="例如：
· 支持多种内容格式（文字、图片、语音）
· AI 自动生成摘要和标签
· 多端同步
……"
                @change="persistDraft"
              />
              <p class="mt-1 text-[11px]" style="color: var(--text-tertiary)">每行一条，开头的 · - 等符号会自动去掉</p>
            </div>
            <div class="wpb-req-field">
              <label class="wpb-req-label"><span class="wpb-req-icon">📝</span> 补充说明</label>
              <textarea
                v-model="reqDraft.notes"
                class="wpb-textarea"
                rows="2"
                placeholder="其他补充信息、参考竞品、注意事项等……"
                @change="persistDraft"
              />
            </div>
          </div>
          <p v-if="reqFormError" class="mt-2 text-[12px] text-destructive">{{ reqFormError }}</p>

          <div class="mt-3 flex justify-end">
            <button type="button" class="wpb-primary-btn" @click="addRequirement">
              <Check v-if="reqAdded" :size="14" />
              <Plus v-else :size="14" />
              {{ reqAdded ? "已添加" : "添加需求" }}
            </button>
          </div>

          <!-- 已整理需求列表 -->
          <ul v-if="project.requirements.length" class="mt-3 space-y-2">
            <li v-for="(req, index) in project.requirements" :key="req.id" class="wpb-req-item">
              <template v-if="editingReqId === req.id">
                <div class="space-y-2">
                  <input v-model="editReq.targetUsers" class="wpb-input" placeholder="目标用户" />
                  <input v-model="editReq.coreNeeds" class="wpb-input" placeholder="核心需求" />
                  <textarea v-model="editReq.featuresText" class="wpb-textarea" rows="3" placeholder="功能点，每行一条" />
                  <textarea v-model="editReq.notes" class="wpb-textarea" rows="2" placeholder="补充说明" />
                  <div class="flex justify-end gap-2">
                    <button type="button" class="wpb-secondary-btn" @click="editingReqId = null">取消</button>
                    <button type="button" class="wpb-primary-btn" @click="saveEditRequirement(req)">
                      <Check :size="13" /> 保存修改
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-[13.5px] font-medium">
                      {{ index + 1 }}. {{ req.title || requirementTitle(req) }}
                    </p>
                    <p class="mt-0.5 text-[12px]" style="color: var(--text-tertiary)">
                      更新于 {{ fmtTime(req.updatedAt) }}
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button type="button" class="wpb-mini-btn" title="编辑需求" @click="startEditRequirement(req)">
                      <Pencil :size="12" />
                    </button>
                    <button
                      type="button"
                      class="wpb-mini-btn is-danger"
                      title="删除需求"
                      @click="store.removeRequirement(project.id, req.id)"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </div>
                <dl class="mt-2 space-y-1 text-[12.5px]" style="color: var(--text-secondary)">
                  <div v-if="req.targetUsers" class="flex gap-1.5">
                    <dt class="shrink-0" style="color: var(--text-tertiary)">目标用户</dt>
                    <dd class="min-w-0">{{ req.targetUsers }}</dd>
                  </div>
                  <div v-if="req.features.length" class="flex gap-1.5">
                    <dt class="shrink-0" style="color: var(--text-tertiary)">功能点</dt>
                    <dd class="min-w-0">
                      <ul class="space-y-0.5">
                        <li v-for="(f, i) in req.features" :key="i" class="leading-5">· {{ f }}</li>
                      </ul>
                    </dd>
                  </div>
                  <div v-if="req.notes" class="flex gap-1.5">
                    <dt class="shrink-0" style="color: var(--text-tertiary)">补充</dt>
                    <dd class="min-w-0">{{ req.notes }}</dd>
                  </div>
                </dl>
              </template>
            </li>
          </ul>
        </div>

        <!-- 底部保存条 -->
        <div class="wpb-save-bar" aria-live="polite">
          <span class="text-[12px]" style="color: var(--text-tertiary)">
            {{ justSaved ? "已保存" : lastSavedAt ? `最后保存：${lastSavedAt}` : "草稿会自动保留在本机" }}
          </span>
          <div class="flex items-center gap-2">
            <button type="button" class="wpb-secondary-btn" @click="persistDraft">
              <Check :size="13" />
              保存内容
            </button>
            <button type="button" class="wpb-primary-btn" @click="addRequirement">
              <Check v-if="reqAdded" :size="14" />
              <Plus v-else :size="14" />
              {{ reqAdded ? "已添加" : "添加需求" }}
            </button>
            <button type="button" class="wpb-primary-btn" :disabled="!ideaDraft.trim() && !ideaAdded" @click="addIdea">
              <Check v-if="ideaAdded" :size="14" />
              <Plus v-else :size="14" />
              {{ ideaAdded ? "已添加" : "添加灵感" }}
            </button>
          </div>
        </div>
      </div>

      <!-- 任务规划 -->
      <div v-else-if="activeTab === 'tasks'" class="space-y-4">
        <div class="wpb-panel">
          <div class="flex items-center justify-between">
            <h3 class="wpb-panel-title">任务清单</h3>
            <span class="text-[12px]" style="color: var(--text-tertiary)">
              已完成 {{ taskDone }}/{{ project.tasks.length }}
            </span>
          </div>
          <div
            v-if="project.tasks.length"
            class="mt-2 h-1.5 overflow-hidden rounded-full"
            style="background: var(--secondary)"
          >
            <div
              class="h-full rounded-full transition-all"
              :style="{
                width: project.tasks.length ? `${(taskDone / project.tasks.length) * 100}%` : '0%',
                background: 'var(--accent-color)',
              }"
            />
          </div>
          <form class="mt-3 flex gap-2" @submit.prevent="addTask">
            <input
              ref="taskInput"
              v-model="taskDraft"
              class="wpb-input flex-1"
              placeholder="添加一个推进项目的任务…"
              maxlength="60"
            />
            <button type="submit" class="wpb-primary-btn" :disabled="!taskDraft.trim()">
              <Plus :size="14" />
              添加
            </button>
          </form>
          <ul v-if="project.tasks.length" class="mt-2 space-y-1">
            <li v-for="task in project.tasks" :key="task.id" class="wpb-task-row" :class="task.done ? 'is-done' : ''">
              <button
                type="button"
                class="wpb-task-check"
                :class="task.done ? 'is-on' : ''"
                :aria-label="task.done ? `重开任务 ${task.title}` : `完成任务 ${task.title}`"
                @click="store.toggleTask(project.id, task.id)"
              >
                <Check v-if="task.done" :size="11" />
              </button>
              <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ task.title }}</span>
              <button
                type="button"
                class="wpb-mini-btn is-danger"
                title="删除任务"
                @click="store.removeTask(project.id, task.id)"
              >
                <Trash2 :size="12" />
              </button>
            </li>
          </ul>
          <p v-else class="mt-2 text-[12px]" style="color: var(--text-tertiary)">
            还没有任务，把需求拆成可执行的小步吧
          </p>
        </div>
      </div>

      <!-- 文件资料 -->
      <div v-else-if="activeTab === 'files'" class="space-y-4">
        <div class="wpb-panel">
          <h3 class="wpb-panel-title">链接与资料</h3>
          <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input v-model="fileDraft.name" class="wpb-input" placeholder="资料名称" maxlength="30" />
            <input
              v-model="fileDraft.url"
              class="wpb-input"
              placeholder="https:// 链接地址"
              @keydown.enter="addFile"
            />
            <button type="button" class="wpb-primary-btn" @click="addFile">
              <Plus :size="14" />
              添加
            </button>
          </div>
          <p v-if="fileFormError" class="mt-1.5 text-[12px] text-destructive">{{ fileFormError }}</p>
          <ul v-if="project.files.length" class="mt-3 space-y-1.5">
            <li v-for="file in project.files" :key="file.id" class="wpb-file-row">
              <ExternalLink :size="13" class="shrink-0" style="color: var(--text-tertiary)" />
              <button type="button" class="min-w-0 flex-1 text-left" @click="openFile(file.url)">
                <span class="block truncate text-[13px]" style="color: var(--accent-color)">{{ file.name }}</span>
                <span class="block truncate text-[11px]" style="color: var(--text-tertiary)">{{ file.url }}</span>
              </button>
              <button
                type="button"
                class="wpb-mini-btn is-danger"
                title="删除资料"
                @click="store.removeFile(project.id, file.id)"
              >
                <Trash2 :size="12" />
              </button>
            </li>
          </ul>
          <p v-else class="mt-2 text-[12px]" style="color: var(--text-tertiary)">
            收藏竞品、参考稿、设计资源等相关链接
          </p>
        </div>
      </div>

      <!-- 项目动态 -->
      <div v-else class="space-y-4">
        <div class="wpb-panel">
          <h3 class="wpb-panel-title">项目动态</h3>
          <ul v-if="project.activities.length" class="mt-3 space-y-3">
            <li v-for="act in project.activities" :key="act.id" class="wpb-act-row">
              <span class="wpb-act-dot" />
              <div class="min-w-0 flex-1">
                <p class="text-[13px]">{{ act.text }}</p>
                <span class="text-[11px]" style="color: var(--text-tertiary)">{{ fmtTime(act.at) }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="mt-2 text-[12px]" style="color: var(--text-tertiary)">暂无动态</p>
        </div>
      </div>
    </div>
  </section>
</template>
