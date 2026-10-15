import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ExternalLink, Loader2, ShoppingBag } from 'lucide-react';
import { planLabel as labelFor } from '@krakenkey/shared';
import type { AwsMarketplaceLandingResponse } from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { MicrosoftLogo } from '../components/MicrosoftLogo';
import { isMicrosoftSignInEnabled } from '../utils/signInSources';
import {
  AWS_MARKETPLACE_CONSOLE_URL,
  PENDING_AWS_MARKETPLACE_REGISTRATION_KEY,
  fetchAwsMarketplaceStatus,
  forgetAwsRegistration,
  linkAwsMarketplacePurchase,
  readAwsRegisterError,
  resolveAwsMarketplacePurchase,
  takeAwsRegistration,
  type AwsMarketplaceRegisterError,
} from '../services/awsMarketplaceService';

const SUPPORT_URL = 'https://krakenkey.io/support/';

/** Where buyers start over when a setup link no longer works. */
const START_OVER =
  'Open your KrakenKey subscription in the AWS Marketplace console (Manage subscriptions) and choose Set up your account again.';

const REGISTER_ERROR_MESSAGES: Record<AwsMarketplaceRegisterError, string> = {
  missing_token: `AWS didn't send the details of your purchase. ${START_OVER}`,
  invalid_token: `We couldn't confirm this purchase with AWS. The setup link may have expired or been used already. ${START_OVER}`,
  unknown_product:
    "This AWS Marketplace product isn't sold through this KrakenKey site. Contact support and we'll sort it out.",
  unavailable: `We couldn't reach AWS to confirm your purchase. Try again in a few minutes: ${START_OVER}`,
};

type State =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'register-error'; error: AwsMarketplaceRegisterError }
  | { kind: 'no-registration' }
  | { kind: 'sign-in' }
  | { kind: 'ready'; purchase: AwsMarketplaceLandingResponse }
  | { kind: 'working'; purchase: AwsMarketplaceLandingResponse }
  | { kind: 'error'; message: string };

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  return 'Something went wrong. Try again in a minute.';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function Spinner() {
  return <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />;
}

function SupportLine() {
  return (
    <p className="mt-6 text-sm text-text-muted">
      Questions about your purchase?{' '}
      <a href={SUPPORT_URL} className="text-cyan-300 hover:text-cyan-200">
        Contact support
      </a>
    </p>
  );
}

