import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { SITE_PAGE_CONTAINER_CLASS } from "./SitePageShell";

export const SITE_CONTENT_DEFAULT = "space-y-5";
export const SITE_CONTENT_NARROW = "mx-auto w-full max-w-3xl space-y-5";
export const SITE_CONTENT_MEDIUM = "mx-auto w-full max-w-4xl space-y-5";

export const SITE_CHAT_USER_CLASS =
  "max-w-[760px] rounded-2xl bg-cyan-600 px-4 py-3 text-sm leading-6 text-white shadow-sm shadow-cyan-500/20";

export const SITE_CHAT_ASSISTANT_CLASS =
  "max-w-[760px] rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200";

export const SITE_PANEL_CLASS =
  "site-panel-surface rounded-[28px] border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 sm:p-6";

export const SITE_PANEL_ACCENT_CLASS =
  "rounded-3xl border border-violet-200/60 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 p-5 dark:border-violet-500/20";

export const SITE_PANEL_NESTED_CLASS =
  "rounded-2xl border border-white/30 bg-white/70 dark:border-white/10 dark:bg-slate-950/50";

export const SITE_INPUT_CLASS =
  "w-full rounded-[14px] border border-black/[.07] bg-white/75 px-4 py-3 text-sm outline-none ring-[#0071e3]/15 transition focus:border-[#0071e3]/35 focus:bg-white focus:ring-4 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";

export const SITE_TEXTAREA_CLASS = `${SITE_INPUT_CLASS} resize-y`;

export const SITE_BTN_PRIMARY =
  "site-btn-primary rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60";

export const SITE_BTN_SECONDARY =
  "rounded-full border border-black/[.06] bg-white/70 px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[.06] dark:text-slate-100 dark:hover:bg-white/[.1]";

export const SITE_BTN_SUCCESS =
  "rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60";

export const SITE_CHIP_CLASS =
  "rounded-full border border-violet-200/70 bg-violet-50/80 px-4 py-2 text-sm text-violet-800 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200";

export const SITE_CHIP_CYAN_CLASS =
  "rounded-full border border-cyan-200/70 bg-cyan-50/80 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-60 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200";

export const SITE_FILTER_CHIP_ACTIVE =
  "rounded-full bg-[#0071e3] px-4 py-2 text-sm font-medium text-white shadow-md shadow-[#0071e3]/20";

export const SITE_FILTER_CHIP_IDLE =
  "rounded-full border border-black/[.055] bg-white/60 px-4 py-2 text-sm text-slate-700 shadow-sm backdrop-blur-xl transition hover:bg-white dark:border-white/10 dark:bg-white/[.055] dark:text-slate-200 dark:hover:bg-white/[.1]";

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

interface SitePanelProps {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}

export function SitePanel({ children, className, accent }: SitePanelProps) {
  return (
    <section className={joinClasses(accent ? SITE_PANEL_ACCENT_CLASS : SITE_PANEL_CLASS, className)}>
      {children}
    </section>
  );
}

type SiteAlertVariant = "success" | "error" | "info";

const ALERT_STYLES: Record<SiteAlertVariant, string> = {
  success:
    "border-emerald-200/70 bg-emerald-50/90 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  error:
    "border-rose-200/70 bg-rose-50/90 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
  info: "border-cyan-200/70 bg-cyan-50/90 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200",
};

export function SiteAlert({
  variant,
  children,
  className,
}: {
  variant: SiteAlertVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={joinClasses("rounded-2xl border px-4 py-3 text-sm", ALERT_STYLES[variant], className)}>
      {children}
    </div>
  );
}

export function SiteSectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function SiteLabel({ children }: { children: ReactNode }) {
  return <label className="text-sm text-slate-600 dark:text-slate-300">{children}</label>;
}

export function SiteInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={joinClasses(SITE_INPUT_CLASS, props.className)} />;
}

export function SiteTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={joinClasses(SITE_TEXTAREA_CLASS, props.className)} />;
}

export function SiteSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={joinClasses(SITE_INPUT_CLASS, props.className)} />;
}

export function SiteMediaPreview({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "overflow-hidden rounded-2xl border border-white/30 bg-white/70 dark:border-white/10 dark:bg-slate-950/50",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SiteCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <article className={joinClasses(SITE_PANEL_CLASS, className)}>{children}</article>;
}

export function SiteLoadingScreen({ message = "正在加载…" }: { message?: string }) {
  return (
    <div className="site-page-shell min-h-screen text-slate-900 dark:text-slate-100">
      <div className={`${SITE_PAGE_CONTAINER_CLASS} flex min-h-screen items-center justify-center pb-8`}>
        <SiteLoadingBlock>{message}</SiteLoadingBlock>
      </div>
    </div>
  );
}

export function SiteButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "success" }) {
  const variantClass =
    variant === "secondary" ? SITE_BTN_SECONDARY : variant === "success" ? SITE_BTN_SUCCESS : SITE_BTN_PRIMARY;
  return <button {...props} className={joinClasses(variantClass, className)} />;
}

export function SiteChipButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { cyan?: boolean }) {
  const { cyan, className, ...rest } = props;
  return (
    <button
      {...rest}
      className={joinClasses(cyan ? SITE_CHIP_CYAN_CLASS : SITE_CHIP_CLASS, className)}
    />
  );
}

export function SiteFilterChip({
  active,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={joinClasses(active ? SITE_FILTER_CHIP_ACTIVE : SITE_FILTER_CHIP_IDLE, className)}
    >
      {children}
    </button>
  );
}

export function SiteLoadingBlock({ children = "加载中…" }: { children?: ReactNode }) {
  return (
    <div className="site-loading-surface rounded-[28px] border border-white/25 bg-white/55 p-8 text-center text-sm text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-300">
      {children}
    </div>
  );
}

export function SiteEmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="site-loading-surface rounded-[28px] border border-white/25 bg-white/55 p-8 text-center text-sm text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-300">
      {children}
    </div>
  );
}
