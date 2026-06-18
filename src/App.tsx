import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { WelcomeModal } from "./components/WelcomeModal";
import { useAuthGuard } from "./hooks/useAuthGuard";
import AiGuidePage from "./pages/AiGuidePage.tsx";
import AiImagePage from "./pages/AiImagePage.tsx";
import GifUploadPage from "./pages/GifUploadPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import ShopPage from "./pages/ShopPage.tsx";
import FavoritesPage from "./pages/FavoritesPage.tsx";
import MessageBoardPage from "./pages/MessageBoardPage.tsx";
import NotFoundPage from "./pages/NotFoundPage.tsx";
import ResourcesPage from "./pages/ResourcesPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";

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
  const showWelcomeModal = location.pathname !== "/auth" && location.pathname !== "/terms";

  return (
    <>
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
          path="/favorites"
          element={
            <ProtectedRoute>
              <FavoritesPage />
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
        <Route
          path="/ai-image"
          element={
            <ProtectedRoute>
              <AiImagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload-gif"
          element={
            <ProtectedRoute>
              <GifUploadPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shop"
          element={
            <ProtectedRoute>
              <ShopPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
