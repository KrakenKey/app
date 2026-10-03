import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Loader2, Terminal } from 'lucide-react';
import type { DeviceAuthRequestInfo } from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  PENDING_DEVICE_CODE_KEY,
  approveDevice,
  denyDevice,
  fetchDeviceRequest,
} from '../services/deviceAuthService';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; request: DeviceAuthRequestInfo }
  | { kind: 'working'; request: DeviceAuthRequestInfo }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 404) {
      return 'This login request was not found or has expired. Run the login command again.';
    }
    const msg = err.response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  return 'Something went wrong. Try again.';
}

function minutesAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

function Spinner() {
  return <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />;
}

const Device: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading, login } = useAuth();
  const code = (searchParams.get('code') ?? '').trim().toUpperCase();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (isLoading || !isAuthenticated || !code) return;
    let cancelled = false;
    fetchDeviceRequest(code)
      .then((request) => !cancelled && setState({ kind: 'ready', request }))
      .catch(
        (err) =>
          !cancelled && setState({ kind: 'error', message: errorMessage(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [code, isAuthenticated, isLoading]);

  const signIn = () => {
    if (code) {
      try {
        sessionStorage.setItem(PENDING_DEVICE_CODE_KEY, code);
      } catch {
        // Without storage the user lands on the dashboard and reopens the link.
      }
    }
    login();
  };

  const decide = async (approve: boolean) => {
    if (state.kind !== 'ready') return;
    setState({ kind: 'working', request: state.request });
    try {
      if (approve) {
        await approveDevice(code);
        setState({ kind: 'approved' });
      } else {
        await denyDevice(code);
        setState({ kind: 'denied' });
      }
    } catch (err) {
      setState({ kind: 'error', message: errorMessage(err) });
    }
  };

  let body: React.ReactNode;
  if (isLoading) {
    body = <Spinner />;
  } else if (!isAuthenticated) {
    body = (
      <>
        <p className="text-text-muted">
          Sign in to approve the KrakenKey CLI login
          {code && (
            <>
              {' '}
              with code <span className="font-mono text-zinc-100">{code}</span>
            </>
          )}
          .
        </p>
        <Button variant="primary" className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </>
    );
  } else if (!code) {
    body = <p className="text-red-400">No login code in the link.</p>;
  } else {
    switch (state.kind) {
      case 'loading':
        body = <Spinner />;
        break;
      case 'ready':
      case 'working': {
        const { request } = state;
        const busy = state.kind === 'working';
        body = (
          <>
            <p className="text-text-muted">
              Confirm this code matches the one shown in your terminal:
            </p>
            <p className="mt-3 font-mono text-2xl tracking-widest text-zinc-100">
              {request.userCode}
            </p>
            <dl className="mt-6 space-y-1.5 text-left text-sm">
              <div className="flex gap-2">
                <dt className="text-zinc-500">Device:</dt>
                <dd className="text-zinc-300 break-all">
                  {request.clientName}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-zinc-500">Requested from:</dt>
                <dd className="text-zinc-300">{request.ip || 'unknown'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-zinc-500">Started:</dt>
                <dd className="text-zinc-300">
                  {minutesAgo(request.createdAt)}
                </dd>
              </div>
            </dl>
            <p className="mt-6 text-sm text-amber-400">
              Approving creates an API key with full access to your account and
              gives it to that terminal. Only approve a login you started
              yourself.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => decide(false)}
                disabled={busy}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                onClick={() => decide(true)}
                disabled={busy}
              >
                {busy ? 'Working...' : 'Approve'}
              </Button>
            </div>
          </>
        );
        break;
      }
      case 'approved':
        body = (
          <p className="text-text-muted">
            Approved. Return to your terminal; the CLI will finish signing in.
            You can revoke the key any time under API Keys.
          </p>
        );
        break;
      case 'denied':
        body = (
          <p className="text-text-muted">Denied. No API key was created.</p>
        );
        break;
      case 'error':
        body = <p className="text-red-400">{state.message}</p>;
        break;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-md text-center">
        <Terminal className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">CLI login</h1>
        <div className="mt-4">{body}</div>
      </Card>
    </div>
  );
};

export default Device;
