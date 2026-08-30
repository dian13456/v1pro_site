import { Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SiteLoadingScreen } from "./components/SiteUi";
import { useAuthGuard } from "./hooks/useAuthGuard";
import { GlobalTransferTaskCenter } from "./components/GlobalTransferTaskCenter";
import { lazyWithRetry } from "./utils/lazyWithRetry";

const AiGuidePage = lazyWithRetry(() => import("./pages/AiGuidePage"));
const AiImagePage = lazyWithRetry(() => import("./pages/AiImagePage"));
const SharePage = lazyWithRetry(() => import("./pages/SharePage"));
const AuthPage = lazyWithRetry(() => import("./pages/AuthPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const ShopPage = lazyWithRetry(() => import("./pages/ShopPage"));
const MallPage = lazyWithRetry(() => import("./pages/MallPage"));
const MallAdminPage = lazyWithRetry(() => import("./pages/MallAdminPage"));
const FavoritesPage = lazyWithRetry(() => import("./pages/FavoritesPage"));
const MessageBoardPage = lazyWithRetry(() => import("./pages/MessageBoardPage"));
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"));
const ResourcesPage = lazyWithRetry(() => import("./pages/ResourcesPage"));
const ActivityCenterPage = lazyWithRetry(() => import("./pages/ActivityCenterPage"));
const ActivityLotteryPage = lazyWithRetry(() => import("./pages/ActivityLotteryPage"));
const ActivityPrizeInfoPage = lazyWithRetry(() => import("./pages/ActivityPrizeInfoPage"));
const ActivityWinnerListPage = lazyWithRetry(() => import("./pages/ActivityWinnerListPage"));
const ActivityAdminPage = lazyWithRetry(() => import("./pages/ActivityAdminPage"));
const ActivityPromoPage = lazyWithRetry(() => import("./pages/ActivityPromoPage"));
const ActivityPromoAdminPage = lazyWithRetry(() => import("./pages/ActivityPromoAdminPage"));
const DownloadCenterPage = lazyWithRetry(() => import("./pages/DownloadCenterPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const WebUsbTransferTestPage = lazyWithRetry(() => import("./pages/WebUsbTransferTestPage"));
const CreatorPage = lazyWithRetry(() => import("./pages/CreatorPage"));
const CreditLeaderboardPage = lazyWithRetry(() => import("./pages/CreditLeaderboardPage"));

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
      <GlobalTransferTaskCenter />
      <Suspense fallback={<SiteLoadingScreen message="正在加载页面…" />}>
        <Routes location={location}>
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/"
            element={<ResourcesPage />}
          />
          <Route path="/admin/materials" element={<ResourcesPage adminMode />} />
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
            element={<ActivityCenterPage />}
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
