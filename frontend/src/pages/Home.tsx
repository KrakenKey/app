import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Home: React.FC = () => {
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '0.5rem',
      }}
    >
      <img src="/favicon.svg" alt="KrakenKey" width={64} height={64} style={{ marginBottom: '0.5rem' }} />
      <h1>KrakenKey</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '0.5rem' }}>Certificate Automagick</p>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
        <button className="btn-outline" onClick={login}>
          Login
        </button>
        <button className="btn-primary" onClick={register}>
          Sign Up
        </button>
      </div>
      <a
        href="https://krakenkey.io"
        style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginTop: '0.75rem' }}
      >
        Learn more at krakenkey.io
      </a>
    </div>
  );
};

export default Home;
