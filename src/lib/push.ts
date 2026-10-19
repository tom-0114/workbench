import { reactive } from "vue";
import { pushRepo } from "./repo";

/** 本设备的推送状态；unsupported 包括 iPhone 上没有从主屏幕打开的情况 */
export type PushStatus = "unknown" | "unsupported" | "needs-install" | "server-off" | "denied" | "off" | "on";

export const pushState = reactive({ status: "unknown" as PushStatus, busy: false, message: "" });

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
    // 注册失败只影响通知，不影响正常使用。
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function refreshPushStatus(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) {
    pushState.status = isIos() && !isStandalone() ? "needs-install" : "unsupported";
    return;
  }
  try {
    const config = await pushRepo.config();
    if (!config.enabled) {
      pushState.status = "server-off";
      return;
    }
    if (Notification.permission === "denied") {
      pushState.status = "denied";
      return;
    }
    const sub = await currentSubscription();
    pushState.status = sub && Notification.permission === "granted" ? "on" : "off";
    // 订阅可能被浏览器轮换，重复上报一次让后端拿到最新的
    if (pushState.status === "on" && sub) await pushRepo.subscribe(sub.toJSON());
  } catch {
    pushState.status = "unknown";
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const raw = atob((value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<void> {
  pushState.busy = true;
  pushState.message = "";
  try {
    const config = await pushRepo.config();
    if (!config.enabled || !config.publicKey) {
      pushState.status = "server-off";
      return;
    }
    if ((await Notification.requestPermission()) !== "granted") {
      pushState.status = Notification.permission === "denied" ? "denied" : "off";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) }));
    await pushRepo.subscribe(sub.toJSON());
    pushState.status = "on";
  } catch {
    pushState.message = "开启失败，请稍后重试";
  } finally {
    pushState.busy = false;
  }
}

export async function disablePush(): Promise<void> {
  pushState.busy = true;
  pushState.message = "";
  try {
    const sub = await currentSubscription();
    if (sub) {
      await pushRepo.unsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
    pushState.status = "off";
  } catch {
    pushState.message = "关闭失败，请稍后重试";
  } finally {
    pushState.busy = false;
  }
}

export async function sendTestPush(): Promise<void> {
  pushState.busy = true;
  pushState.message = "";
  try {
    const result = await pushRepo.test();
    pushState.message = result.sent ? "已发送，几秒内会收到" : "没有发送成功，请关闭后重新开启";
  } catch {
    pushState.message = "发送失败，请稍后重试";
  } finally {
    pushState.busy = false;
  }
}

/** 退出登录时解绑本设备，避免下一个登录的人收到上一个账号的提醒 */
export async function detachPushOnLogout(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await pushRepo.unsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    // 退出流程不因此中断。
  }
}
