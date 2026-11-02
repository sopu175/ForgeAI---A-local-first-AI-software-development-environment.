import type { ForgeApi } from '@forgeai/shared';

declare global {
  interface Window {
    forge: ForgeApi;
  }
}

export {};
