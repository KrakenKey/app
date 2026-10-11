import React from 'react';
import { useAuth } from '../hooks/useAuth';
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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_50%_40%,rgb(6_182_212/0.09),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface/70 p-8 text-center shadow-pop backdrop-blur">
        <img
          src="/favicon.svg"
          alt="KrakenKey"
          width={56}
          height={56}
          className="mx-auto"
        />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-text">
          KrakenKey
        </h1>
        <p className="mt-1 text-sm text-text-muted">Certificate Automagick</p>
        <p className="mt-5 text-sm text-text-secondary">
          TLS certificates issued in minutes over DNS-01, renewed for you, and
          watched on every endpoint. Your private keys never leave your
          machines.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={login}>
            Login
          </Button>
          <Button variant="primary" size="lg" onClick={register}>
            Sign Up
          </Button>
        </div>
      </div>
      <a
        href="https://krakenkey.io"
        className="relative mt-6 text-sm text-text-muted transition-colors hover:text-cyan-300"
      >
        Learn more at krakenkey.io
      </a>
    </div>
  );
};

export default Home;
