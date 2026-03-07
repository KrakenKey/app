import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DomainsProvider } from './context/DomainsContext';
import { DashboardLayout } from './layouts/DashboardLayout';
import Home from './pages/Home';
import Callback from './pages/Callback';
import Overview from './pages/Overview';
import Settings from './pages/Settings';
import DomainManagement from './components/DomainManagement';
import CertificateManagement from './components/CertificateManagement';
import ApiKeyManagement from './components/ApiKeyManagement';
import Feedback from './components/Feedback';

const ProtectedRoute = ({ children }: { children: { } & ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<Callback />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DomainsProvider>
              <DashboardLayout />
            </DomainsProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Overview />} />
        <Route path="domains" element={<DomainManagement />} />
        <Route path="certificates" element={<CertificateManagement />} />
        <Route path="api-keys" element={<ApiKeyManagement />} />
        <Route path="feedback" element={<Feedback />} />
      </Route>
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Settings />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
