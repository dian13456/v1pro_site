import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SiteLoadingScreen } from "./components/SiteUi";
import { useAuthGuard } from "./hooks/useAuthGuard";

const AiGuidePage = lazy(() => import("./pages/AiGuidePage"));
const AiImagePage = lazy(() => import("./pages/AiImagePage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ShopPage = lazy(() => import("./pages/ShopPage"));
const MallPage = lazy(() => import("./pages/MallPage"));
const MallAdminPage = lazy(() => import("./pages/MallAdminPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const MessageBoardPage = lazy(() => import("./pages/MessageBoardPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const ResourcesPage = lazy(() => import("./pages/ResourcesPage"));
const ActivityCenterPage = lazy(() => import("./pages/ActivityCenterPage"));
const ActivityLotteryPage = lazy(() => import("./pages/ActivityLotteryPage"));
const ActivityPrizeInfoPage = lazy(() => import("./pages/ActivityPrizeInfoPage"));
const ActivityWinnerListPage = lazy(() => import("./pages/ActivityWinnerListPage"));
const ActivityAdminPage = lazy(() => import("./pages/ActivityAdminPage"));
const ActivityPromoPage = lazy(() => import("./pages/ActivityPromoPage"));
const ActivityPromoAdminPage = lazy(() => import("./pages/ActivityPromoAdminPage"));
const DownloadCenterPage = lazy(() => import("./pages/DownloadCenterPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const WebUsbTransferTestPage = lazy(() => import("./pages/WebUsbTransferTestPage"));
const CreatorPage = lazy(() => import("./pages/CreatorPage"));
const CreditLeaderboardPage = lazy(() => import("./pages/CreditLeaderboardPage"));

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

  return (
    <>
      <Suspense fallback={<SiteLoadingScreen message="正在加载页面…" />}>
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
            path="/mall"
            element={
              <ProtectedRoute>
                <MallPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mall/admin"
            element={
              <ProtectedRoute>
                <MallAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities"
            element={
              <ProtectedRoute>
                <ActivityCenterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/creator/:author"
            element={
              <ProtectedRoute>
                <CreatorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/downloads"
            element={
              <ProtectedRoute>
                <DownloadCenterPage />
              </ProtectedRoute>
            }
          />
          <Route path="/activity" element={<Navigate to="/activities/lottery" replace />} />
          <Route
            path="/activities/lottery"
            element={
              <ProtectedRoute>
                <ActivityLotteryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/prize-info"
            element={
              <ProtectedRoute>
                <ActivityPrizeInfoPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/winners"
            element={
              <ProtectedRoute>
                <ActivityWinnerListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/admin"
            element={
              <ProtectedRoute>
                <ActivityAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/promo"
            element={
              <ProtectedRoute>
                <ActivityPromoPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/promo-admin"
            element={
              <ProtectedRoute>
                <ActivityPromoAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <ProtectedRoute>
                <CreditLeaderboardPage />
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
          <Route
            path="/webusb-test"
            element={
              <ProtectedRoute>
                <WebUsbTransferTestPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
