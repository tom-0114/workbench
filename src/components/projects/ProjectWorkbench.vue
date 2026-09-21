<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  ArrowLeft,
  Clock3,
  CloudOff,
  FolderOpen,
  Grid2x2,
  History,
  LayoutDashboard,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Target,
  Trash2,
} from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjectStore } from "@/stores/projects";
import type { Project, ProjectInspiration, ProjectRequirement, ProjectStatus } from "@/lib/project-types";
import { COLOR_META, STATUS_META, fmtTime } from "@/lib/project-types";
import ProjectDialog from "./ProjectDialog.vue";
import ProjectDetail from "./ProjectDetail.vue";

const emit = defineEmits<{ (e: "back"): void }>();

const store = useProjectStore();
const isMobile = useMediaQuery("(max-width: 767px)");

const SECTIONS = [
  { key: "overview", label: "项目总览", icon: LayoutDashboard },
  { key: "all", label: "全部项目", icon: FolderOpen },
  { key: "ideas", label: "灵感收集", icon: Lightbulb },
  { key: "reqs", label: "需求池", icon: Target },
  { key: "recent", label: "最近编辑", icon: History },
  { key: "fav", label: "我的收藏", icon: Star },
  { key: "trash", label: "回收站", icon: Trash2 },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const section = ref<SectionKey>("all");
const selectedId = ref<string | null>(null);
const searchQuery = ref("");
const searchInput = ref<HTMLInputElement>();

const STATUS_OPTIONS: Array<{ key: "all" | ProjectStatus; label: string }> = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "organizing", label: "待整理" },
  { key: "done", label: "已完成" },
];
const filterStatus = ref<"all" | ProjectStatus>("all");

const selectedProject = computed(
  () => store.activeProjects.find((p) => p.id === selectedId.value) ?? null,
);

watch(selectedId, (id) => {
  if (id) localStorage.setItem("wb.pwb.selected", id);
});
watch(
  () => store.activeProjects.length,
  (count, old) => {
    // 从有到无（全部删光）时清空选中
    if (count === 0 && old > 0) selectedId.value = null;
  },
);
watch(section, (s) => {
  filterStatus.value = "all";
  if (s === "trash") selectedId.value = null;
});

const sortKey = ref<"updated" | "created" | "name">("updated");
type SortKey = typeof sortKey.value;
const sortLabels: Record<SortKey, string> = {
  updated: "按更新时间",
  created: "按创建时间",
  name: "按名称",
};
function sortProjects(list: Project[]): Project[] {
  const copy = [...list];
  if (sortKey.value === "created") copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (sortKey.value === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  else copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return copy;
}

const matchesSearch = (p: Project) => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  return (
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.tags.some((t) => t.toLowerCase().includes(q))
  );
};

const matchesFilter = (p: Project) => filterStatus.value === "all" || p.status === filterStatus.value;

const listTitle = computed(() => SECTIONS.find((s) => s.key === section.value)?.label ?? "");
const listProjects = computed<Project[]>(() => {
  switch (section.value) {
    case "all":
      return sortProjects(store.activeProjects).filter(matchesSearch).filter(matchesFilter);
    case "recent":
      return sortProjects(store.activeProjects).slice(0, 8).filter(matchesSearch).filter(matchesFilter);
    case "fav":
      return sortProjects(store.favoriteProjects).filter(matchesSearch).filter(matchesFilter);
    default:
      return [];
  }
});

const showFilter = computed(() => ["all", "recent", "fav"].includes(section.value));

const ideaFeed = computed<Array<{ project: Project; inspiration: ProjectInspiration }>>(() => {
  const rows: Array<{ project: Project; inspiration: ProjectInspiration }> = [];
  for (const project of store.activeProjects) {
    if (!matchesSearch(project)) continue;
    for (const inspiration of project.inspirations) {
      rows.push({ project, inspiration });
    }
  }
  return rows.sort((a, b) => b.inspiration.createdAt.localeCompare(a.inspiration.createdAt));
});

const reqFeed = computed<Array<{ project: Project; requirement: ProjectRequirement }>>(() => {
  const rows: Array<{ project: Project; requirement: ProjectRequirement }> = [];
  for (const project of store.activeProjects) {
    if (!matchesSearch(project)) continue;
    for (const requirement of project.requirements) {
      rows.push({ project, requirement });
    }
  }
  return rows.sort((a, b) => b.requirement.updatedAt.localeCompare(a.requirement.updatedAt));
});

