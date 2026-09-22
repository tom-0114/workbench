import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type {
  Project,
  ProjectActivity,
  ProjectColor,
  ProjectFile,
  ProjectInspiration,
  ProjectRequirement,
  ProjectStatus,
  ProjectTask,
} from "@/lib/project-types";
import { newId } from "@/lib/project-types";

const STORAGE_KEY = "wb.projects.v1";
const API_BASE = `${import.meta.env.BASE_URL}api`;
const SYNC_DEBOUNCE_MS = 400;

function nowIso() {
  return new Date().toISOString();
}

function makeProject(input: Partial<Project>): Project {
  const now = nowIso();
  return {
    id: newId(),
    name: "",
    description: "",
    icon: "💡",
    color: "blue",
    status: "organizing",
    tags: [],
    inspirations: [],
    requirements: [],
    tasks: [],
    files: [],
    activities: [{ id: newId(), text: "创建项目", at: now }],
    favorite: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

/** 首次进入项目工作台时的示例数据，可随意删除修改 */
function seedProjects(): Project[] {
  const base = new Date("2024-04-24T14:30:00");
  const day = (d: number, h: number, m: number) => {
    const t = new Date(base);
    t.setDate(t.getDate() - d);
    t.setHours(h, m, 0, 0);
    return t.toISOString();
  };
  const list: Project[] = [
    makeProject({
      name: "智能笔记助手",
      description: "基于 AI 的新一代笔记工具，帮助用户更高效地记录、整理和利用知识",
      icon: "📅",
      color: "blue",
      status: "active",
      tags: ["AI", "效率工具", "知识管理"],
      updatedAt: day(0, 14, 30),
      createdAt: day(40, 9, 0),
      favorite: true,
      inspirations: [
        { id: newId(), content: "支持多端同步", createdAt: day(1, 10, 0) },
        { id: newId(), content: "更简洁的编辑体验", createdAt: day(2, 20, 12) },
        { id: newId(), content: "AI 自动整理笔记：自动生成摘要和标签", createdAt: day(3, 9, 30) },
      ],
      requirements: [
        {
          id: newId(),
          title: "多格式记录与 AI 整理",
          targetUsers: "学生、职场人士、知识创作者",
          coreNeeds: "快速记录、知识整理、AI 辅助总结",
          features: ["支持多种内容格式（文字、图片、语音）", "AI 自动生成摘要和标签", "多端同步"],
          notes: "参考 Notion、flomo 的记录体验",
          createdAt: day(5, 15, 0),
          updatedAt: day(1, 14, 30),
        },
      ],
    }),
    makeProject({
      name: "旅行计划社区",
      description: "让旅行更简单，发现更大的世界",
      icon: "🗺️",
      color: "teal",
      status: "organizing",
      tags: ["社区", "旅游", "生活方式"],
      updatedAt: day(2, 9, 18),
      createdAt: day(38, 10, 0),
      inspirations: [
        { id: newId(), content: "行程模板一键复用", createdAt: day(4, 11, 0) },
        { id: newId(), content: "结伴同游匹配", createdAt: day(6, 21, 0) },
      ],
    }),
    makeProject({
      name: "个人财务管理 App",
      description: "帮用户轻松管理个人收支，实现财务自由",
      icon: "💰",
      color: "green",
      status: "active",
      tags: ["金融", "理财", "个人成长"],
      updatedAt: day(4, 16, 42),
      createdAt: day(35, 9, 0),
      inspirations: [{ id: newId(), content: "账单截图自动识别分类", createdAt: day(8, 12, 0) }],
      requirements: [
        {
          id: newId(),
          title: "自动记账与月度报告",
          targetUsers: "刚工作、想存钱的年轻人",
          coreNeeds: "低门槛记一笔、看清钱花在哪",
          features: ["记账低于 3 秒", "月度收支报告", "预算超支提醒"],
          notes: "",
          createdAt: day(9, 10, 0),
          updatedAt: day(4, 16, 42),
        },
      ],
    }),
    makeProject({
      name: "在线协作白板",
      description: "支持多人实时协作的可视化白板工具",
      icon: "🤝",
      color: "purple",
      status: "done",
      tags: ["协作", "生产力", "SaaS"],
      updatedAt: day(6, 11, 20),
      createdAt: day(60, 9, 0),
      tasks: [
        { id: newId(), title: "画布基础图形与便签", done: true, createdAt: day(20, 9, 0) },
        { id: newId(), title: "多人光标实时同步", done: true, createdAt: day(19, 9, 0) },
        { id: newId(), title: "导出 PNG / PDF", done: true, createdAt: day(18, 9, 0) },
      ],
    }),
    makeProject({
      name: "健康饮食助手",
      description: "基于用户身体数据，提供个性化饮食建议",
      icon: "🥗",
      color: "green",
      status: "organizing",
      tags: ["健康", "AI", "生活方式"],
      updatedAt: day(8, 10, 5),
      createdAt: day(30, 9, 0),
      inspirations: [{ id: newId(), content: "拍照识别餐食热量", createdAt: day(10, 18, 0) }],
    }),
    makeProject({
      name: "读书笔记社区",
      description: "分享读书笔记，遇见更好的自己",
      icon: "📚",
      color: "blue",
      status: "active",
      tags: ["阅读", "社区", "成长"],
      updatedAt: day(10, 20, 11),
      createdAt: day(28, 9, 0),
      inspirations: [{ id: newId(), content: "书摘卡片生成分享图", createdAt: day(12, 9, 0) }],
    }),
  ];
  return list;
}

function loadLocal(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedProjects();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedProjects();
    return parsed as Project[];
  } catch {
    return seedProjects();
  }
}

/** 项目同步：本地优先（乐观更新），整份文档防抖 PUT 到 PostgreSQL；localStorage 只是离线缓存 */
class ProjectSyncRepo {
  async list(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/projects`, { credentials: "same-origin" });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("wb:auth-required"));
      throw new Error("登录已失效");
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? (data as Project[]) : [];
  }

  async save(project: Project, keepalive = false): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${project.id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(project),
      keepalive,
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("wb:auth-required"));
      throw new Error("登录已失效");
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
  }

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("wb:auth-required"));
      throw new Error("登录已失效");
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
  }
}

export const useProjectStore = defineStore("projects", () => {
  const projects = ref<Project[]>(loadLocal());

  /** idle=无待同步 syncing=同步中 error=有修改未同步 */
  const syncState = ref<"idle" | "syncing" | "error">("idle");
  const ready = ref(false);

  const repo = new ProjectSyncRepo();
  const pendingSaves = new Map<string, number>();

  watch(
    projects,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // 存储失败（如隐私模式）不影响页面内使用
      }
    },
    { deep: true },
  );

  function queueSync(id: string, delay = SYNC_DEBOUNCE_MS) {
    if (pendingSaves.has(id)) clearTimeout(pendingSaves.get(id)!);
    pendingSaves.set(id, window.setTimeout(() => void flushSave(id), delay));
  }

  async function flushSave(id: string, keepalive = false) {
    pendingSaves.delete(id);
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    syncState.value = "syncing";
    try {
      await repo.save(project, keepalive);
      syncState.value = pendingSaves.size > 0 ? "syncing" : "idle";
    } catch {
      syncState.value = "error";
    }
  }

  /** 离开页面前把未同步的项目一并发出（keepalive 不阻塞关闭） */
  function flushAll(keepalive = false) {
    for (const id of [...pendingSaves.keys()]) {
      clearTimeout(pendingSaves.get(id)!);
      pendingSaves.delete(id);
      void flushSave(id, keepalive);
    }
  }

  function retrySync() {
    flushAll();
  }

  /** 登录后拉取服务端数据；远端为空时把本机数据（种子/离线修改）迁移上去 */
  async function init() {
    try {
      // 先把本机未同步的修改推上去，否则拉下来的远端数据会把它们盖掉
      await Promise.all(
        [...pendingSaves.keys()].map((id) => {
          clearTimeout(pendingSaves.get(id)!);
          return flushSave(id);
        }),
      );
      const remote = await repo.list();
      if (remote.length > 0) {
        projects.value = remote;
      } else {
        for (const project of projects.value) queueSync(project.id, 0);
      }
      syncState.value = "idle";
      ready.value = true;
    } catch {
      // 拉取失败：继续用本地缓存，标记待同步
      syncState.value = "error";
      ready.value = true;
    }
  }

  window.addEventListener("pagehide", () => flushAll(true));

  const sorted = computed(() =>
    [...projects.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const activeProjects = computed(() => sorted.value.filter((p) => !p.deletedAt));
  const deletedProjects = computed(() => sorted.value.filter((p) => p.deletedAt));
  const favoriteProjects = computed(() => activeProjects.value.filter((p) => p.favorite));

  const stats = computed(() => ({
    total: activeProjects.value.length,
    active: activeProjects.value.filter((p) => p.status === "active").length,
    organizing: activeProjects.value.filter((p) => p.status === "organizing").length,
    done: activeProjects.value.filter((p) => p.status === "done").length,
    inspirations: activeProjects.value.reduce((sum, p) => sum + p.inspirations.length, 0),
    requirements: activeProjects.value.reduce((sum, p) => sum + p.requirements.length, 0),
  }));

  function touch(project: Project) {
    project.updatedAt = nowIso();
    queueSync(project.id);
  }

  function log(project: Project, text: string) {
    const entry: ProjectActivity = { id: newId(), text, at: nowIso() };
    project.activities.unshift(entry);
    if (project.activities.length > 50) project.activities.length = 50;
  }

  function createProject(input: {
    name: string;
    description: string;
    icon: string;
    color: ProjectColor;
    status: ProjectStatus;
    tags: string[];
  }): Project {
    const project = makeProject({ ...input });
    projects.value.push(project);
    queueSync(project.id);
    return project;
  }

  function updateProject(id: string, input: Partial<Project>) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    Object.assign(project, input);
    log(project, "编辑项目资料");
    touch(project);
  }

  function toggleFavorite(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.favorite = !project.favorite;
    log(project, project.favorite ? "收藏项目" : "取消收藏");
    touch(project);
  }

  function trashProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.deletedAt = nowIso();
    project.updatedAt = project.deletedAt;
    queueSync(project.id);
  }

  function restoreProject(id: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.deletedAt = null;
    touch(project);
  }

  function permanentlyDelete(id: string) {
    if (pendingSaves.has(id)) {
      clearTimeout(pendingSaves.get(id)!);
      pendingSaves.delete(id);
    }
    projects.value = projects.value.filter((p) => p.id !== id);
    syncState.value = "syncing";
    repo.remove(id).catch(() => {
      syncState.value = "error";
    });
  }

  function addInspiration(id: string, content: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project || !content.trim()) return;
    const item: ProjectInspiration = { id: newId(), content: content.trim(), createdAt: nowIso() };
    project.inspirations.unshift(item);
    log(project, "记录了一条灵感");
    touch(project);
  }

  function removeInspiration(id: string, insId: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.inspirations = project.inspirations.filter((i) => i.id !== insId);
    touch(project);
  }

  function addRequirement(id: string, input: Omit<ProjectRequirement, "id" | "createdAt" | "updatedAt">) {
    const project = projects.value.find((p) => p.id === id);
    if (!project || !input.title.trim()) return;
    const now = nowIso();
    project.requirements.unshift({ ...input, title: input.title.trim(), id: newId(), createdAt: now, updatedAt: now });
    log(project, `添加了需求「${input.title.trim()}」`);
    touch(project);
  }

  function updateRequirement(id: string, reqId: string, input: Partial<ProjectRequirement>) {
    const project = projects.value.find((p) => p.id === id);
    const req = project?.requirements.find((r) => r.id === reqId);
    if (!project || !req) return;
    Object.assign(req, input, { updatedAt: nowIso() });
    log(project, "更新了需求");
    touch(project);
  }

  function removeRequirement(id: string, reqId: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.requirements = project.requirements.filter((r) => r.id !== reqId);
    touch(project);
  }

  function addTask(id: string, title: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project || !title.trim()) return;
    const item: ProjectTask = { id: newId(), title: title.trim(), done: false, createdAt: nowIso() };
    project.tasks.push(item);
    log(project, `添加了任务「${item.title}」`);
    touch(project);
  }

  function toggleTask(id: string, taskId: string) {
    const project = projects.value.find((p) => p.id === id);
    const task = project?.tasks.find((t) => t.id === taskId);
    if (!project || !task) return;
    task.done = !task.done;
    log(project, task.done ? `完成任务「${task.title}」` : `重开任务「${task.title}」`);
    touch(project);
  }

  function removeTask(id: string, taskId: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.tasks = project.tasks.filter((t) => t.id !== taskId);
    touch(project);
  }

  function addFile(id: string, name: string, url: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project || !url.trim()) return;
    const item: ProjectFile = {
      id: newId(),
      name: name.trim() || url.trim(),
      url: url.trim(),
      createdAt: nowIso(),
    };
    project.files.unshift(item);
    log(project, `添加了资料「${item.name}」`);
    touch(project);
  }

  function removeFile(id: string, fileId: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    project.files = project.files.filter((f) => f.id !== fileId);
    touch(project);
  }

  function logActivity(id: string, text: string) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;
    log(project, text);
    touch(project);
  }

  return {
    projects,
    sorted,
    activeProjects,
    deletedProjects,
    favoriteProjects,
    stats,
    syncState,
    ready,
    init,
    retrySync,
    createProject,
    updateProject,
    toggleFavorite,
    trashProject,
    restoreProject,
    permanentlyDelete,
    addInspiration,
    removeInspiration,
    addRequirement,
    updateRequirement,
    removeRequirement,
    addTask,
    toggleTask,
    removeTask,
    addFile,
    removeFile,
    logActivity,
  };
});
