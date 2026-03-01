import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Home from './pages/Home';
import Callback from './pages/Callback';
import Dashboard from './pages/Dashboard';
import './App.css';

/**
 * A wrapper component to protect routes that require authentication.
 * Checks if the user is authenticated; if not, redirects to the home page.
 * Shows a loading state while authentication status is being determined.
 */
const ProtectedRoute = ({ children }: { children: { } & ReactNode }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  
  console.log("🛡️ ProtectedRoute check:", { isAuthenticated, isLoading, hasUser: !!user });
  
  if (isLoading) {
    console.log("⏳ ProtectedRoute: Still loading...");
    return <div>Loading...</div>;
  }
  
  if (!isAuthenticated) {
    console.log("❌ ProtectedRoute: Not authenticated, redirecting to home");
    return <Navigate to="/" replace />;
  }
  
  console.log("✅ ProtectedRoute: Authenticated, rendering protected content");
  return children;
};

/**
 * Defines the application's routing structure.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<Callback />} />
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
    </Routes>
  );
}

/**
 * Main App Component.
 * Sets up the Router and AuthProvider context.
 */
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
