import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { importWithRetry, markDynamicImportLoaded } from "./dynamicImportRecovery";

export function lazyWithRetry<T extends ComponentType>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    const loaded = await importWithRetry(importer);
    markDynamicImportLoaded();
    return loaded;
  });
}
