// 真实后端接口测试，需要一个独立的测试库（不要指向线上）：
//   WORKBENCH_API_URL=http://127.0.0.1:3022 WORKBENCH_API_USER=... WORKBENCH_API_PASS=... node --test tests/api.test.mjs
// 推送端到端（可选）：再提供自签名证书 WORKBENCH_PUSH_CERT / WORKBENCH_PUSH_KEY，
// 后端需以 NODE_EXTRA_CA_CERTS 信任该证书并配置 VAPID_*。会起一个本地“推送服务”解密收到的消息。
import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { readFileSync } from "node:fs";
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

const base = process.env.WORKBENCH_API_URL;
const skip = !base && "未设置 WORKBENCH_API_URL";
let cookie = "";

async function api(path, init = {}) {
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { cookie, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

const day = (offset = 0) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

test("登录", { skip }, async () => {
  const r = await api("/auth/login", { method: "POST", body: { username: process.env.WORKBENCH_API_USER, password: process.env.WORKBENCH_API_PASS } });
  assert.equal(r.status, 200);
});

test("时间、提醒与完成时间读写", { skip }, async () => {
  const created = await api("/tasks", { method: "POST", body: { title: "接口测试", dueDate: day(1), dueTime: "14:30", remindOffset: 15, priority: 1, tags: [], repeatRule: "none", completed: false } });
  assert.equal(created.status, 201);
  // 任务不再有时间：旧客户端传来的 14:30 提前 15 分钟，折算成以 09:00 为基准的提前量，提醒仍在 14:15
  assert.deepEqual([created.data.dueTime, created.data.remindOffset, created.data.completedAt], ["", 15 - (14 * 60 + 30 - 540), null]);

  const doneAt = new Date().toISOString();
  const updated = await api(`/tasks/${created.data.id}`, { method: "PUT", body: { ...created.data, completed: true, completedAt: doneAt, dueTime: "25:00" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.completedAt, doneAt);
  assert.equal(updated.data.dueTime, "", "非法时间应被清空");
  assert.ok(updated.data.updatedAt > created.data.updatedAt);

  const undone = await api(`/tasks/${created.data.id}`, { method: "PUT", body: { ...updated.data, completed: false } });
  assert.equal(undone.data.completedAt, null, "取消完成时清空完成时间");
});

test("幼儿园寒暑假设置按账号保存并校验", { skip }, async () => {
  const value = { enabled: true, breaks: [{ name: "暑假", start: "2027-07-01", end: "2027-08-30" }, { name: "寒假", start: "2027-01-27", end: "" }] };
  const put = await api("/settings/school-breaks", { method: "PUT", body: value });
  assert.equal(put.status, 200);
  assert.deepEqual(put.data.breaks.map((b) => b.start), ["2027-01-27", "2027-07-01"], "按开始日期排序");
  assert.deepEqual((await api("/settings/school-breaks")).data, put.data);
  const bad = await api("/settings/school-breaks", { method: "PUT", body: { enabled: true, breaks: [{ name: "寒假", start: "2027-02-01", end: "2027-01-01" }] } });
  assert.equal(bad.status, 400, "结束早于开始应拒绝");
});

test("日历显示偏好按账号保存并校验", { skip }, async () => {
  const prefs = { lunar: false, holidayMarks: true, firstDay: 0, showCompleted: false, yearTasks: false };
  assert.deepEqual((await api("/settings/calendar", { method: "PUT", body: prefs })).data, prefs);
  assert.deepEqual((await api("/settings/calendar")).data, prefs);
  assert.equal((await api("/settings/calendar", { method: "PUT", body: { ...prefs, firstDay: 3 } })).status, 400);
  assert.equal((await api("/settings/unknown")).status, 404);
});

test("备份覆盖恢复并重映射打卡", { skip }, async () => {
  const repeat = await api("/tasks", { method: "POST", body: { title: "每日打卡", dueDate: day(-3), repeatRule: "daily", priority: 0, tags: ["习惯"], completed: false } });
  await api("/completions", { method: "POST", body: { taskId: repeat.data.id, date: day(-1), done: true } });
  const tasks = (await api("/tasks")).data;
  const completions = (await api("/completions")).data;
  const backup = { app: "workbench", version: 1, exportedAt: new Date().toISOString(), tasks, completions };

  assert.equal((await api("/import", { method: "POST", body: { app: "other" } })).status, 400);
  await api("/tasks", { method: "POST", body: { title: "导入后应消失", dueDate: "", priority: 0, tags: [], repeatRule: "none", completed: false } });

  const result = await api("/import", { method: "POST", body: backup });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { tasks: tasks.length, completions: completions.length });
  const after = (await api("/tasks")).data;
  assert.deepEqual(after.map((t) => t.title).sort(), tasks.map((t) => t.title).sort());
  const restored = after.find((t) => t.title === "每日打卡");
  assert.ok((await api("/completions")).data.includes(`${restored.id}:${day(-1)}`));
});

test("提醒同步与到点推送", { skip: skip || (!process.env.WORKBENCH_PUSH_CERT && "未提供推送测试证书"), timeout: 90_000 }, async () => {
  const config = (await api("/push/config")).data;
  assert.equal(config.enabled, true);

  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const received = [];
  const server = https.createServer(
    { cert: readFileSync(process.env.WORKBENCH_PUSH_CERT), key: readFileSync(process.env.WORKBENCH_PUSH_KEY) },
    (req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c)).on("end", () => {
        received.push({ headers: req.headers, payload: JSON.parse(decrypt(Buffer.concat(chunks), ua, auth)) });
        res.writeHead(201).end();
      });
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const endpoint = `https://127.0.0.1:${server.address().port}/push/${randomBytes(4).toString("hex")}`;
    assert.equal((await api("/push/subscribe", { method: "POST", body: { endpoint, keys: { p256dh: ua.getPublicKey("base64url"), auth: auth.toString("base64url") } } })).status, 204);

    const test1 = await api("/push/test", { method: "POST", body: { endpoint } });
    assert.equal(test1.data.ok, true);
    assert.equal((await api("/push/test", { method: "POST", body: { endpoint: `${endpoint}-other` } })).data.reason, "missing");
    assert.match(received.at(-1).headers.authorization, /^vapid t=.+, k=/);

    const mk = (title) => api("/tasks", { method: "POST", body: { title, dueDate: day(0), dueTime: "09:00", remindOffset: 0, priority: 0, tags: [], repeatRule: "none", completed: false } });
    const due = (await mk("到点提醒")).data;
    const done = (await mk("已完成不提醒")).data;
    await api(`/tasks/${done.id}`, { method: "PUT", body: { ...done, completed: true, completedAt: new Date().toISOString() } });
    const past = new Date(Date.now() - 1000).toISOString();
    const sync = await api("/reminders", { method: "PUT", body: { reminders: [
      { taskId: due.id, date: due.dueDate, fireAt: past, body: "今天 09:00" },
      { taskId: done.id, date: done.dueDate, fireAt: past, body: "今天 09:00" },
      { taskId: 999999999, date: day(0), fireAt: past, body: "别人的任务" },
    ] } });
    assert.equal(sync.status, 200);

    const before = received.length;
    for (let i = 0; i < 80 && received.length === before; i++) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 1500));
    const pushes = received.slice(before).map((r) => r.payload);
    assert.deepEqual(pushes.map((p) => p.title), ["到点提醒"]);
    assert.deepEqual([pushes[0].body, pushes[0].taskId, pushes[0].date], ["今天 09:00", due.id, due.dueDate]);

    // 通知上的“完成”：普通任务标记完成，重复任务只打卡当天
    assert.equal((await api(`/tasks/${due.id}/complete`, { method: "POST", body: { date: due.dueDate } })).status, 204);
    const completedTask = (await api("/tasks")).data.find((t) => t.id === due.id);
    assert.equal(completedTask.completed, true);
    assert.ok(completedTask.completedAt);
    assert.equal((await api("/tasks/999999999/complete", { method: "POST", body: { date: day(0) } })).status, 404);

    // 已发送的提醒再次同步不会重复推送
    await api("/reminders", { method: "PUT", body: { reminders: [{ taskId: due.id, date: due.dueDate, fireAt: past, body: "今天 09:00" }] } });
    await new Promise((r) => setTimeout(r, 32_000));
    assert.equal(received.length, before + 1);
    assert.equal((await api("/push/unsubscribe", { method: "POST", body: { endpoint } })).status, 204);
  } finally {
    server.close();
  }
});

const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
function decrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const asPublic = body.subarray(21, 21 + body[20]);
  const ciphertext = body.subarray(21 + body[20]);
  const ikm = hmac(hmac(authSecret, ua.computeSecret(asPublic)), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const d = createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
  d.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([d.update(ciphertext.subarray(0, -16)), d.final()]).subarray(0, -1).toString();
}
