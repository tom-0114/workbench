import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Ant Design 的日期/时间面板挂在 body 上，不在 reka 弹层的 DOM 里；
 * 在面板里点选会被当成“点了外面”而关掉对话框或弹层，这里拦下来。
 */
export function keepOpenForPicker(event: Event & { detail?: { originalEvent?: Event } }) {
  const target = (event.detail?.originalEvent?.target ?? event.target) as Element | null;
  if (target instanceof Element && target.closest(".ant-picker-dropdown")) event.preventDefault();
}
