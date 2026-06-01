import { useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TermsAgreementModal } from "./components/TermsAgreementModal";
import { useAuthGuard } from "./hooks/useAuthGuard";
import AiGuidePage from "./pages/AiGuidePage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import MessageBoardPage from "./pages/MessageBoardPage.tsx";
import NotFoundPage from "./pages/NotFoundPage.tsx";
import ResourcesPage from "./pages/ResourcesPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";
import { hasAcceptedTerms } from "./services/termsService";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useAuthGuard();

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        正在验证访问权限...
      </div>
    );
  }

  if (status === "unauthorized") {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  const [termsAccepted, setTermsAccepted] = useState(hasAcceptedTerms);
  const showTermsModal = !termsAccepted && location.pathname !== "/terms";

  return (
    <>
      {showTermsModal ? <TermsAgreementModal onAccepted={() => setTermsAccepted(true)} /> : null}
      <Routes>
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ResourcesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/board"
          element={
            <ProtectedRoute>
              <MessageBoardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/guide"
          element={
            <ProtectedRoute>
              <AiGuidePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
