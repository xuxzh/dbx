import { createApp } from "vue";
import { createPinia } from "pinia";
import VueVirtualScroller from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import "./styles/globals.css";
import { installDebugLogCapture } from "@/lib/debugLog";
import { installGlobalInputAttrs, installStartupErrorHandlers, renderStartupError } from "./main.shared";

async function bootstrap() {
  console.log("[STARTUP] frontend bootstrap begin");
  const [{ default: i18n, loadSavedLocale }, { default: App }] = await Promise.all([import("./i18n"), import("./App.vue")]);
  console.log("[STARTUP] frontend modules loaded");
  await loadSavedLocale();
  console.log("[STARTUP] locale ready");

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.use(VueVirtualScroller);
  app.mount("#root");
  console.log("[STARTUP] vue mounted");

  installGlobalInputAttrs();
}

installDebugLogCapture();
installStartupErrorHandlers();
void bootstrap().catch(renderStartupError);
