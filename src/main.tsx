import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { applyThemeToDocument, getInitialTheme } from "./hooks/useThemeMode";
import "./index.css";
import "./styles/theme.css";
import { I18nProvider } from "./i18n";

applyThemeToDocument(getInitialTheme());
// Clear stale scroll locks left by an interrupted modal render or hot reload.
document.body.style.removeProperty("overflow");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <HashRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </HashRouter>
    </I18nProvider>
  </React.StrictMode>
);
