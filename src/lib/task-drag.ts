export const TASK_DRAG_MIME = "application/x-workbench-task";
export const TASK_DRAG_END_EVENT = "wb:task-drag-end";

export function hasDraggedTask(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types).includes(TASK_DRAG_MIME);
}

export function getDraggedTaskId(dataTransfer: DataTransfer | null): number | null {
  if (!dataTransfer) return null;
  const value = dataTransfer.getData(TASK_DRAG_MIME) || dataTransfer.getData("text/plain");
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function startTaskDrag(event: DragEvent, taskId: number): boolean {
  if (!event.dataTransfer) return false;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(TASK_DRAG_MIME, String(taskId));
  event.dataTransfer.setData("text/plain", String(taskId));
  document.body.classList.add("wb-task-dragging");
  return true;
}

export function endTaskDrag(): void {
  document.body.classList.remove("wb-task-dragging");
  window.dispatchEvent(new CustomEvent(TASK_DRAG_END_EVENT));
}
