import { useState } from "react";
import { SiteButton, SiteInput, SitePanel, SiteSectionTitle } from "./SiteUi";
import { loginAdmin } from "../services/adminAuthService";

type AdminLoginPanelProps = {
  title?: string;
  description?: string;
  onLoggedIn: () => void;
};

export function AdminLoginPanel({
  title = "管理员登录",
  description = "请输入后台密码进入管理页面。",
  onLoggedIn,
}: AdminLoginPanelProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = async () => {
    if (!password.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    try {
      await loginAdmin(password);
      setPassword("");
      onLoggedIn();
    } catch (err) {
      setErrorMessage((err as Error)?.message || "登录失败，请检查密码");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SitePanel>
      <SiteSectionTitle title={title} description={description} />
      <div className="mt-3 flex flex-wrap gap-2">
        <SiteInput
          className="min-w-[240px] flex-1"
          type="password"
          autoComplete="current-password"
          placeholder="管理员密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void handleLogin();
            }
          }}
        />
        <SiteButton type="button" disabled={!password.trim() || submitting} onClick={() => void handleLogin()}>
          {submitting ? "验证中…" : "进入后台"}
        </SiteButton>
      </div>
      {errorMessage ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p> : null}
    </SitePanel>
  );
}
