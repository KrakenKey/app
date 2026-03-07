import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Globe, Shield, Key, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import api from '../services/api';

interface ResourceCounts {
  domains: number;
  certificates: number;
  apiKeys: number;
}

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<ResourceCounts | null>(null);

  useEffect(() => {
    const profile = user as { resourceCounts?: ResourceCounts } | null;
    if (profile?.resourceCounts) {
      setCounts(profile.resourceCounts);
    } else {
      // Fallback: fetch from profile endpoint
      api.get('/auth/profile').then((res) => {
        if (res.data.resourceCounts) {
          setCounts(res.data.resourceCounts);
        }
      }).catch(() => {});
    }
  }, [user]);

  const resources = [
    { label: 'Domains', count: counts?.domains ?? 0, icon: Globe, path: '/dashboard/domains', color: 'text-cyan-400' },
    { label: 'Certificates', count: counts?.certificates ?? 0, icon: Shield, path: '/dashboard/certificates', color: 'text-emerald-400' },
    { label: 'API Keys', count: counts?.apiKeys ?? 0, icon: Key, path: '/dashboard/api-keys', color: 'text-amber-400' },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.displayName || user?.username || 'user'}`}
        description="Here's an overview of your resources."
        icon={<LayoutDashboard className="w-6 h-6" />}
      />

      {/* Resource cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {resources.map(({ label, count, icon: Icon, path, color }) => (
          <Card
            key={label}
            hover
            className="cursor-pointer"
            onClick={() => navigate(path)}
          >
            <div className="flex items-center justify-between mb-3">
              <Icon className={`w-5 h-5 ${color}`} />
              <span className="text-2xl font-bold text-zinc-100">{count}</span>
            </div>
            <p className="text-sm text-zinc-400">{label}</p>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/domains')}
          >
            Add Domain
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/certificates')}
          >
            Submit CSR
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/api-keys')}
          >
            Create API Key
          </Button>
        </div>
      </Card>
    </div>
  );
}
