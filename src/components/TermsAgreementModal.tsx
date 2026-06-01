import { useState } from "react";
import { Link } from "react-router-dom";
import { TERMS_TITLE } from "../content/termsOfUse";

interface TermsAgreementModalProps {
  serial?: string;
  onAccepted: () => void;
}

export function TermsAgreementModal({ onAccepted }: TermsAgreementModalProps) {
  const [checked, setChecked] = useState(false);

  const handleAccept = () => {
    if (!checked) return;
    onAccepted();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-modal-title"
        className="w-full max-w-lg rounded-3xl border border-white/20 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900"
      >
        <p className="text-xs uppercase tracking-[0.24em] text-violet-500">Terms of Use</p>
        <h2 id="terms-modal-title" className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
          使用前请阅读并同意
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          继续使用佳点 HUB，即表示您同意遵守
          <Link to="/terms" className="mx-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
            {TERMS_TITLE}
          </Link>
          。本站禁止未经授权的爬取、自动化抓取、批量下载及二次分发。
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-violet-200/70 bg-violet-50/70 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm leading-6 text-slate-700 dark:text-slate-200">
            我已阅读并同意上述条款，承诺不进行爬取、批量下载或未经授权的内容使用。
          </span>
        </label>

        <button
          type="button"
          disabled={!checked}
          onClick={handleAccept}
          className="mt-5 w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          同意并继续
        </button>
      </div>
    </div>
  );
}
