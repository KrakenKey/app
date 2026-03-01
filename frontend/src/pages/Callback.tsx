import React, { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Callback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback } = useAuth();
  const processedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    
    console.log("🔗 Callback page loaded with code:", code ? code.substring(0, 10) + "..." : "NO CODE");
    
    if (code && !processedRef.current) {
      processedRef.current = true; // Prevent double execution in Strict Mode
      console.log("🚀 Starting callback processing...");
      handleCallback(code)
        .then(() => {
          console.log("✅ Callback successful, navigating to dashboard");
          navigate('/dashboard');
        })
        .catch((err) => {
          console.error("❌ Callback error:", err);
          navigate('/'); // Redirect to home on error
        });
    } else if (!code) {
        console.log("❌ No code found, redirecting to home");
        navigate('/');
    }
  }, [searchParams, handleCallback, navigate]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <h2>Authenticating...</h2>
    </div>
  );
};

export default Callback;
