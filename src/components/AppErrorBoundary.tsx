import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  manuallyRetryPageLoad,
  reloadOnceForDynamicImportError,
} from "../utils/dynamicImportRecovery";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (reloadOnceForDynamicImportError(error)) {
      return;
    }
    console.error("Uncaught application error", error, info.componentStack);
  }

  private reload = (): void => {
    manuallyRetryPageLoad();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-6 text-[#20253a]">
        <section className="w-full max-w-md rounded-2xl border border-[#dfe4ef] bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-bold">页面加载失败</h1>
          <p className="mt-3 text-sm leading-6 text-[#667085]">可能是网络波动或网站刚完成更新，请重新加载。</p>
          <button
            type="button"
            onClick={this.reload}
            className="mt-6 rounded-xl bg-[#5f6df8] px-5 py-2.5 text-sm font-semibold text-white"
          >
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
