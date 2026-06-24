import { DesktopAiGateway } from "./desktop-ai-gateway.js";
import { buildCatalog } from "@palmier/ai";

declare global {
  interface Window {
    __DesktopAiGateway: typeof DesktopAiGateway;
    __buildCatalog: typeof buildCatalog;
  }
}

window.__DesktopAiGateway = DesktopAiGateway;
window.__buildCatalog = buildCatalog;
