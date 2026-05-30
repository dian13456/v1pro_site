import { useState } from "react";
import { requestSignedDownload } from "../api/download";
import { hasValidLocalAuth, verifyTokenRemote } from "../api/auth";

const typeMap = {
  firmware: "固件",
  driver: "驱动",
  software: "软件",
  manual: "说明书",
};

export default function DownloadItem({ productId, resource }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleDownload = async () => {
    if (!hasValidLocalAuth()) {
      setMessage("设备认证已失效，禁止下载");
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      const tokenValid = await verifyTokenRemote();
      if (!tokenValid) {
        throw new Error("token 已过期，请重新验证设备");
      }
      const result = await requestSignedDownload(productId, resource.type);
      if (!result?.success || !result?.url) {
        throw new Error("签名链接获取失败");
      }
      window.location.href = result.url;
    } catch (error) {
      setMessage(error.message || "下载失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
      <div>
        <p className="text-base font-medium">
          {resource.label} · {typeMap[resource.type] || resource.type}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">大小：{resource.size}</p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900"
      >
        {loading ? "签名中..." : "下载资源"}
      </button>
      {message ? <p className="w-full text-sm text-rose-500">{message}</p> : null}
    </div>
  );
}
