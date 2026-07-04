import { type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LatestSoftwareModal } from "./components/LatestSoftwareModal";
import { SitePageTransition } from "./components/SitePageTransition";
import { SiteLoadingScreen } from "./components/SiteUi";
import { useAuthGuard } from "./hooks/useAuthGuard";
import AiGuidePage from "./pages/AiGuidePage.tsx";
import AiImagePage from "./pages/AiImagePage.tsx";
import SharePage from "./pages/SharePage.tsx";
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
    return <SiteLoadingScreen message="正在验证访问权限…" />;
  }

  if (status === "unauthorized") {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  const showFirstVisitPrompts = location.pathname !== "/auth" && location.pathname !== "/terms";

  return (
    <>
      {showFirstVisitPrompts ? <LatestSoftwareModal /> : null}
      <SitePageTransition routeKey={location.pathname}>
        <Routes location={location}>
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
            path="/share"
            element={
              <ProtectedRoute>
                <SharePage />
              </ProtectedRoute>
            }
          />
          <Route path="/upload-gif" element={<Navigate to="/share" replace />} />
          <Route path="/upload-video" element={<Navigate to="/share" replace />} />
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
      </SitePageTransition>
    </>
  );
}
