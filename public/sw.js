// 只负责提醒通知，不缓存页面资源：避免发布新版本后用户被旧缓存卡住。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Workbench 提醒", {
      body: data.body || "",
      tag: data.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { taskId: data.taskId, date: data.date },
    }),
  );
});

// 点通知：已打开的窗口直接聚焦并打开任务，否则新开一个
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { taskId, date } = event.notification.data || {};
  const scope = self.registration.scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(scope));
      if (existing) {
        await existing.focus();
        if (taskId) existing.postMessage({ type: "wb:open-task", taskId, date });
        return;
      }
      await self.clients.openWindow(taskId ? `${scope}?task=${taskId}&date=${date || ""}` : scope);
    })(),
  );
});
