import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HomePage, ActivityPage, LoginPage, MetricsPage, RepoMetricsPage, DependenciesPage, AlertsPage, InboxPage, EmbedsPage, StatusPage, PolicyPage, SearchPage } from './pages';
import { SetupPage } from './pages/SetupPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProtectedRoute } from './components/templates/ProtectedRoute';
import { fetchSetupStatus } from './lib/setup';
import { isAuthenticated, setAuthDisabled } from './lib/auth';
import { AppNav } from './components/organisms/AppNav';
import { setDemo } from './lib/demo';
import { DemoBanner } from './components/molecules/DemoBanner';

/** Sends the visitor to the first-run wizard while the server is not configured. */
function useSetupRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const latestLocation = useRef(location);
  latestLocation.current = location;

  useEffect(() => {
    if (pathname === '/setup') return undefined;
    let active = true;
    fetchSetupStatus().then((status) => {
      if (!active) return;
      if (status.demo) setDemo(status.demo);
      if (!status.configured) {
        navigate('/setup', { replace: true });
      } else if (status.authRequired === false) {
        // The server does not ask for sign-in: do not show a login screen nobody can pass.
        setAuthDisabled(true);
        const current = latestLocation.current;
        if (current.pathname === '/login') navigate(current.state?.from || '/', { replace: true });
      }
    });
    return () => { active = false; };
    // Checked once on load: the server leaves setup mode for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Pages that stand alone: before signing in, and the public status page. */
const BARE_PATHS = ['/login', '/setup', '/status'];

function App() {
  useSetupRedirect();
  const { pathname } = useLocation();
  // The shell (navigation) wraps every page a signed-in person uses.
  const shell = !BARE_PATHS.includes(pathname) && isAuthenticated();

  const routes = (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/health" element={<Navigate to="/" replace />} />
      <Route path="/activity" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>} />
      <Route path="/metrics" element={<ProtectedRoute><MetricsPage /></ProtectedRoute>} />
      <Route path="/metrics/:owner/:repo" element={<ProtectedRoute><RepoMetricsPage /></ProtectedRoute>} />
      <Route path="/dependencies" element={<ProtectedRoute><DependenciesPage /></ProtectedRoute>} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/embeds" element={<ProtectedRoute><EmbedsPage /></ProtectedRoute>} />
      <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
      <Route path="/policy" element={<ProtectedRoute><PolicyPage /></ProtectedRoute>} />
      <Route path="/inbox" element={<ProtectedRoute><InboxPage /></ProtectedRoute>} />
      <Route path="/alerts" element={<ProtectedRoute><AlertsPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/services" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <>
      <DemoBanner />
      {shell ? (
        <div className="relative flex h-screen flex-col bg-gray-50 md:flex-row">
          <AppNav />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{routes}</div>
        </div>
      ) : routes}
    </>
  );
}

export default App;
