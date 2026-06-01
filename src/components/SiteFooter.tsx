import { Link } from "react-router-dom";
import { TERMS_TITLE } from "../content/termsOfUse";

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-white/20 pt-6 text-center text-xs text-slate-500 dark:text-slate-400">
      <p>
        本站内容受保护，禁止未经授权的爬取、抓取与批量下载。
        <Link to="/terms" className="ml-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
          查看{TERMS_TITLE}
        </Link>
      </p>
    </footer>
  );
}
