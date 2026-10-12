import { NavLink, Link, useNavigate } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  Globe,
  Shield,
  Key,
  CreditCard,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  Building2,
  Activity,
  FileBarChart,
  Plug,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useHealth } from '../hooks/useHealth';
import {
  greetingName,
  type AreaCount,
  type HealthArea,
} from '../utils/accountHealth';

interface NavItem {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  area?: HealthArea;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Overview', end: true },
      {
        to: '/dashboard/endpoints',
        icon: Activity,
        label: 'Endpoints',
        area: 'endpoints',
      },
      { to: '/dashboard/reports', icon: FileBarChart, label: 'Reports' },
    ],
  },
  {
    label: 'Certificates',
    items: [
      {
        to: '/dashboard/domains',
        icon: Globe,
        label: 'Domains',
        area: 'domains',
      },
      {
        to: '/dashboard/certificates',
        icon: Shield,
        label: 'Certificates',
        area: 'certificates',
      },
      {
        to: '/dashboard/connectors',
        icon: Plug,
        label: 'Connectors',
        area: 'connectors',
      },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/dashboard/api-keys', icon: Key, label: 'API Keys' },
      {
        to: '/dashboard/organizations',
        icon: Building2,
        label: 'Organization',
      },
      { to: '/dashboard/billing', icon: CreditCard, label: 'Billing' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

const PLAN_LABEL: Record<string, string> = {
  free: 'Free plan',
  starter: 'Starter plan',
  team: 'Team plan',
  business: 'Business plan',
  enterprise: 'Enterprise plan',
};

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function AttentionCount({ area }: { area: AreaCount }) {
  if (area.count === 0) return null;
  const tone =
    area.severity === 'critical'
      ? 'bg-red-400/15 text-red-300 ring-red-400/25'
      : 'bg-amber-400/15 text-amber-300 ring-amber-400/25';
  return (
    <span
      className={`ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tnum ring-1 ring-inset ${tone}`}
      aria-label={`${area.count} need${area.count === 1 ? 's' : ''} attention`}
      title={`${area.count} need${area.count === 1 ? 's' : ''} attention`}
    >
      {area.count}
    </span>
  );
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0"
    >
      <img src="/favicon.svg" alt="" className="w-7 h-7" />
      <span className="text-[17px] font-semibold text-text tracking-tight">
        KrakenKey
      </span>
    </button>
  );
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { byArea } = useHealth();
  const navigate = useNavigate();
  const plan = (user as { plan?: string } | null)?.plan ?? 'free';
  const name = user ? greetingName(user) : undefined;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-[#050914]/70 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex-shrink-0 border-r border-border-subtle flex flex-col bg-sidebar transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-pop' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="h-16 px-5 flex items-center justify-between shrink-0">
          <Brand
            onClick={() => {
              navigate('/dashboard');
              onClose();
            }}
          />
          <button
            onClick={onClose}
            className="lg:hidden text-text-muted hover:text-text p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer bg-transparent border-none"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav
          aria-label="Main navigation"
          className="flex-1 overflow-y-auto px-3 pb-4"
        >
          {navGroups.map((group) => (
            <div key={group.label} className="mt-4 first:mt-1">
              <p className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map(({ to, icon: Icon, label, end, area }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm transition-colors duration-150 ${
                          isActive
                            ? 'bg-cyan-400/[0.09] text-text font-medium shadow-[inset_0_0_0_1px_rgb(34_211_238/0.14)]'
                            : 'text-text-muted hover:text-text hover:bg-white/[0.04]'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-accent"
                            />
                          )}
                          <Icon
                            className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-text-faint group-hover:text-text-secondary'}`}
                          />
                          {label}
                          {area && <AttentionCount area={byArea[area]} />}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border-subtle p-3">
          <div className="flex items-center gap-3 rounded-lg p-2">
            <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-cyan-400/25 to-violet-400/20 ring-1 ring-inset ring-white/10 flex items-center justify-center text-xs font-semibold text-cyan-100">
              {initials(name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text truncate">{name}</p>
              <Link
                to="/dashboard/billing"
                onClick={onClose}
                className="text-xs text-cyan-300 hover:text-cyan-200"
              >
                {PLAN_LABEL[plan] ?? 'Free plan'}
              </Link>
            </div>
            <button
              onClick={() => void logout()}
              className="shrink-0 p-2 rounded-lg text-text-faint hover:text-red-300 hover:bg-white/[0.05] transition-colors cursor-pointer bg-transparent border-none"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <p
            className="px-2 text-xs text-text-faint truncate"
            title={user?.email}
          >
            {user?.email}
          </p>
          <div className="mt-3 flex items-center gap-4 px-2 text-xs">
            <NavLink
              to="/dashboard/feedback"
              onClick={onClose}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 transition-colors ${isActive ? 'text-cyan-300' : 'text-text-faint hover:text-text'}`
              }
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Feedback
            </NavLink>
            <a
              href="https://krakenkey.io/docs/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-text-faint hover:text-text transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Docs
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}

/** Top bar on small screens: menu button, brand, and the attention count. */
export function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const { items } = useHealth();
  const problems = items.filter((i) => i.severity !== 'notice');
  const critical = problems.some((i) => i.severity === 'critical');
  return (
    <div className="lg:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-border-subtle bg-bg/85 backdrop-blur-md">
      <button
        onClick={onMenu}
        className="-ml-1.5 p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-white/[0.06] transition-colors cursor-pointer"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <Brand onClick={() => navigate('/dashboard')} />
      {problems.length > 0 && (
        <Link
          to="/dashboard"
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            critical
              ? 'bg-red-400/10 text-red-300 ring-red-400/25'
              : 'bg-amber-400/10 text-amber-300 ring-amber-400/25'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${critical ? 'bg-red-400' : 'bg-amber-400'}`}
          />
          <span className="tnum">{problems.length}</span> need attention
        </Link>
      )}
    </div>
  );
}