function ConsoleLink({ label }: { label: string }) {
  return (
    <a
      href={AWS_MARKETPLACE_CONSOLE_URL}
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
  purchase: AwsMarketplaceLandingResponse;
}) {
  const rows: [string, string][] = [
    [
      'Plan',
      purchase.plan
        ? labelFor(purchase.plan)
        : (purchase.dimension ?? 'Waiting for AWS'),
    ],
    ['Billing', 'Through AWS Marketplace'],
    ['AWS account', purchase.awsAccountId],
  ];
  if (purchase.expiresAt) {
    rows.push(['Current term ends', formatDate(purchase.expiresAt)]);
  }
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
 * Landing page for AWS Marketplace purchases. The API's fulfillment URL
 * redirects here with ?registration=... after the buyer subscribes (or
 * chooses Set up your account in the AWS Marketplace console), or with
 * ?error=... when AWS couldn't confirm the purchase.
 */
const AwsMarketplace: React.FC = () => {
  const { isAuthenticated, isLoading, login, register, loginWithMicrosoft } =
    useAuth();
  const [registration] = useState(() => takeAwsRegistration());
  const [registerError] = useState(() =>
    readAwsRegisterError(window.location.search),
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [result, setResult] = useState<State | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchAwsMarketplaceStatus()
      .then((s) => !ignore && setEnabled(s.enabled))
      .catch(() => !ignore && setEnabled(false));
    return () => {
      ignore = true;
    };
  }, []);

  const canResolve =
    enabled === true && !isLoading && isAuthenticated && !!registration;

  useEffect(() => {
    if (!canResolve || !registration) return;
    let ignore = false;
    resolveAwsMarketplacePurchase(registration)
      .then((purchase) => !ignore && setResult({ kind: 'ready', purchase }))
      .catch(
        (err) =>
          !ignore && setResult({ kind: 'error', message: errorMessage(err) }),
      );
    return () => {
      ignore = true;
    };
  }, [canResolve, registration]);

  let state: State;
  if (enabled === null || isLoading) state = { kind: 'loading' };
  else if (!enabled) state = { kind: 'unavailable' };
  else if (registerError)
    state = { kind: 'register-error', error: registerError };
  else if (!registration) state = { kind: 'no-registration' };
  else if (!isAuthenticated) state = { kind: 'sign-in' };
  else state = result ?? { kind: 'loading' };

  /** Remembers the registration so /auth/callback brings the user back here. */
  const signInWith = (start: () => void) => () => {
    if (registration) {
      try {
        sessionStorage.setItem(
          PENDING_AWS_MARKETPLACE_REGISTRATION_KEY,
          registration,
        );
      } catch {
        // Without storage the user reopens the page from the AWS console.
      }
    }
    start();
  };

  const link = async () => {
    if (state.kind !== 'ready' || !registration) return;
    setResult({ kind: 'working', purchase: state.purchase });
    try {
      const purchase = await linkAwsMarketplacePurchase(registration);
      // The API used the registration up; a reload shouldn't retry it.
      forgetAwsRegistration();
      setResult({ kind: 'ready', purchase });
    } catch (err) {
      setResult({ kind: 'error', message: errorMessage(err) });
    }
  };

  let title = 'AWS Marketplace';
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
            KrakenKey plans can&apos;t be bought through AWS Marketplace yet.
            You can still sign up and subscribe directly.
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
    case 'register-error':
      title = "We couldn't set up your purchase";
      body = (
        <>
          <p className="text-amber-400">
            {REGISTER_ERROR_MESSAGES[state.error]}
          </p>
          <div className="mt-6">
            <ConsoleLink label="Open the AWS Marketplace console" />
          </div>
          <SupportLine />
        </>
      );
      break;
    case 'no-registration':
      body = (
        <>
          <p className="text-text-muted">
            AWS Marketplace opens this page after you subscribe to KrakenKey. To
            set up a purchase, open your KrakenKey subscription in the AWS
            Marketplace console (Manage subscriptions) and choose Set up your
            account.
          </p>
          <div className="mt-6">
            <ConsoleLink label="Open the AWS Marketplace console" />
          </div>
        </>
      );
      break;
    case 'sign-in': {
      const microsoft = isMicrosoftSignInEnabled();
      body = (
        <>
          <p className="text-text-muted">
            Thanks for subscribing to KrakenKey through AWS Marketplace. Sign in
            to your KrakenKey account, or create one, to finish setting up. Your
            plan applies as soon as the purchase is linked to your account.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button
              variant="primary"
              size="lg"
              onClick={signInWith(register)}
              className="w-full"
            >
              Create an account
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={signInWith(login)}
              className="w-full"
            >
              Sign in
            </Button>
            {microsoft && (
              <Button
                variant="secondary"
                size="lg"
                onClick={signInWith(loginWithMicrosoft)}
                icon={<MicrosoftLogo className="h-[18px] w-[18px]" />}
                className="w-full"
              >
                Continue with Microsoft
              </Button>
            )}
          </div>
          <SupportLine />
        </>
      );
      break;
    }
    case 'error':
      body = (
        <>
          <p className="text-red-400">{state.message}</p>
          <SupportLine />
        </>
      );
      break;
    case 'ready':
    case 'working': {
      const { purchase } = state;
      const busy = state.kind === 'working';
      const planLabel = purchase.plan ? labelFor(purchase.plan) : 'your plan';
      const where =
        purchase.target.kind === 'organization' ? 'organization' : 'account';
      let detail: React.ReactNode;
      switch (purchase.state) {
        case 'ready':
        case 'awaiting_entitlement':
          title = 'Link your purchase';
          detail = (
            <>
              <p className="mt-6 text-sm text-text-muted">
                {purchase.state === 'ready'
                  ? `Linking applies ${planLabel} limits to this ${where} right away. AWS bills you for the subscription.`
                  : `AWS is still processing this purchase. Link it now and ${planLabel} limits apply to this ${where} as soon as AWS confirms it, usually within a few minutes.`}
              </p>
              <Button
                variant="primary"
                className="mt-6"
                onClick={link}
                disabled={busy}
              >
                {busy ? 'Linking...' : `Link to this ${where}`}
              </Button>
            </>
          );
          break;
        case 'active':
          title = 'Your subscription is active';
          detail = (
            <>
              <p className="mt-6 text-sm text-text-muted">
                {planLabel} limits apply to this {where}. Change the plan or
                cancel in the AWS Marketplace console.
              </p>
              <div className="mt-6 flex flex-col items-center gap-3">
                <Link
                  to="/dashboard"
                  className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-bg hover:bg-accent-hover"
                >
                  Go to the dashboard
                </Link>
                <ConsoleLink label="Manage in the AWS Marketplace console" />
              </div>
            </>
          );
          break;
        case 'pending':
          title = 'Almost there';
          detail = (
            <>
              <p className="mt-6 text-sm text-text-muted">
                Your purchase is linked to {purchase.target.name}. AWS is still
                processing it, and {planLabel} limits apply automatically as
                soon as AWS confirms it, usually within a few minutes. You can
                close this page.
              </p>
              <div className="mt-6">
                <Link
                  to="/dashboard"
                  className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-semibold text-bg hover:bg-accent-hover"
                >
                  Go to the dashboard
                </Link>
              </div>
            </>
          );
          break;
        case 'linked_elsewhere':
          title = 'Linked to another account';
          detail = (
            <p className="mt-6 text-sm text-amber-400">
              This purchase is already set up for a different KrakenKey account.
              Sign out and sign in with that account to use it.
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
              it. Ask them to open this subscription from the AWS Marketplace
              console, or sign in with an account that isn&apos;t in an
              organization.
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
        case 'ended':
          title = 'Subscription ended';
          detail = (
            <p className="mt-6 text-sm text-text-muted">
              This AWS Marketplace contract has ended or been canceled.
            </p>
          );
          break;
      }
      body = (
        <>
          <PurchaseDetails purchase={purchase} />
          {detail}
          <SupportLine />
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

export default AwsMarketplace;
