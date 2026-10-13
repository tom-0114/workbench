import { ref } from "vue";

export interface SessionResponse {
  authenticated: boolean;
  username?: string;
  isAdmin?: boolean;
}

export interface UserAccount {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

interface ErrorResponse {
  error?: string;
}

const BASE = `${import.meta.env.BASE_URL}api`;

/** 当前登录用户；本地缓存按用户分 key，避免同一浏览器切换账号时串数据 */
export const currentUser = ref<{ username: string; isAdmin: boolean } | null>(null);

export function userStorageKey(base: string): string {
  return `${base}:${currentUser.value?.username ?? "_"}`;
}

function applySession(session: SessionResponse): SessionResponse {
  currentUser.value =
    session.authenticated && session.username
      ? { username: session.username, isAdmin: !!session.isAdmin }
      : null;
  return session;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(body.error || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getSession(): Promise<SessionResponse> {
  return applySession(await authRequest<SessionResponse>("/auth/session"));
}

export async function login(username: string, password: string): Promise<SessionResponse> {
  return applySession(
    await authRequest<SessionResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  );
}

export async function logout(): Promise<void> {
  try {
    await authRequest<void>("/auth/logout", { method: "POST" });
  } finally {
    currentUser.value = null;
  }
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return authRequest<void>("/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export const userAdmin = {
  list: () => authRequest<UserAccount[]>("/users"),
  create: (username: string, password: string) =>
    authRequest<UserAccount>("/users", { method: "POST", body: JSON.stringify({ username, password }) }),
  resetPassword: (id: number, password: string) =>
    authRequest<void>(`/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  remove: (id: number) => authRequest<void>(`/users/${id}`, { method: "DELETE" }),
};
