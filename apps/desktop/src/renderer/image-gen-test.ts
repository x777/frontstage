import { DesktopAiGateway } from "./desktop-ai-gateway.js";

declare global {
  interface Window {
    __DesktopAiGateway: typeof DesktopAiGateway;
  }
}

window.__DesktopAiGateway = DesktopAiGateway;
