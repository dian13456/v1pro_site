import { Link } from "react-router-dom";
import { V1PRO_SETUP_DOWNLOAD_URL } from "../config/v1proProtocol";
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
      <p className="mt-2">
        传输到设备需
        <a
          href={V1PRO_SETUP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300"
        >
          安装佳点 V1PRO 控制工具
        </a>
      </p>
    </footer>
  );
}
