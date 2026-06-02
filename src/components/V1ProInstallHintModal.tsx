import { V1PRO_SETUP_DOWNLOAD_URL } from "../config/v1proProtocol";

interface V1ProInstallHintModalProps {
  onClose: () => void;
}

export function V1ProInstallHintModal({ onClose }: V1ProInstallHintModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="v1pro-install-title"
        className="w-full max-w-md rounded-3xl border border-white/20 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900"
      >
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-500">V1PRO Control Tool</p>
        <h2 id="v1pro-install-title" className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
          未检测到控制工具
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          「传输到设备」需要安装佳点 V1PRO 控制工具。安装后请重新点击传输，浏览器会通过{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">v1pro://</code>{" "}
          唤起客户端，自动下载并推送到已连接的 USB 设备。
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <a
            href={V1PRO_SETUP_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl bg-cyan-600 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-cyan-500"
          >
            下载 Setup 安装包
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