const overviewRecent = computed(() =>
  sortProjects(store.activeProjects).slice(0, 6),
);

function selectProject(id: string) {
  selectedId.value = id;
}

function openProjectAt(id: string) {
  // 详情组件在 project 变化时会自动回到「灵感与需求」页
  selectedId.value = id;
}

/* 新建 / 编辑弹窗 */
const dialogOpen = ref(false);
const editingProject = ref<Project | null>(null);
function openCreate() {
  editingProject.value = null;
  dialogOpen.value = true;
}
function openEdit(project: Project) {
  editingProject.value = project;
  dialogOpen.value = true;
}
function onDialogSubmit(value: { name: string; description: string; icon: string; color: Project["color"]; status: Project["status"]; tags: string[] }) {
  if (editingProject.value) {
    store.updateProject(editingProject.value.id, value);
  } else {
    const project = store.createProject(value);
    selectedId.value = project.id;
    section.value = "all";
  }
}

function restoreAndKeep(id: string) {
  store.restoreProject(id);
}

function onTrashed() {
  selectedId.value = null;
}

function trashFromCard(id: string) {
  store.trashProject(id);
  if (selectedId.value === id) selectedId.value = null;
}

/* Ctrl/Cmd + K 聚焦搜索；Esc 关闭移动端详情 */
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (e.key === "Escape" && isMobile.value && selectedId.value) {
    selectedId.value = null;
  }
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void store.init();
  const last = localStorage.getItem("wb.pwb.selected");
  if (last && store.activeProjects.some((p) => p.id === last)) selectedId.value = last;
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function statusCls(status: Project["status"]) {
  return STATUS_META[status].cls;
}
function statusLabel(status: Project["status"]) {
  return STATUS_META[status].label;
}
</script>

