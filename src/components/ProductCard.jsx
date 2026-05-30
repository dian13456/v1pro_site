import { Link } from "react-router-dom";

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(date));
}

export default function ProductCard({ product }) {
  return (
    <Link
      to={`/product/${product.id}`}
      className="group glass-card reveal-card block overflow-hidden rounded-3xl transition hover:-translate-y-1"
    >
      <div className="aspect-[16/9] overflow-hidden">
        <img
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      </div>
      <div className="space-y-2 p-5">
        <h3 className="text-xl font-semibold">{product.name}</h3>
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 dark:text-slate-300">
          <p>版本：{product.version}</p>
          <p>发布日期：{formatDate(product.publishDate)}</p>
          <p className="col-span-2">下载次数：{product.downloads.toLocaleString("zh-CN")}</p>
        </div>
      </div>
    </Link>
  );
}
