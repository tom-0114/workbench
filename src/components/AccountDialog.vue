<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { KeyRound, LoaderCircle, ShieldCheck, Trash2, UserPlus } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { changePassword, currentUser, userAdmin, type UserAccount } from "@/lib/auth";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const PASSWORD_MIN = 8;

/* 修改自己的密码 */
const pwd = reactive({ current: "", next: "", confirm: "" });
const pwdBusy = ref(false);
const pwdMsg = ref<{ ok: boolean; text: string } | null>(null);

async function submitPassword() {
  pwdMsg.value = null;
  if (pwd.next.length < PASSWORD_MIN) {
    pwdMsg.value = { ok: false, text: `新密码至少 ${PASSWORD_MIN} 位` };
    return;
  }
  if (pwd.next !== pwd.confirm) {
    pwdMsg.value = { ok: false, text: "两次输入的新密码不一致" };
    return;
  }
  pwdBusy.value = true;
  try {
    await changePassword(pwd.current, pwd.next);
    Object.assign(pwd, { current: "", next: "", confirm: "" });
    pwdMsg.value = { ok: true, text: "密码已更新，其他设备需重新登录" };
  } catch (e) {
    pwdMsg.value = { ok: false, text: e instanceof Error ? e.message : "修改失败" };
  } finally {
    pwdBusy.value = false;
  }
}

/* 管理员：账号列表 */
const users = ref<UserAccount[]>([]);
const usersError = ref("");
const listBusy = ref(false);
const form = reactive({ username: "", password: "" });
const createBusy = ref(false);
const createMsg = ref<{ ok: boolean; text: string } | null>(null);
const resetFor = ref<number | null>(null);
const resetPwd = ref("");
const rowBusy = ref<number | null>(null);

async function loadUsers() {
  listBusy.value = true;
  usersError.value = "";
  try {
    users.value = await userAdmin.list();
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "账号列表载入失败";
  } finally {
    listBusy.value = false;
  }
}

async function createAccount() {
  createMsg.value = null;
  const username = form.username.trim().toLowerCase();
  if (!username || form.password.length < PASSWORD_MIN) {
    createMsg.value = { ok: false, text: `请填写账号，密码至少 ${PASSWORD_MIN} 位` };
    return;
  }
  createBusy.value = true;
  try {
    const created = await userAdmin.create(username, form.password);
    users.value.push(created);
    Object.assign(form, { username: "", password: "" });
    createMsg.value = { ok: true, text: `已创建账号 ${created.username}` };
  } catch (e) {
    createMsg.value = { ok: false, text: e instanceof Error ? e.message : "创建失败" };
  } finally {
    createBusy.value = false;
  }
}

async function submitReset(user: UserAccount) {
  if (resetPwd.value.length < PASSWORD_MIN) {
    usersError.value = `密码至少 ${PASSWORD_MIN} 位`;
    return;
  }
  rowBusy.value = user.id;
  usersError.value = "";
  try {
    await userAdmin.resetPassword(user.id, resetPwd.value);
    resetFor.value = null;
    resetPwd.value = "";
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "重置失败";
  } finally {
    rowBusy.value = null;
  }
}

async function removeAccount(user: UserAccount) {
  if (!window.confirm(`删除账号 ${user.username}？该账号的任务和项目会一并删除，且无法恢复。`)) return;
  rowBusy.value = user.id;
  usersError.value = "";
  try {
    await userAdmin.remove(user.id);
    users.value = users.value.filter((u) => u.id !== user.id);
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "删除失败";
  } finally {
    rowBusy.value = null;
  }
}