<template>
  <div class="wpb-shell flex overflow-hidden bg-[var(--bg-secondary)] max-md:flex-col">
    <!-- 左侧导航 -->
    <aside class="wpb-nav flex shrink-0 flex-col max-md:hidden">
      <div class="px-4 pb-3 pt-5">
        <div class="flex items-center gap-2.5">
          <span class="wpb-logo" aria-hidden="true">💡</span>
          <div>
            <h1 class="text-[16px] font-semibold leading-tight">灵感工坊</h1>
            <p class="text-[11px]" style="color: var(--text-tertiary)">让想法落地成产品</p>
          </div>
        </div>
      </div>
      <nav class="min-h-0 flex-1 overflow-y-auto px-2" aria-label="项目工作台分区">
        <button
          v-for="s in SECTIONS"
          :key="s.key"
          type="button"
          class="wpb-nav-item"
          :class="section === s.key ? 'is-active' : ''"
          :aria-current="section === s.key ? 'page' : undefined"
          @click="section = s.key"
        >
          <component :is="s.icon" :size="15" />
          <span class="flex-1 text-left">{{ s.label }}</span>
          <span v-if="s.key === 'all'" class="wpb-nav-count">{{ store.stats.total }}</span>
          <span v-else-if="s.key === 'ideas'" class="wpb-nav-count">{{ store.stats.inspirations }}</span>
          <span v-else-if="s.key === 'reqs'" class="wpb-nav-count">{{ store.stats.requirements }}</span>
          <span v-else-if="s.key === 'fav'" class="wpb-nav-count">{{ store.favoriteProjects.length }}</span>
          <span v-else-if="s.key === 'trash'" class="wpb-nav-count">{{ store.deletedProjects.length }}</span>
        </button>
      </nav>
      <div class="border-t p-3" style="border-color: var(--border-subtle)">
        <button type="button" class="wpb-back-calendar" @click="emit('back')">
          <ArrowLeft :size="14" />
          返回日历工作台
        </button>
      </div>
    </aside>

    <!-- 中间：列表区 -->
    <section class="wpb-list flex min-h-0 min-w-0 flex-col border-r max-md:border-r-0" style="border-color: var(--border-subtle); background: var(--bg-primary)">
      <!-- 顶栏 -->
      <header class="shrink-0 border-b px-5 pb-3 pt-4 max-md:px-3" style="border-color: var(--border-subtle)">
        <div class="flex items-center gap-3">
          <div v-if="isMobile" class="min-w-0">
            <h1 class="truncate text-[17px] font-semibold leading-tight">项目工作台</h1>
            <p class="text-[11px]" style="color: var(--text-tertiary)">收集灵感 · 整理需求 · 推动实现</p>
          </div>
          <div v-else class="min-w-0">
            <h1 class="text-[20px] font-semibold leading-tight tracking-tight">项目工作台</h1>
            <p class="mt-0.5 text-[12px]" style="color: var(--text-tertiary)">收集灵感 · 整理需求 · 推动实现</p>
          </div>
          <div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 max-md:flex-none">
            <div class="wpb-search max-md:hidden">
              <Search :size="13" aria-hidden="true" />
              <input
                ref="searchInput"
                v-model="searchQuery"
                placeholder="搜索项目、灵感或需求…"
                aria-label="搜索项目、灵感或需求"
              />
              <kbd>⌘K</kbd>
            </div>
            <button type="button" class="wpb-primary-btn shrink-0" @click="openCreate">
              <Plus :size="14" />
              新建项目
            </button>
          </div>
        </div>
        <div class="mt-2.5 flex items-center justify-between gap-2">
          <div v-if="showFilter" class="wpb-seg" role="group" aria-label="按状态筛选">
            <button
              v-for="opt in STATUS_OPTIONS"
              :key="opt.key"
              type="button"
              :class="filterStatus === opt.key ? 'is-active' : ''"
              :aria-pressed="filterStatus === opt.key"
              @click="filterStatus = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>
          <span v-else />
          <button
            v-if="store.syncState === 'error'"
            type="button"
            class="wpb-sync-chip"
            title="部分修改还没保存到服务器"
            @click="store.retrySync()"
          >
            <CloudOff :size="12" />
            未同步，点击重试
          </button>
        </div>
        <!-- 移动端：搜索 + 分区 chips -->
        <div v-if="isMobile" class="mt-2.5 flex items-center gap-2">
          <div class="wpb-search min-w-0 flex-1">
            <Search :size="13" aria-hidden="true" />
            <input v-model="searchQuery" placeholder="搜索项目…" aria-label="搜索项目" />
          </div>
        </div>
        <div v-if="isMobile" class="wpb-chip-row mt-2 flex gap-1 overflow-x-auto pb-0.5">
          <button
            v-for="s in SECTIONS"
            :key="s.key"
            type="button"
            class="wpb-chip"
            :class="section === s.key ? 'is-picked' : ''"
            @click="section = s.key"
          >
            {{ s.label }}
          </button>
        </div>
      </header>

      <!-- 回收站 -->
      <div v-if="section === 'trash'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        <h2 class="wpb-list-title">回收站（{{ store.deletedProjects.length }}）</h2>
        <p v-if="!store.deletedProjects.length" class="wpb-empty">回收站是空的</p>
        <ul class="mt-2 space-y-2">
          <li v-for="project in store.deletedProjects" :key="project.id" class="wpb-card flex items-center gap-3">
            <span class="wpb-icon-tile" :style="{ background: COLOR_META[project.color].soft }">{{ project.icon }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14px] font-medium">{{ project.name }}</p>
              <p class="text-[11.5px]" style="color: var(--text-tertiary)">
                删除于 {{ fmtTime(project.deletedAt || project.updatedAt) }}
              </p>
            </div>
            <button type="button" class="wpb-secondary-btn" @click="restoreAndKeep(project.id)">
              <RotateCcw :size="13" /> 恢复
            </button>
            <button
              type="button"
              class="wpb-secondary-btn is-danger"
              @click="store.permanentlyDelete(project.id)"
            >
              <Trash2 :size="13" /> 彻底删除
            </button>
          </li>
        </ul>
      </div>

      <!-- 项目总览 -->
      <div v-else-if="section === 'overview'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        <h2 class="wpb-list-title">项目总览</h2>
        <div class="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div class="wpb-stat-card">
            <strong>{{ store.stats.total }}</strong><span>全部项目</span>
          </div>
          <div class="wpb-stat-card"><strong>{{ store.stats.active }}</strong><span>进行中</span></div>
          <div class="wpb-stat-card"><strong>{{ store.stats.organizing }}</strong><span>待整理</span></div>
          <div class="wpb-stat-card"><strong>{{ store.stats.done }}</strong><span>已完成</span></div>
          <div class="wpb-stat-card"><strong>{{ store.stats.inspirations }}</strong><span>灵感</span></div>
          <div class="wpb-stat-card"><strong>{{ store.stats.requirements }}</strong><span>需求</span></div>
        </div>
        <h3 class="wpb-list-title mt-5">最近编辑</h3>
        <div v-if="!overviewRecent.length" class="wpb-empty-state">
          <p>还没有项目</p>
          <button type="button" class="wpb-primary-btn" @click="openCreate">
            <Plus :size="14" />
            新建项目
          </button>
        </div>
        <ul class="mt-2 space-y-2">
          <li v-for="project in overviewRecent" :key="project.id">
            <button type="button" class="wpb-card w-full text-left" @click="selectProject(project.id)">
              <div class="flex items-center gap-3">
                <span class="wpb-icon-tile" :style="{ background: COLOR_META[project.color].soft }">{{ project.icon }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="min-w-0 truncate text-[14px] font-medium">{{ project.name }}</p>
                    <span class="wpb-badge" :class="statusCls(project.status)">{{ statusLabel(project.status) }}</span>
                  </div>
                  <p class="mt-0.5 text-[11.5px]" style="color: var(--text-tertiary)">
                    更新时间：{{ fmtTime(project.updatedAt) }}
                  </p>
                </div>
              </div>
            </button>
          </li>
        </ul>
      </div>

      <!-- 灵感收集 -->
      <div v-else-if="section === 'ideas'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        <h2 class="wpb-list-title">灵感收集（{{ ideaFeed.length }}）</h2>
        <p v-if="!ideaFeed.length" class="wpb-empty">还没有灵感，打开一个项目在「灵感与需求」里记录</p>
        <ul class="mt-2 space-y-1.5">
          <li v-for="row in ideaFeed" :key="row.inspiration.id" class="wpb-feed-row">
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              @click="openProjectAt(row.project.id)"
            >
              <p class="break-words text-[13.5px]">{{ row.inspiration.content }}</p>
              <p class="mt-0.5 flex items-center gap-1.5 text-[11px]" style="color: var(--text-tertiary)">
                <span class="wpb-icon-tile is-mini" :style="{ background: COLOR_META[row.project.color].soft }">{{ row.project.icon }}</span>
                {{ row.project.name }} · {{ fmtTime(row.inspiration.createdAt) }}
              </p>
            </button>
          </li>
        </ul>
      </div>

      <!-- 需求池 -->
      <div v-else-if="section === 'reqs'" class="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        <h2 class="wpb-list-title">需求池（{{ reqFeed.length }}）</h2>
        <p v-if="!reqFeed.length" class="wpb-empty">需求池是空的，去项目里把灵感整理成需求</p>
        <ul class="mt-2 space-y-1.5">
          <li v-for="row in reqFeed" :key="row.requirement.id" class="wpb-feed-row">
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              @click="openProjectAt(row.project.id)"
            >
              <p class="truncate text-[13.5px] font-medium">{{ row.requirement.title }}</p>
              <p v-if="row.requirement.targetUsers" class="mt-0.5 truncate text-[12px]" style="color: var(--text-secondary)">
                目标用户：{{ row.requirement.targetUsers }}
              </p>
              <p class="mt-0.5 flex items-center gap-1.5 text-[11px]" style="color: var(--text-tertiary)">
                <span class="wpb-icon-tile is-mini" :style="{ background: COLOR_META[row.project.color].soft }">{{ row.project.icon }}</span>
                {{ row.project.name }} · {{ fmtTime(row.requirement.updatedAt) }}
              </p>
            </button>
          </li>
        </ul>
      </div>

      <!-- 项目列表（全部 / 最近 / 收藏） -->
      <div v-else class="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="wpb-list-title">{{ listTitle }}（{{ listProjects.length }}）</h2>
          <Popover>
            <PopoverTrigger as-child>
              <button type="button" class="wpb-sort-btn" title="切换排序方式">
                {{ sortLabels[sortKey] }}
                <Clock3 :size="12" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" class="w-36 p-1.5">
              <button
                v-for="(label, key) in sortLabels"
                :key="key"
                type="button"
                class="wpb-menu-item"
                :class="sortKey === key ? 'is-current' : ''"
                @click="sortKey = key as typeof sortKey"
              >
                {{ label }}
              </button>
            </PopoverContent>
          </Popover>
        </div>
        <div v-if="!listProjects.length" class="wpb-empty-state">
          <p>{{ searchQuery || filterStatus !== "all" ? "没有匹配的项目" : "还没有项目" }}</p>
          <button
            v-if="!searchQuery && filterStatus === 'all'"
            type="button"
            class="wpb-primary-btn"
            @click="openCreate"
          >
            <Plus :size="14" />
            新建项目
          </button>
        </div>
        <ul class="mt-2 space-y-2.5">
          <li v-for="project in listProjects" :key="project.id" class="wpb-card-row">
            <button
              type="button"
              class="wpb-card w-full text-left"
              :class="selectedId === project.id ? 'is-selected' : ''"
              @click="selectProject(project.id)"
            >
              <div class="flex items-center gap-3">
                <span class="wpb-icon-tile" :style="{ background: COLOR_META[project.color].soft }">{{ project.icon }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="min-w-0 truncate text-[15px] font-semibold">{{ project.name }}</p>
                    <span class="wpb-badge" :class="statusCls(project.status)">{{ statusLabel(project.status) }}</span>
                    <Star
                      v-if="project.favorite"
                      :size="12"
                      class="shrink-0 fill-current"
                      style="color: #e6a700"
                    />
                  </div>
                  <p class="mt-0.5 line-clamp-1 text-[12.5px]" style="color: var(--text-secondary)">
                    {{ project.description || "暂无介绍" }}
                  </p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1">
                    <span v-for="tag in project.tags" :key="tag" class="wpb-tag">{{ tag }}</span>
                    <span class="ml-auto text-[11px]" style="color: var(--text-tertiary)">
                      更新时间：{{ fmtTime(project.updatedAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </button>
            <Popover>
              <PopoverTrigger as-child>
                <button type="button" class="wpb-card-menu" :aria-label="`${project.name} 的更多操作`">
                  <MoreHorizontal :size="15" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" class="w-40 p-1.5">
                <button type="button" class="wpb-menu-item" @click="store.toggleFavorite(project.id)">
                  <Star :size="13" /> {{ project.favorite ? "取消收藏" : "收藏项目" }}
                </button>
                <button type="button" class="wpb-menu-item" @click="openEdit(project)">
                  <Pencil :size="13" /> 编辑项目
                </button>
                <button type="button" class="wpb-menu-item is-danger" @click="trashFromCard(project.id)">
                  <Trash2 :size="13" /> 移入回收站
                </button>
              </PopoverContent>
            </Popover>
          </li>
        </ul>
      </div>
    </section>

    <!-- 右侧：详情（桌面常驻 / 移动端覆盖层） -->
    <template v-if="selectedProject">
      <ProjectDetail
        v-if="!isMobile"
        :key="selectedProject.id"
        :project="selectedProject"
        @edit="openEdit"
        @trashed="onTrashed"
      />
      <div v-else class="wpb-detail-overlay">
        <ProjectDetail
          :key="selectedProject.id"
          :project="selectedProject"
          :is-mobile="true"
          @edit="openEdit"
          @trashed="onTrashed"
          @back="selectedId = null"
        />
      </div>
    </template>
    <section
      v-else-if="!isMobile"
      class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-[var(--bg-primary)]"
      aria-live="polite"
    >
      <Grid2x2 :size="28" style="color: var(--text-tertiary)" aria-hidden="true" />
      <p class="text-[13px]" style="color: var(--text-tertiary)">在左侧选择一个项目，查看灵感与需求</p>
      <button type="button" class="wpb-primary-btn" @click="openCreate">
        <Plus :size="14" />
        新建项目
      </button>
    </section>

    <ProjectDialog v-model:open="dialogOpen" :project="editingProject" @submit="onDialogSubmit" />
  </div>
</template>
