export function isStaticMode(): boolean {
  const envFlag = import.meta.env.VITE_STATIC_MODE === "true";
  const noApiConfigured =
    !import.meta.env.VITE_API_BASE &&
    !import.meta.env.VITE_DEV_WORKER_URL &&
    !import.meta.env.VITE_GIN_API_URL;
  return envFlag || noApiConfigured;
}
