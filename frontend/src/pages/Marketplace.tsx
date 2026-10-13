import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ExternalLink, Loader2, ShoppingBag } from 'lucide-react';
import type { MarketplaceLandingResponse } from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { MicrosoftLogo } from '../components/MicrosoftLogo';
import { isMicrosoftSignInEnabled } from '../utils/signInSources';
import {
  AZURE_PORTAL_SAAS_URL,
  PENDING_MARKETPLACE_TOKEN_KEY,
  activateMarketplacePurchase,
  fetchMarketplaceStatus,
  readMarketplaceToken,
  resolveMarketplacePurchase,
} from '../services/marketplaceService';

const SUPPORT_URL = 'https://krakenkey.io/support/';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  team: 'Team',
  business: 'Business',
};

const TERM_LABELS: Record<string, string> = {
  P1M: 'Monthly',
  P1Y: 'Yearly',
};

type State =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'no-token' }
  | { kind: 'sign-in' }
  | { kind: 'ready'; purchase: MarketplaceLandingResponse }
  | { kind: 'working'; purchase: MarketplaceLandingResponse }
  | { kind: 'error'; message: string };

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  return 'Something went wrong. Try again in a minute.';
}

function Spinner() {
  return <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />;
}

function AzurePortalLink({ label }: { label: string }) {
  return (
    <a
      href={AZURE_PORTAL_SAAS_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-cyan-300 hover:text-cyan-200"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function PurchaseDetails({
  purchase,
}: {
  purchase: MarketplaceLandingResponse;
}) {
  const rows: [string, string][] = [
    ['Subscription', purchase.subscriptionName || '-'],
    [
      'Plan',
      purchase.plan
        ? (PLAN_LABELS[purchase.plan] ?? purchase.plan)
        : purchase.planId,
    ],
  ];
  if (purchase.termUnit) {
    rows.push([
      'Billing',
      `${TERM_LABELS[purchase.termUnit] ?? purchase.termUnit}, through Microsoft`,
    ]);
  }
  if (purchase.purchaserEmail)
    rows.push(['Purchased by', purchase.purchaserEmail]);
  rows.push([
    purchase.target.kind === 'organization'
      ? 'Organization'
      : 'KrakenKey account',
    purchase.target.name,
  ]);
  return (
    <dl className="mt-6 space-y-1.5 text-left text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="shrink-0 text-zinc-500">{label}:</dt>
          <dd className="break-all text-zinc-300">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Landing page for Microsoft Marketplace purchases. Microsoft opens it with
 * ?token=... after a purchase ("Configure account") and when a customer
 * manages an existing subscription from the Azure portal.
 */
const Marketplace: React.FC = () => {
  const { isAuthenticated, isLoading, login, register, loginWithMicrosoft } =
    useAuth();
  const [token] = useState(() => readMarketplaceToken(window.location.search));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // Outcome of looking up (and activating) the purchase; the other states
  // follow from the flag, the token and the session.
  const [result, setResult] = useState<State | null>(null);
  // Required when the signed-in email isn't the purchaser's or beneficiary's.
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetchMarketplaceStatus()
      .then((s) => !ignore && setEnabled(s.enabled))
      .catch(() => !ignore && setEnabled(false));
    return () => {
      ignore = true;
    };
  }, []);

  const canResolve =
    enabled === true && !isLoading && isAuthenticated && !!token;

  useEffect(() => {
    if (!canResolve || !token) return;
    let ignore = false;
    resolveMarketplacePurchase(token)
      .then((purchase) => !ignore && setResult({ kind: 'ready', purchase }))
      .catch(
        (err) =>
          !ignore && setResult({ kind: 'error', message: errorMessage(err) }),
      );
    return () => {
      ignore = true;
    };
  }, [canResolve, token]);

  let state: State;
  if (enabled === null || isLoading) state = { kind: 'loading' };
  else if (!enabled) state = { kind: 'unavailable' };
  else if (!token) state = { kind: 'no-token' };
  else if (!isAuthenticated) state = { kind: 'sign-in' };
  else state = result ?? { kind: 'loading' };

  /** Remembers the token so /auth/callback brings the user back here. */
  const signInWith = (start: () => void) => () => {
    if (token) {
      try {
        sessionStorage.setItem(PENDING_MARKETPLACE_TOKEN_KEY, token);
      } catch {
        // Without storage the user reopens the page from the Azure portal.
      }
    }
    start();
  };

  const activate = async () => {
    if (state.kind !== 'ready' || !token) return;
    setResult({ kind: 'working', purchase: state.purchase });
    try {
      const purchase = await activateMarketplacePurchase(token);
      setResult({ kind: 'ready', purchase });
    } catch (err) {
      setResult({ kind: 'error', message: errorMessage(err) });
    }
  };

  let title = 'Microsoft Marketplace';
  let body: React.ReactNode;

  switch (state.kind) {
    case 'loading':
      body = <Spinner />;
      break;
    case 'unavailable':
      title = 'Not available yet';
      body = (
        <>
          <p className="text-text-muted">
            KrakenKey plans can&apos;t be bought through Microsoft Marketplace
            yet. You can still sign up and subscribe directly.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              to="/"
              className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-bg hover:bg-accent-hover"
            >
              Go to KrakenKey
            </Link>
            <a
              href={SUPPORT_URL}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3.5 text-sm font-medium text-text-secondary hover:text-text"
            >
              Contact support
            </a>
          </div>
        </>
      );
      break;
    case 'no-token':
      body = (
        <p className="text-text-muted">
          Microsoft opens this page after a purchase. Open your KrakenKey
          subscription in the Azure portal or the Microsoft 365 admin center and
          select Configure account or Manage account.
        </p>
      );
      break;
    case 'sign-in': {
      const microsoft = isMicrosoftSignInEnabled();
      body = (
        <>
          <p className="text-text-muted">
            Thanks for buying KrakenKey through Microsoft. Sign in to set up
            your subscription. New to KrakenKey? Signing in with Microsoft
            creates your account.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            {microsoft && (
              <Button
                variant="primary"
                size="lg"
                onClick={signInWith(loginWithMicrosoft)}
                icon={<MicrosoftLogo className="h-[18px] w-[18px]" />}
                className="w-full"
              >
                Continue with Microsoft
              </Button>
            )}
            <Button
              variant={microsoft ? 'secondary' : 'primary'}
              size="lg"
              onClick={signInWith(login)}
              className="w-full"
            >
              {microsoft ? 'Sign in with email' : 'Sign in'}
            </Button>
            {!microsoft && (
              <Button
                variant="secondary"
                size="lg"
                onClick={signInWith(register)}
                className="w-full"
              >
                Create an account
              </Button>
            )}
          </div>
        </>
      );
      break;
    }
    case 'error':
      body = (
        <>
          <p className="text-red-400">{state.message}</p>
          <p className="mt-4 text-sm text-text-muted">
            Need help?{' '}
            <a href={SUPPORT_URL} className="text-cyan-300 hover:text-cyan-200">
              Contact support
            </a>
          </p>
        </>
      );
      break;
    case 'ready':
    case 'working': {
      const { purchase } = state;
      const busy = state.kind === 'working';
      const planLabel = purchase.plan
        ? (PLAN_LABELS[purchase.plan] ?? purchase.plan)
        : purchase.planId;
      let detail: React.ReactNode;
      switch (purchase.state) {
        case 'ready':
          title = 'Activate your subscription';
          detail = (
            <>
              <p className="mt-6 text-sm text-text-muted">
                Activating applies {planLabel} limits to this{' '}
                {purchase.target.kind === 'organization'
                  ? 'organization'
                  : 'account'}{' '}
                and Microsoft starts billing you for it.
                {purchase.isFreeTrial &&
                  ' Your free trial starts now; Microsoft bills you when it ends.'}
              </p>
              {!purchase.accountMatchesPurchase && (
                <label className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-left text-sm text-amber-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    This purchase was made for a different email address than
                    the one you're signed in with. Only continue if you expected
                    it and want it applied to {purchase.target.name}.
                  </span>
                </label>
              )}
              <Button
                variant="primary"
                className="mt-6"
                onClick={activate}
                disabled={
                  busy || (!purchase.accountMatchesPurchase && !confirmed)
                }
              >
                {busy ? 'Activating...' : 'Activate subscription'}
              </Button>
            </>
          );
          break;
        case 'active':
          title =
            purchase.saasStatus === 'Suspended'
              ? 'Payment needed'
              : 'Your subscription is active';
          detail = (
            <>
              <p className="mt-6 text-sm text-text-muted">
                {purchase.saasStatus === 'Suspended'
                  ? `Microsoft couldn't collect the payment for this subscription. Update the payment method in the Azure portal to keep ${planLabel} limits.`
                  : `${planLabel} limits apply to this ${purchase.target.kind === 'organization' ? 'organization' : 'account'}. Change the plan or cancel in the Azure portal.`}
              </p>
              <div className="mt-6 flex flex-col items-center gap-3">
                <Link
                  to="/dashboard"
                  className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-bg hover:bg-accent-hover"
                >
                  Go to the dashboard
                </Link>
                <AzurePortalLink label="Manage in the Azure portal" />
              </div>
            </>
          );
          break;
        case 'linked_elsewhere':
          title = 'Linked to another account';
          detail = (
            <p className="mt-6 text-sm text-amber-400">
              This subscription is already set up for a different KrakenKey
              account. Sign out and sign in with that account to manage it.
            </p>
          );
          break;
        case 'conflict':
          title = 'This account already has a plan';
          detail = (
            <p className="mt-6 text-sm text-amber-400">{purchase.message}</p>
          );
          break;
        case 'not_owner':
          title = 'Ask your organization owner';
          detail = (
            <p className="mt-6 text-sm text-amber-400">
              Only the owner of {purchase.target.name} can set up billing for
              it. Ask them to open this subscription from the Azure portal, or
              sign in with an account that isn&apos;t in an organization.
            </p>
          );
          break;
        case 'unknown_plan':
          title = 'Plan not available';
          detail = (
            <p className="mt-6 text-sm text-amber-400">
              This plan isn&apos;t available.{' '}
              <a href={SUPPORT_URL} className="text-cyan-300">
                Contact support
              </a>{' '}
              and we&apos;ll sort it out.
            </p>
          );
          break;
        case 'suspended':
          title = 'Subscription suspended';
          detail = (
            <div className="mt-6 space-y-3 text-sm">
              <p className="text-amber-400">
                Microsoft has suspended this subscription because of a payment
                problem. Resolve it in the Azure portal, then open this page
                again.
              </p>
              <AzurePortalLink label="Open the Azure portal" />
            </div>
          );
          break;
        case 'ended':
          title = 'Subscription canceled';
          detail = (
            <p className="mt-6 text-sm text-text-muted">
              This subscription has been canceled in Microsoft Marketplace.
            </p>
          );
          break;
      }
      body = (
        <>
          <PurchaseDetails purchase={purchase} />
          {detail}
        </>
      );
      break;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-md text-center">
        <ShoppingBag className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">{title}</h1>
        <div className="mt-4">{body}</div>
      </Card>
    </div>
  );
};

export default Marketplace;
