import ModeToggle from "./ModeToggle";

export default function Layout({ title, subtitle, children, rightSlot }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="glass-card sticky top-4 z-20 mb-8 flex items-center justify-between gap-4 rounded-3xl px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-brand-500">JiaDian HUB</p>
            <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {rightSlot}
            <ModeToggle />
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
