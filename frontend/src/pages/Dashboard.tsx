import React from 'react';
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
      <div style={{ padding: '2rem' }}>
        <h1>Dashboard</h1>
        <div style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
          <h2>Welcome, {user?.username}</h2>
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Groups:</strong> {user?.groups?.join(', ') || 'None'}</p>
        </div>

        {/* API Key Management Section */}
        <div style={{ marginTop: '2rem' }}>
          <ApiKeyManagement />
        </div>

        {/* Domain Management Section */}
        <div style={{ marginTop: '3rem' }}>
          <DomainManagement />
        </div>

        {/* Certificate Management Section */}
        <div style={{ marginTop: '3rem' }}>
          <CertificateManagement />
        </div>

        {/* Feedback Section */}
        <div style={{ marginTop: '3rem' }}>
          <Feedback />
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button
            onClick={logout}
            style={{
              background: '#ff4d4d',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </DomainsProvider>
  );
};

export default Dashboard;
