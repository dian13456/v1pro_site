import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestUsbAndAuthorize } from "../services/authService";

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
      setError((err as Error)?.message || "未检测到授权设备");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(56,189,248,0.28),transparent_45%),radial-gradient(circle_at_80%_22%,rgba(59,130,246,0.25),transparent_42%),radial-gradient(circle_at_70%_80%,rgba(168,85,247,0.2),transparent_40%)]" />
      <div className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-white/8 p-8 text-center shadow-2xl backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">USB Authentication</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">请连接设备进行验证</h1>
        <p className="mt-3 text-sm text-slate-200">
          仅允许 VID: 0x0483 / PID: 0x66AA。建议使用 Edge/Chrome 并通过 localhost 访问。
        </p>

        <button
          type="button"
          onClick={handleVerify}
          disabled={loading}
          className="mt-8 w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-200 disabled:opacity-60"
        >
          {loading ? "验证中..." : "验证设备"}
        </button>

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </div>
    </div>
  );
}
