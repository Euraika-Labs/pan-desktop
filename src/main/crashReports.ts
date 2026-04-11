import { app } from "electron";

export function getCrashDumpsPath(): string {
  return app.getPath("crashDumps");
}

export function formatCrashDumpHelp(context: string): string {
  return `${context}\n\nCrash dumps are written to:\n${getCrashDumpsPath()}`;
}
