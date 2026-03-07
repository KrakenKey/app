import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Globe,
  Shield,
  Key,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/dashboard/domains', icon: Globe, label: 'Domains' },
  { to: '/dashboard/certificates', icon: Shield, label: 'Certificates' },
  { to: '/dashboard/api-keys', icon: Key, label: 'API Keys' },
  { to: '/dashboard/feedback', icon: MessageSquare, label: 'Feedback' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
  };

  const handleNavClick = () => {
    onClose();
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="px-5 py-6 flex items-center justify-between">
          <button
            onClick={() => { navigate('/dashboard'); onClose(); }}
            className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none"
          >
            <img src="/favicon.svg" alt="" className="w-7 h-7" />
            <span className="text-lg font-bold text-zinc-100 tracking-tight">KrakenKey</span>
          </button>
          <button
            onClick={onClose}
            className="lg:hidden text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer bg-transparent border-none"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="flex-1 px-3">
          <ul className="flex flex-col gap-0.5">
            {navItems.map(({ to, icon: Icon, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'text-zinc-100 bg-zinc-800/50 border-l-2 border-accent -ml-px'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User section */}
        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-medium text-zinc-300">
              {user?.username?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200 truncate">{user?.displayName || user?.username}</p>
              <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/settings"
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 flex-1 ${
                  isActive
                    ? 'text-zinc-100 bg-zinc-800'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`
              }
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </NavLink>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors duration-150 cursor-pointer bg-transparent border-none"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed top-4 left-4 z-30 lg:hidden bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer shadow-lg"
      aria-label="Open menu"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}
