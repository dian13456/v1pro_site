import { useCallback, useState } from "react";
import { clearAdminSession, getAdminToken, isAdminLoggedIn } from "../services/adminAuthService";

export function useAdminSession() {
  const [adminToken, setAdminToken] = useState(() => getAdminToken());
  const [authenticated, setAuthenticated] = useState(() => isAdminLoggedIn());

  const refreshSession = useCallback(() => {
    const token = getAdminToken();
    setAdminToken(token);
    setAuthenticated(token !== "");
  }, []);

  const logout = useCallback(() => {
    clearAdminSession();
    setAdminToken("");
    setAuthenticated(false);
  }, []);

  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  return {
    adminToken,
    authenticated,
    refreshSession,
    logout,
    handleUnauthorized,
  };
}
