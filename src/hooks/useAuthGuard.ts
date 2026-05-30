import { useEffect, useState } from "react";
import { hasValidLocalAuth, verifyTokenRemote } from "../services/authService";

type GuardStatus = "checking" | "authorized" | "unauthorized";

export function useAuthGuard() {
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    let active = true;
    async function run() {
      if (!hasValidLocalAuth()) {
        if (active) setStatus("unauthorized");
        return;
      }
      const ok = await verifyTokenRemote();
      if (active) setStatus(ok ? "authorized" : "unauthorized");
    }
    run();
    return () => {
      active = false;
    };
  }, []);

  return status;
}
