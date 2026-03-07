import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DomainsProvider } from '../context/DomainsContext';
import DomainManagement from '../components/DomainManagement';
import CertificateManagement from '../components/CertificateManagement';
import ApiKeyManagement from '../components/ApiKeyManagement';
import Feedback from '../components/Feedback';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <DomainsProvider>
      <div className="dashboard">
        <h1>Dashboard</h1>
        <div className="dashboard-header">
          <h2>Welcome, {user?.username}</h2>
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Groups:</strong> {user?.groups?.join(', ') || 'None'}</p>
        </div>

        {/* API Key Management Section */}
        <div className="dashboard-section">
          <ApiKeyManagement />
        </div>

        {/* Domain Management Section */}
        <div className="dashboard-section">
          <DomainManagement />
        </div>

        {/* Certificate Management Section */}
        <div className="dashboard-section">
          <CertificateManagement />
        </div>

        {/* Feedback Section */}
        <div className="dashboard-section">
          <Feedback />
        </div>

        <div className="dashboard-section" style={{ display: 'flex', gap: '1rem' }}>
          <Link to="/settings" className="btn-secondary btn-small">
            Settings
          </Link>
          <button onClick={logout} className="btn-logout">
            Logout
          </button>
        </div>
      </div>
    </DomainsProvider>
  );
};

export default Dashboard;
