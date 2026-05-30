export default function Hero() {
  return (
    <section className="glass-card relative overflow-hidden rounded-3xl p-8 md:p-12">
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
      <div className="relative max-w-2xl">
        <p className="mb-3 inline-flex rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs text-brand-600 dark:text-brand-200">
          仅授权设备可访问
        </p>
        <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">
          高端产品资源下载中心
          <br />
          佳点 HUB 资源中心
        </h2>
        <p className="mt-4 text-base text-slate-600 dark:text-slate-300">
          Apple / Nothing / Linear 风格界面，结合 WebUSB 设备认证和 Worker 动态签名下载，保护每个资源文件。
        </p>
      </div>
    </section>
  );
}
