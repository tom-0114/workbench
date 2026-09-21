interface SessionResponse {
  authenticated: boolean;
  username?: string;
}

interface ErrorResponse {
  error?: string;
}

const API_BASE = `${import.meta.env.BASE_URL}api/auth`;

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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

export function getSession(): Promise<SessionResponse> {
  return authRequest<SessionResponse>("/session");
}

export function login(username: string, password: string): Promise<SessionResponse> {
  return authRequest<SessionResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return authRequest<void>("/logout", { method: "POST" });
}
