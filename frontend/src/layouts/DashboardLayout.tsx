import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar, MobileTopBar } from '../components/Sidebar';
import { HealthProvider } from '../context/HealthContext';
import { useHealth } from '../hooks/useHealth';

/** Refreshes the health counts when the user moves between pages. */
function HealthOnNavigate() {
  const { pathname } = useLocation();
  const { refresh } = useHealth();
  useEffect(() => {
    refresh(20_000);
  }, [pathname, refresh]);
  return null;
}

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <HealthProvider>
      <HealthOnNavigate />
      <div className="flex h-screen bg-bg">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <MobileTopBar onMenu={() => setSidebarOpen(true)} />
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9 2xl:px-12">
            <Outlet />
          </div>
        </main>
      </div>
    </HealthProvider>
  );
}
