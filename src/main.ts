import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { applyAppearance, loadAppearance } from "@/lib/appearance";
import "./style.css";

// 启动即应用外观偏好；跟随系统时，系统切换深浅色实时生效
applyAppearance(loadAppearance());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (loadAppearance() === "system") applyAppearance(loadAppearance());
});

createApp(App).use(createPinia()).mount("#app");
