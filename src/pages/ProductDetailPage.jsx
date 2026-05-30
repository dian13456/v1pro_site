import { Link, Navigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import DownloadItem from "../components/DownloadItem";
import { products } from "../assets/products";

export default function ProductDetailPage() {
  const { id } = useParams();
  const product = products.find((item) => item.id === id);

  if (!product) {
    return <Navigate to="/" replace />;
  }

  return (
    <Layout
      title={product.name}
      subtitle={`当前版本 ${product.version} · ${product.publishDate}`}
      rightSlot={
        <Link to="/" className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm backdrop-blur">
          返回首页
        </Link>
      }
    >
      <article className="space-y-8">
        <section className="glass-card overflow-hidden rounded-3xl">
          <img src={product.image} alt={product.name} className="h-72 w-full object-cover" />
          <div className="p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-brand-500">Resource Package</p>
            <h2 className="mt-2 text-2xl font-semibold">{product.name}</h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">{product.description}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xl font-semibold">资源下载</h3>
          {product.resources.map((resource) => (
            <DownloadItem key={resource.type} productId={product.id} resource={resource} />
          ))}
        </section>
      </article>
    </Layout>
  );
}
