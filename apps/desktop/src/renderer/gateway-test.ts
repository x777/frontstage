import { DesktopGateway } from "./desktop-gateway.js";
import { writeProject, readProject } from "@palmier/core";

declare global {
  interface Window {
    __DesktopGateway: typeof DesktopGateway;
    __writeProject: typeof writeProject;
    __readProject: typeof readProject;
  }
}

window.__DesktopGateway = DesktopGateway;
window.__writeProject = writeProject;
window.__readProject = readProject;
