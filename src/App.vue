<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { AlertCircle, CalendarDays, FolderKanban, ListTodo, LoaderCircle, RefreshCw, X } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import { getSession, login, logout } from "@/lib/auth";
import type { Occurrence } from "@/lib/types";
import { Button } from "@/components/ui/button";
import LoginPage from "@/components/LoginPage.vue";
import MonthView from "@/components/MonthView.vue";
import TodayPanel from "@/components/TodayPanel.vue";
import TaskDialog from "@/components/TaskSheet.vue";
import ProjectWorkbench from "@/components/projects/ProjectWorkbench.vue";

const store = useTaskStore();

const taskDialogOpen = ref(false);
const currentOcc = ref<Occurrence | null>(null);
const isMobile = useMediaQuery("(max-width: 767px)");
const mobilePane = ref<"today" | "calendar">("calendar");
type Workspace = "calendar" | "projects";
const workspace = ref<Workspace>(
  localStorage.getItem("wb.workspace") === "projects" ? "projects" : "calendar",
);
const appState = ref<"checking" | "guest" | "loading" | "ready" | "error">("checking");
const loginBusy = ref(false);
const loginError = ref("");
let authRevision = 0;

function setWorkspace(next: Workspace, pane?: "today" | "calendar") {
  workspace.value = next;
  if (pane) mobilePane.value = pane;
  localStorage.setItem("wb.workspace", next);
}

function openTask(occ: Occurrence) {
  currentOcc.value = occ;
  taskDialogOpen.value = true;
}

/* 侧边栏宽度：可拖拽调节并记忆 */
const sidebarWidth = ref(
  Math.min(420, Math.max(220, Number(localStorage.getItem("wb.sidebarWidth")) || 288)),
);
const resizing = ref(false);

function startResize(e: PointerEvent) {
  e.preventDefault();
  resizing.value = true;
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  const move = (ev: PointerEvent) => {
    sidebarWidth.value = Math.min(420, Math.max(220, startW + ev.clientX - startX));
  };
  const up = () => {
    resizing.value = false;
    localStorage.setItem("wb.sidebarWidth", String(sidebarWidth.value));
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

async function loadWorkspace() {
  const revision = authRevision;
  appState.value = "loading";
  const ready = await store.init();
  // 初始化请求若收到 401，会由全局事件先切回登录页；不要再被通用错误页覆盖。
  if (authRevision !== revision) return;
  appState.value = ready ? "ready" : "error";
}

async function bootstrap() {
  appState.value = "checking";
  try {
    const session = await getSession();
    if (session.authenticated) await loadWorkspace();
    else appState.value = "guest";
  } catch {
    appState.value = "error";
    store.initError = "无法连接到服务器，请检查网络后重试";
  }
}

async function handleLogin(credentials: { username: string; password: string }) {
  loginBusy.value = true;
  loginError.value = "";
  try {
    await login(credentials.username, credentials.password);
    await loadWorkspace();
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : "登录失败，请重试";
  } finally {
    loginBusy.value = false;
  }
}

async function handleLogout() {
  try {
    await logout();
  } finally {
    store.resetData();
    taskDialogOpen.value = false;
    appState.value = "guest";
  }
}

function onAuthRequired() {
  authRevision += 1;
  store.resetData();
  taskDialogOpen.value = false;
  loginError.value = "登录已失效，请重新登录";
  appState.value = "guest";
}

onMounted(() => {
  window.addEventListener("wb:auth-required", onAuthRequired);
  bootstrap();
});
onBeforeUnmount(() => window.removeEventListener("wb:auth-required", onAuthRequired));
</script>

<template>
  <LoginPage
    v-if="appState === 'guest'"
    :busy="loginBusy"
    :error="loginError"
    @submit="handleLogin"
  />

  <main
    v-else-if="appState === 'checking' || appState === 'loading'"
    class="wb-state-page"
    aria-live="polite"
    aria-busy="true"
  >
    <LoaderCircle class="animate-spin" aria-hidden="true" />
    <strong>{{ appState === "checking" ? "正在确认登录" : "正在整理工作台" }}</strong>
    <span>{{ appState === "checking" ? "马上就好" : "任务和日历正在载入" }}</span>
  </main>

  <main v-else-if="appState === 'error'" class="wb-state-page" role="alert">
    <span class="wb-state-icon"><AlertCircle aria-hidden="true" /></span>
    <strong>工作台暂时没有载入</strong>
    <span>{{ store.initError || "请检查网络后重试" }}</span>
    <Button variant="outline" @click="bootstrap">
      <RefreshCw data-icon="inline-start" aria-hidden="true" />
      重新加载
    </Button>
  </main>

  <div
    v-else
    class="wb-app-shell flex overflow-hidden max-md:flex-col md:flex-row"
    :class="resizing ? 'select-none' : ''"
  >
    <template v-if="workspace === 'calendar'">
      <TodayPanel
        class="wb-today-panel min-h-0 shrink-0"
        :class="isMobile && mobilePane !== 'today' ? 'hidden' : 'max-md:w-full max-md:flex-1'"
        :style="
          isMobile
            ? { background: 'var(--bg-secondary)' }
            : { width: sidebarWidth + 'px', background: 'var(--bg-secondary)' }
        "
        @open-task="openTask"
        @logout="handleLogout"
        @open-projects="setWorkspace('projects')"
      />
      <!-- 侧边栏宽度拖拽手柄 -->
      <div
        v-if="!isMobile"
        class="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize transition-colors"
        :style="{ background: resizing ? 'var(--accent-color)' : 'var(--border-subtle)' }"
        title="拖动调整侧栏宽度"
        @pointerdown="startResize"
      />
      <MonthView
        v-show="!isMobile || mobilePane === 'calendar'"
        class="min-h-0 min-w-0 flex-1 max-md:w-full"
        @open-task="openTask"
      />
    </template>
    <ProjectWorkbench
      v-else
      class="min-h-0 min-w-0 flex-1"
      @back="setWorkspace('calendar')"
    />

    <nav v-if="isMobile" class="wb-mobile-nav" aria-label="主要页面">
      <button
        type="button"
        :class="workspace === 'calendar' && mobilePane === 'today' ? 'is-active' : ''"
        :aria-current="workspace === 'calendar' && mobilePane === 'today' ? 'page' : undefined"
        @click="setWorkspace('calendar', 'today')"
      >
        <ListTodo aria-hidden="true" />
        <span>今天</span>
      </button>
      <button
        type="button"
        :class="workspace === 'calendar' && mobilePane === 'calendar' ? 'is-active' : ''"
        :aria-current="workspace === 'calendar' && mobilePane === 'calendar' ? 'page' : undefined"
        @click="setWorkspace('calendar', 'calendar')"
      >
        <CalendarDays aria-hidden="true" />
        <span>日历</span>
      </button>
      <button
        type="button"
        :class="workspace === 'projects' ? 'is-active' : ''"
        :aria-current="workspace === 'projects' ? 'page' : undefined"
        @click="setWorkspace('projects')"
      >
        <FolderKanban aria-hidden="true" />
        <span>项目</span>
      </button>
    </nav>
    <TaskDialog v-model:open="taskDialogOpen" :occurrence="currentOcc" />

    <div v-if="store.operationError" class="wb-operation-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{{ store.operationError }}</span>
      <button type="button" aria-label="关闭错误提示" @click="store.clearOperationError()">
        <X aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
