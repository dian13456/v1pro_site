import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestUsbAndAuthorize } from "../api/auth";

export default function AuthPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleVerify = async () => {
    try {
      setLoading(true);
      setError("");
      await requestUsbAndAuthorize();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err?.message || "未检测到授权设备");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-100 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="glass-card w-full max-w-md rounded-3xl p-8 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.26em] text-brand-500">USB Authentication</p>
        <h1 className="text-3xl font-semibold">请连接设备进行验证</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          仅支持 VID: 0x0483 / PID: 0x66AA 的 WinUSB 授权设备。
        </p>
        <button
          type="button"
          onClick={handleVerify}
          disabled={loading}
          className="mt-8 w-full rounded-2xl bg-slate-900 px-4 py-3 text-white transition hover:bg-slate-700 disabled:opacity-70 dark:bg-white dark:text-slate-900"
        >
          {loading ? "验证中..." : "验证设备"}
        </button>
        {error ? <p className="mt-4 text-sm text-rose-500">{error}</p> : null}
      </div>
    </div>
  );
}
