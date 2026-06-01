import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TermsAgreementModal } from "./components/TermsAgreementModal";
import { WelcomeModal } from "./components/WelcomeModal";
import { useAuthGuard } from "./hooks/useAuthGuard";
import AiGuidePage from "./pages/AiGuidePage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import MessageBoardPage from "./pages/MessageBoardPage.tsx";
import NotFoundPage from "./pages/NotFoundPage.tsx";
import ResourcesPage from "./pages/ResourcesPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";
import { getAuthState } from "./services/authService";
import { acceptTerms, hasAcceptedTerms } from "./services/termsService";

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
  const serial = getAuthState()?.serial || "";
  const [termsAccepted, setTermsAccepted] = useState(() => hasAcceptedTerms(serial));

  useEffect(() => {
    const currentSerial = getAuthState()?.serial || "";
    if (hasAcceptedTerms(currentSerial)) {
      setTermsAccepted(true);
    }
  }, [location.pathname, serial]);

  const showTermsModal =
    !termsAccepted && location.pathname !== "/auth" && location.pathname !== "/terms";
  const showWelcomeModal =
    termsAccepted && location.pathname !== "/auth" && location.pathname !== "/terms";

  const handleTermsAccepted = () => {
    acceptTerms(getAuthState()?.serial || serial || undefined);
    setTermsAccepted(true);
  };

  return (
    <>
      {showTermsModal ? <TermsAgreementModal serial={serial} onAccepted={handleTermsAccepted} /> : null}
      {showWelcomeModal ? <WelcomeModal /> : null}
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
