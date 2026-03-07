import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

const Home: React.FC = () => {
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <img src="/favicon.svg" alt="KrakenKey" width={64} height={64} />
      <h1 className="mt-6 text-3xl font-bold text-zinc-100">KrakenKey</h1>
      <p className="mt-2 text-text-muted">Certificate Automagick</p>
      <div className="mt-8 flex gap-3">
        <Button variant="outline" size="lg" onClick={login}>
          Login
        </Button>
        <Button variant="primary" size="lg" onClick={register}>
          Sign Up
        </Button>
      </div>
      <a
        href="https://krakenkey.io"
        className="mt-6 text-sm text-text-muted transition-colors hover:text-accent"
      >
        Learn more at krakenkey.io
      </a>
    </div>
  );
};

export default Home;
