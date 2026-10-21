import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * 清单里拖动任务行改期。用指针事件自己实现：原生 HTML5 拖拽在手机上不可用。
 * - 鼠标：按住移动超过几像素开始拖
 * - 触屏：长按约 0.35 秒开始拖，没到时间就移动当作滚动
 * 行带 data-drag 才能拖，落点是带 data-drop-date 的元素。
 */
const MOUSE_THRESHOLD = 5;
const TOUCH_DELAY = 350;
const TOUCH_SLOP = 8;
const EDGE = 56;
// 这些控件有自己的点击行为，从它们上面按下不开始拖
const IGNORE = "input, textarea, select, .wb-check, .wb-pri-btn, .wb-row-date, .wb-task-more, .wb-row-subs, .wb-subtasks";

export function useListDrag(options: {
  container: Ref<HTMLElement | undefined>;
  onDrop: (occKey: string, date: string) => void;
}) {
  const dragging = ref(false);
  /** 正在拖的行所在日期，用来让同一天的落点不高亮 */
  const sourceDate = ref("");

  let pending: { x: number; y: number; row: HTMLElement; pointerType: string; timer?: ReturnType<typeof setTimeout> } | null = null;
  let ghost: HTMLElement | null = null;
  let source: HTMLElement | null = null;
  let offset = { x: 0, y: 0 };
  let target: HTMLElement | null = null;
  let lastPoint = { x: 0, y: 0 };
  let scrollFrame = 0;

  const preventTouchScroll = (event: TouchEvent) => event.preventDefault();
  // 安卓长按会弹出系统菜单
  const preventContextMenu = (event: Event) => event.preventDefault();

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || dragging.value) return;
    const el = event.target as Element | null;
    const row = el?.closest<HTMLElement>(".wb-sidebar-row[data-drag]");
    if (!row || !options.container.value?.contains(row) || el?.closest(IGNORE)) return;
    pending = { x: event.clientX, y: event.clientY, row, pointerType: event.pointerType };
    if (event.pointerType === "touch") {
      pending.timer = setTimeout(() => pending && begin(pending.x, pending.y), TOUCH_DELAY);
      window.addEventListener("contextmenu", preventContextMenu);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancel);
  }

  function onPointerMove(event: PointerEvent) {
    lastPoint = { x: event.clientX, y: event.clientY };
    if (pending && !dragging.value) {
      const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (pending.pointerType === "touch") {
        if (moved > TOUCH_SLOP) cancel();
        return;
      }
      if (moved > MOUSE_THRESHOLD) begin(event.clientX, event.clientY);
      return;
    }
    if (dragging.value) move(event.clientX, event.clientY);
  }

  function begin(x: number, y: number) {
    if (!pending) return;
    clearTimeout(pending.timer);
    source = pending.row;
    const rect = source.getBoundingClientRect();
    offset = { x: x - rect.left, y: y - rect.top };
    ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add("wb-drag-ghost");
    ghost.removeAttribute("data-drag");
    Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    // 挂在主面板里，沿用行的样式；主面板没有 transform，fixed 仍按视口定位
    (source.closest(".wb-main-pane") ?? document.body).append(ghost);
    source.classList.add("is-drag-source");
    document.body.classList.add("wb-list-dragging");
    sourceDate.value = (source.dataset.occKey ?? "").split(":")[1] ?? "";
    dragging.value = true;
    lastPoint = { x, y };
    if (pending.pointerType === "touch") {
      document.addEventListener("touchmove", preventTouchScroll, { passive: false });
      navigator.vibrate?.(10);
    }
    window.addEventListener("keydown", onKeyDown);
    scrollFrame = requestAnimationFrame(autoScroll);
    move(x, y);
  }

  function move(x: number, y: number) {
    if (ghost) {
      ghost.style.left = `${x - offset.x}px`;
      ghost.style.top = `${y - offset.y}px`;
    }
    const zone = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-date]");
    const next = zone && options.container.value?.contains(zone) && zone.dataset.dropDate !== sourceDate.value ? zone : null;
    if (next === target) return;
    target?.classList.remove("is-drop-target");
    target = next;
    target?.classList.add("is-drop-target");
  }

  // 拖到列表上下边缘时自动滚动
  function autoScroll() {
    const scroller = options.container.value;
    if (!dragging.value || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const { y } = lastPoint;
    let dy = 0;
    if (y < rect.top + EDGE) dy = -Math.ceil(((rect.top + EDGE - y) / EDGE) * 14);
    else if (y > rect.bottom - EDGE) dy = Math.ceil(((y - (rect.bottom - EDGE)) / EDGE) * 14);
    if (dy) {
      scroller.scrollTop += dy;
      move(lastPoint.x, lastPoint.y);
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onPointerUp() {
    if (dragging.value && target && source?.dataset.occKey && target.dataset.dropDate) {
      options.onDrop(source.dataset.occKey, target.dataset.dropDate);
    }
    // 拖完松手会在标题上触发一次 click，拦掉，避免顺手打开编辑弹窗
    if (dragging.value) {
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
    cancel();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") cancel();
  }

  function cancel() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    cancelAnimationFrame(scrollFrame);
    ghost?.remove();
    ghost = null;
    source?.classList.remove("is-drag-source");
    source = null;
    target?.classList.remove("is-drop-target");
    target = null;
    dragging.value = false;
    sourceDate.value = "";
    document.body.classList.remove("wb-list-dragging");
    document.removeEventListener("touchmove", preventTouchScroll);
    window.removeEventListener("contextmenu", preventContextMenu);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", onKeyDown);
  }

  onBeforeUnmount(cancel);
  return { dragging, sourceDate, onPointerDown };
}
