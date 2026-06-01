import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { TERMS_SECTIONS, TERMS_TITLE } from "../content/termsOfUse";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-6">
        <div className="mb-6">
          <Link
            to="/auth"
            className="text-sm text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
          >
            返回
          </Link>
        </div>

        <article className="rounded-3xl border border-white/25 bg-white/70 p-6 backdrop-blur dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-500">Legal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{TERMS_TITLE}</h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            生效说明：访问或使用本站即视为同意以下条款。本站已通过 robots.txt、页面 meta 标签及 API 响应头声明禁止爬取。
          </p>

          <div className="mt-8 space-y-6">
            {TERMS_SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{section.title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">{section.body}</p>
              </section>
            ))}
          </div>
        </article>

        <SiteFooter />
      </div>
    </div>
  );
}