function fmtDate(iso: string) {
  return iso.slice(0, 10);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(pwd, { current: "", next: "", confirm: "" });
    pwdMsg.value = null;
    createMsg.value = null;
    resetFor.value = null;
    if (currentUser.value?.isAdmin) void loadUsers();
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] max-w-lg gap-0 overflow-y-auto p-5">
      <DialogHeader>
        <DialogTitle>账号设置</DialogTitle>
        <DialogDescription>
          当前登录：{{ currentUser?.username }}<template v-if="currentUser?.isAdmin">（管理员）</template>
        </DialogDescription>
      </DialogHeader>

      <form class="mt-4 space-y-3" @submit.prevent="submitPassword">
        <div class="flex items-center gap-1.5 text-[13px] font-medium">
          <KeyRound :size="14" aria-hidden="true" />
          修改密码
        </div>
        <label class="block">
          <span class="wpb-field-label">当前密码</span>
          <input v-model="pwd.current" type="password" class="wpb-input mt-1" autocomplete="current-password" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="wpb-field-label">新密码</span>
            <input v-model="pwd.next" type="password" class="wpb-input mt-1" autocomplete="new-password" />
          </label>
          <label class="block">
            <span class="wpb-field-label">确认新密码</span>
            <input v-model="pwd.confirm" type="password" class="wpb-input mt-1" autocomplete="new-password" />
          </label>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span
            v-if="pwdMsg"
            class="text-[12px]"
            :class="pwdMsg.ok ? '' : 'text-destructive'"
            :style="pwdMsg.ok ? 'color: var(--text-secondary)' : ''"
            role="status"
          >
            {{ pwdMsg.text }}
          </span>
          <span v-else />
          <Button type="submit" size="sm" :disabled="pwdBusy || !pwd.current || !pwd.next">
            <LoaderCircle v-if="pwdBusy" class="animate-spin" aria-hidden="true" />
            更新密码
          </Button>
        </div>
      </form>

      <template v-if="currentUser?.isAdmin">
        <div class="my-5 border-t" style="border-color: var(--border-subtle)" />

        <div class="space-y-3">
          <div class="flex items-center gap-1.5 text-[13px] font-medium">
            <UserPlus :size="14" aria-hidden="true" />
            创建账号
          </div>
          <p class="text-[12px]" style="color: var(--text-tertiary)">
            每个账号的任务、日历和项目互相独立。账号仅限小写字母、数字和 _ . -。
          </p>
          <form class="flex items-end gap-2" @submit.prevent="createAccount">
            <label class="block min-w-0 flex-1">
              <span class="wpb-field-label">账号</span>
              <input
                v-model="form.username"
                class="wpb-input mt-1"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                maxlength="32"
              />
            </label>
            <label class="block min-w-0 flex-1">
              <span class="wpb-field-label">初始密码</span>
              <input v-model="form.password" type="password" class="wpb-input mt-1" autocomplete="new-password" />
            </label>
            <Button type="submit" size="sm" :disabled="createBusy">
              <LoaderCircle v-if="createBusy" class="animate-spin" aria-hidden="true" />
              创建
            </Button>
          </form>
          <p
            v-if="createMsg"
            class="text-[12px]"
            :class="createMsg.ok ? '' : 'text-destructive'"
            :style="createMsg.ok ? 'color: var(--text-secondary)' : ''"
            role="status"
          >
            {{ createMsg.text }}
          </p>

          <div class="pt-1 text-[13px] font-medium">全部账号</div>
          <p v-if="usersError" class="text-[12px] text-destructive" role="alert">{{ usersError }}</p>
          <div v-if="listBusy" class="flex items-center gap-2 text-[12px]" style="color: var(--text-tertiary)">
            <LoaderCircle :size="14" class="animate-spin" aria-hidden="true" />
            正在载入
          </div>
          <ul v-else class="divide-y rounded-md border" style="border-color: var(--border-subtle)">
            <li v-for="user in users" :key="user.id" class="px-3 py-2">
              <div class="flex items-center gap-2 text-[13px]">
                <span class="min-w-0 flex-1 truncate">
                  {{ user.username }}
                  <ShieldCheck
                    v-if="user.isAdmin"
                    :size="13"
                    class="ml-0.5 inline align-[-2px]"
                    style="color: var(--accent-color)"
                    aria-label="管理员"
                  />
                </span>
                <span class="text-[11px]" style="color: var(--text-tertiary)">{{ fmtDate(user.createdAt) }}</span>
                <template v-if="user.username !== currentUser?.username">
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 text-[12px] hover:bg-accent"
                    :disabled="rowBusy === user.id"
                    @click="resetFor = resetFor === user.id ? null : user.id; resetPwd = ''"
                  >
                    重置密码
                  </button>
                  <button
                    v-if="!user.isAdmin"
                    type="button"
                    class="rounded p-1 text-destructive hover:bg-accent"
                    :disabled="rowBusy === user.id"
                    :aria-label="`删除账号 ${user.username}`"
                    title="删除账号"
                    @click="removeAccount(user)"
                  >
                    <Trash2 :size="14" aria-hidden="true" />
                  </button>
                </template>
              </div>
              <form v-if="resetFor === user.id" class="mt-2 flex gap-2" @submit.prevent="submitReset(user)">
                <input
                  v-model="resetPwd"
                  type="password"
                  class="wpb-input min-w-0 flex-1"
                  placeholder="新密码"
                  autocomplete="new-password"
                  :aria-label="`${user.username} 的新密码`"
                />
                <Button type="submit" size="sm" variant="outline" :disabled="rowBusy === user.id">确定</Button>
              </form>
            </li>
          </ul>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
