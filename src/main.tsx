import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { applyThemeToDocument, getInitialTheme } from "./hooks/useThemeMode";
import "./index.css";
import "./styles/theme.css";

applyThemeToDocument(getInitialTheme());
// Clear stale scroll locks left by an interrupted modal render or hot reload.
document.body.style.removeProperty("overflow");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </HashRouter>
  </React.StrictMode>
);
