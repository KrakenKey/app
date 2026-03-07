import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, MobileMenuButton } from '../components/Sidebar';

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto">
        <MobileMenuButton onClick={() => setSidebarOpen(true)} />
        <div className="max-w-5xl mx-auto px-6 py-8 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
