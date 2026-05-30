export function isStaticMode(): boolean {
  const envFlag = import.meta.env.VITE_STATIC_MODE === "true";
  const noApiConfigured = !import.meta.env.DEV && !import.meta.env.VITE_API_BASE;
  return envFlag || noApiConfigured;
}
