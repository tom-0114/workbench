/** 灵感速记图片：本地压缩成 dataURL，避免项目文档过大（服务端 12MB / localStorage 5MB 限制） */

const MAX_DIMENSION = 1600;
const RAW_KEEP_BYTES = 150 * 1024; // 小图直接原样存，不重编码

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 压缩为 JPEG（最长边 1600px，质量 0.85）。
 * 小文件或 GIF 直接原样返回（canvas 重编码会丢动画/透明度）。
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  if (file.size <= RAW_KEEP_BYTES || file.type === "image/gif") {
    return readAsDataUrl(file);
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    // createImageBitmap 不可用时退化为原文件
    return readAsDataUrl(file);
  }
}
