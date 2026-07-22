import type { DesktopApi } from "@gold-work/shared";

declare global {
  interface Window {
    goldWork?: DesktopApi;
  }
}

export {};

