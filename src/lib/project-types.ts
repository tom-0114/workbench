/** 项目工作台（灵感工坊）数据模型：localStorage 持久化，独立于任务数据层 */

export type ProjectStatus = "active" | "organizing" | "done"; // 进行中 / 待整理 / 已完成

export interface ProjectInspiration {
  id: string;
  content: string;
  createdAt: string;
}

export interface ProjectRequirement {
  id: string;
  title: string;
  targetUsers: string; // 目标用户
  coreNeeds: string; // 核心需求
  features: string[]; // 功能点
  notes: string; // 补充说明
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export interface ProjectActivity {
  id: string;
  text: string;
  at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  color: ProjectColor; // 图标底色
  status: ProjectStatus;
  tags: string[];
  inspirations: ProjectInspiration[];
  requirements: ProjectRequirement[];
  tasks: ProjectTask[];
  files: ProjectFile[];
  activities: ProjectActivity[];
  favorite: boolean;
  deletedAt: string | null; // 非空 = 在回收站
  createdAt: string;
  updatedAt: string;
}

export type ProjectColor = "blue" | "green" | "purple" | "orange" | "pink" | "teal";

export const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: "进行中", cls: "is-active" },
  organizing: { label: "待整理", cls: "is-organizing" },
  done: { label: "已完成", cls: "is-done" },
};

export const COLOR_META: Record<ProjectColor, { label: string; soft: string; dot: string }> = {
  blue: { label: "蓝色", soft: "rgba(0,122,255,0.12)", dot: "#007aff" },
  green: { label: "绿色", soft: "rgba(52,199,89,0.14)", dot: "#34c759" },
  purple: { label: "紫色", soft: "rgba(175,82,222,0.12)", dot: "#af52de" },
  orange: { label: "橙色", soft: "rgba(255,149,0,0.16)", dot: "#ff9500" },
  pink: { label: "粉色", soft: "rgba(255,45,85,0.12)", dot: "#ff2d55" },
  teal: { label: "青色", soft: "rgba(90,200,250,0.16)", dot: "#32ade6" },
};

export const ICON_CHOICES = [
  "💡", "📅", "🗺️", "💰", "🤝", "🥗", "📚", "🚀", "🎨", "📱", "🎵", "🛠️",
  "🧠", "✍️", "🌱", "☁️", "🏷️", "🧭",
];

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
