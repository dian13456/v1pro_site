import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import Hero from "../components/Hero";
import ProductCard from "../components/ProductCard";
import { clearAuthState } from "../api/auth";
import { products } from "../assets/products";

export default function HomePage() {
  const navigate = useNavigate();

  const logout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  return (
    <Layout
      title="佳点 HUB 资源中心"
      subtitle="设备认证通过后可访问固件、驱动、软件与说明书资源"
      rightSlot={
        <button
          type="button"
          onClick={logout}
          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm backdrop-blur"
        >
          退出认证
        </button>
      }
    >
      <Hero />
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </section>
    </Layout>
  );
}
