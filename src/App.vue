<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { AlertCircle, LoaderCircle, RefreshCw, X } from "lucide-vue-next";
import { useTaskStore } from "@/stores/tasks";
import { getSession, login, logout } from "@/lib/auth";
import { detachPushOnLogout } from "@/lib/push";
import type { Occurrence } from "@/lib/types";
import { Button } from "@/components/ui/button";
import LoginPage from "@/components/LoginPage.vue";
import TaskWorkspace from "@/components/TaskWorkspace.vue";
import TaskDialog from "@/components/TaskSheet.vue";

const store = useTaskStore();

const taskDialogOpen = ref(false);
const currentOcc = ref<Occurrence | null>(null);
const taskEditor = ref<InstanceType<typeof TaskDialog>>();
const appState = ref<"checking" | "guest" | "loading" | "ready" | "error">("checking");
const loginBusy = ref(false);
const loginError = ref("");
let authRevision = 0;

function openTask(occ: Occurrence) {
  if (taskDialogOpen.value && currentOcc.value?.task.id === occ.task.id && currentOcc.value.date === occ.date) return;
  if (taskDialogOpen.value && taskEditor.value && !taskEditor.value.canSwitch()) return;
  currentOcc.value = occ;
  taskDialogOpen.value = true;
}

async function loadWorkspace() {
  const revision = authRevision;
  appState.value = "loading";
  const ready = await store.init();
  // 初始化请求若收到 401，会由全局事件先切回登录页；不要再被通用错误页覆盖。
  if (authRevision !== revision) return;
  appState.value = ready ? "ready" : "error";
  if (ready) openTaskFromUrl();
}

/** 点提醒通知打开：?task=<id>&date=<YYYY-MM-DD>，打开后从地址栏去掉 */
function openTaskById(taskId: number, date: string) {
  const task = store.tasks.find((t) => t.id === taskId && !t.deletedAt);
  if (!task) return;
  const occDate = date || task.dueDate;
  openTask(
    task.repeatRule === "none"
      ? { task, date: task.dueDate, completed: task.completed, isVirtual: false }
      : { task, date: occDate, completed: store.completions.has(`${task.id}:${occDate}`), isVirtual: true },
  );
}

function openTaskFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("task"));
  if (!id) return;
  openTaskById(id, params.get("date") ?? "");
  params.delete("task");
  params.delete("date");
  const query = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function onWorkerMessage(event: MessageEvent) {
  if (event.data?.type === "wb:open-task" && appState.value === "ready") {
    openTaskById(Number(event.data.taskId), String(event.data.date ?? ""));
  }
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
    await detachPushOnLogout();
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
  navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
  bootstrap();
});
onBeforeUnmount(() => {
  window.removeEventListener("wb:auth-required", onAuthRequired);
  navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
});
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
    class="wb-app-shell wb-todo-shell"
  >
    <TaskWorkspace
      :selected-key="taskDialogOpen && currentOcc ? `${currentOcc.task.id}:${currentOcc.date}` : ''"
      @open-task="openTask"
      @logout="handleLogout"
    />
    <TaskDialog ref="taskEditor" v-model:open="taskDialogOpen" :occurrence="currentOcc" inline-desktop />

    <div v-if="store.operationError" class="wb-operation-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{{ store.operationError }}</span>
      <button type="button" aria-label="关闭错误提示" @click="store.clearOperationError()">
        <X aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
