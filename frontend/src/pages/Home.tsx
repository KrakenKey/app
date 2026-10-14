import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Activity, Plug, ArrowUpRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { MicrosoftLogo } from '../components/MicrosoftLogo';
import { isMicrosoftSignInEnabled } from '../utils/signInSources';

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Certificates in minutes',
    body: 'Let’s Encrypt over DNS-01. Private keys stay on your devices.',
  },
  {
    icon: Activity,
    title: 'Endpoint health for every client',
    body: 'Hosted and on-site probes check expiry, chains and reachability.',
  },
  {
    icon: Plug,
    title: 'Renew and deploy on site',
    body: 'Connectors renew with new keys and deploy to your servers, Azure and AWS.',
  },
];

const Home: React.FC = () => {
  const { login, register, loginWithMicrosoft, isAuthenticated } = useAuth();
  const microsoftEnabled = isMicrosoftSignInEnabled();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-bg lg:flex-row">
      {/* Brand panel */}
      <section className="relative overflow-hidden border-b border-border-subtle bg-sidebar px-6 py-8 sm:px-10 lg:flex lg:w-[44%] lg:flex-col lg:justify-between lg:border-r lg:border-b-0 lg:py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-text">
              KrakenKey
            </h1>
            <p className="text-xs text-text-muted">Certificate Automagick</p>
          </div>
        </div>

        <div className="relative mt-8 hidden lg:block">
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-text">
            TLS certificates and endpoint health for every client you manage.
          </p>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-400/20">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-text">
                    {title}
                  </span>
                  <span className="block text-sm text-text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-10 hidden text-xs text-text-muted lg:block">
          Used by IT teams and MSPs to keep client certificates current.
        </p>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_circle_at_50%_45%,rgb(6_182_212/0.06),transparent_70%)]"
        />
        <div className="relative w-full max-w-sm">
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-pop">
            <h2 className="text-xl font-semibold tracking-tight text-text">
              Sign in to your console
            </h2>
            <p className="mt-1.5 text-sm text-text-muted">
              Use your KrakenKey account. New here? Create one in a minute; the
              free Starter plan needs no card.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="lg"
                onClick={login}
                className="w-full"
              >
                Login
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={register}
                className="w-full"
              >
                Sign Up
              </Button>
            </div>
            {microsoftEnabled && (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
                  <span className="h-px flex-1 bg-border-subtle" />
                  or
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={loginWithMicrosoft}
                  icon={<MicrosoftLogo className="h-[18px] w-[18px]" />}
                  className="w-full"
                >
                  Continue with Microsoft
                </Button>
                <p className="mt-2.5 text-center text-xs text-text-muted">
                  Work, school or personal account. Creates your KrakenKey
                  account if you’re new.
                </p>
              </>
            )}
          </div>
          <a
            href="https://krakenkey.io"
            className="mt-5 flex items-center justify-center gap-1 text-sm text-text-muted transition-colors hover:text-cyan-300"
          >
            Learn more at krakenkey.io
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>
    </div>
  );
};

export default Home;
