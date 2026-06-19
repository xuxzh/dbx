import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";
import { installFrontendDiagnostics, installGlobalInputAttrs, installStartupErrorHandlers, renderStartupError } from "../main.shared";
import { App } from "./App";

console.log("[STARTUP] frontend bootstrap begin");

installStartupErrorHandlers();

async function bootstrap() {
  console.log("[STARTUP] frontend bootstrap phase 1");
  installFrontendDiagnostics();
  const root = document.querySelector<HTMLDivElement>("#root");
  if (!root) throw new Error("Missing #root element");
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  installGlobalInputAttrs();
  console.log("[STARTUP] react mounted");
}

void bootstrap().catch(renderStartupError);
