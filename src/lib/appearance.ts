export type Appearance = "system" | "light" | "dark";

const KEY = "wb.appearance";

export function loadAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyAppearance(a: Appearance): void {
  const dark = a === "dark" || (a === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function setAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    // 无痕模式下存不了就只用当前会话
  }
  applyAppearance(a);
}
