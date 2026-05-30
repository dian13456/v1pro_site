import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="text-center">
        <h1 className="text-5xl font-semibold">404</h1>
        <p className="mt-3 text-slate-400">页面不存在</p>
        <Link to="/" className="mt-6 inline-block rounded-full bg-white px-6 py-2 text-sm text-slate-900">
          返回资源中心
        </Link>
      </div>
    </div>
  );
}
