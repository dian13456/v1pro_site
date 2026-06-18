import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SitePageShell } from "../components/SitePageShell";
import { SitePanel } from "../components/SiteUi";
import { TERMS_SECTIONS, TERMS_TITLE } from "../content/termsOfUse";

export default function TermsPage() {
  return (
    <SitePageShell>
      <div className="mx-auto max-w-[760px] space-y-6">
        <Link
          to="/auth"
          className="inline-block text-sm text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
        >
          返回
        </Link>

        <SitePanel className="sm:p-8">
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
        </SitePanel>

        <SiteFooter />
      </div>
    </SitePageShell>
  );
}
