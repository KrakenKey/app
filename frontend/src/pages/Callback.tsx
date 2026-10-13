import React, { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { PENDING_DEVICE_CODE_KEY } from '../services/deviceAuthService';
import { PENDING_MARKETPLACE_TOKEN_KEY } from '../services/marketplaceService';

/** Reads and forgets a value stashed in sessionStorage before sign-in. */
function takePending(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    // storage unavailable
    return null;
  }
}

const Callback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback } = useAuth();
  const processedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    console.log(
      'Callback page loaded with code:',
      code ? code.substring(0, 10) + '...' : 'NO CODE',
    );

    if (code && !processedRef.current) {
      processedRef.current = true; // Prevent double execution in Strict Mode
      console.log('Starting callback processing...');
      handleCallback(code, state)
        .then(() => {
          const deviceCode = takePending(PENDING_DEVICE_CODE_KEY);
          const marketplaceToken = takePending(PENDING_MARKETPLACE_TOKEN_KEY);
          if (deviceCode) {
            navigate(`/device?code=${encodeURIComponent(deviceCode)}`);
            return;
          }
          if (marketplaceToken) {
            // Back to the Marketplace landing page to finish the purchase.
            navigate(
              `/marketplace?token=${encodeURIComponent(marketplaceToken)}`,
            );
            return;
          }
          console.log('Callback successful, navigating to dashboard');
          navigate('/dashboard');
        })
        .catch((err) => {
          console.error('Callback error:', err);
          navigate('/'); // Redirect to home on error
        });
    } else if (!code) {
      console.log('No code found, redirecting to home');
      navigate('/');
    }
  }, [searchParams, handleCallback, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg">
      <Loader2 className="h-8 w-8 animate-spin text-accent" />
      <p className="mt-4 text-text-muted">Authenticating...</p>
    </div>
  );
};

export default Callback;
