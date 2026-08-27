import { ref } from "vue";
import { isTauri } from "./repo";

/** 应用更新状态（模块级单例） */
export const currentVersion = ref("");
export const updateAvailable = ref(false);
export const updateVersion = ref("");
export const checking = ref(false);
export const updating = ref(false);
export const updateProgress = ref(0);
export const updateError = ref("");
/** 是否手动检查过（用于展示“已是最新版本”） */
export const checkedManually = ref(false);

let cachedUpdate: Awaited<
  ReturnType<typeof import("@tauri-apps/plugin-updater").check>
> = null;

export async function loadVersion() {
  if (!isTauri) return;
  const { getVersion } = await import("@tauri-apps/api/app");
  currentVersion.value = await getVersion();
}

/** 检查更新。silent 时网络错误不提示（用于启动自检） */
export async function checkUpdate(silent = true): Promise<boolean> {
  if (!isTauri) return false;
  checking.value = true;
  updateError.value = "";
  if (!silent) checkedManually.value = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      cachedUpdate = update;
      updateAvailable.value = true;
      updateVersion.value = update.version;
      return true;
    }
    updateAvailable.value = false;
    return false;
  } catch (e) {
    if (!silent) updateError.value = `检查失败：${String(e)}`;
    return false;
  } finally {
    checking.value = false;
  }
}

/** 下载并安装更新，完成后自动重启 */
export async function installUpdate() {
  if (!cachedUpdate) return;
  updating.value = true;
  updateProgress.value = 0;
  updateError.value = "";
  try {
    let total = 0;
    let got = 0;
    await cachedUpdate.downloadAndInstall((ev) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? 0;
      } else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        if (total > 0) updateProgress.value = Math.round((got / total) * 100);
      } else if (ev.event === "Finished") {
        updateProgress.value = 100;
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    updateError.value = `更新失败：${String(e)}`;
    updating.value = false;
  }
}
