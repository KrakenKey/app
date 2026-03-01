import { useState } from 'react';
import api from '../services/api';
import { toast } from '../utils/toast';

/**
 * Demo component to test error handling
 * Remove this from production - it's just for testing
 */
export default function ErrorHandlingDemo() {
  const [loading, setLoading] = useState(false);

  const testError = async (endpoint: string, method: 'get' | 'post' = 'get') => {
    setLoading(true);
    try {
      if (method === 'post') {
        await api.post(endpoint, {});
      } else {
        await api.get(endpoint);
      }
      toast.success('Request succeeded!');
    } catch (error) {
      // Error is already handled by the interceptor
      console.log('Error caught in component:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Error Handling Demo</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Click buttons to test different error scenarios. Toast notifications should appear in the top-right corner.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => testError('/nonexistent')}
          disabled={loading}
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          Test 404 Error (Not Found)
        </button>

        <button
          onClick={() => testError('/auth/profile')}
          disabled={loading}
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          Test Successful Request
        </button>

        <button
          onClick={() => testError('/users', 'post')}
          disabled={loading}
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          Test 422 Error (Validation)
        </button>

        <button
          onClick={() => toast.success('Manual success toast')}
          style={{ padding: '10px', cursor: 'pointer', background: '#10b981', color: 'white', border: 'none' }}
        >
          Test Success Toast
        </button>

        <button
          onClick={() => toast.error('Manual error toast')}
          style={{ padding: '10px', cursor: 'pointer', background: '#ef4444', color: 'white', border: 'none' }}
        >
          Test Error Toast
        </button>

        <button
          onClick={() => toast.info('Manual info toast')}
          style={{ padding: '10px', cursor: 'pointer', background: '#3b82f6', color: 'white', border: 'none' }}
        >
          Test Info Toast
        </button>

        <button
          onClick={() => toast.warning('Manual warning toast')}
          style={{ padding: '10px', cursor: 'pointer', background: '#f59e0b', color: 'white', border: 'none' }}
        >
          Test Warning Toast
        </button>
      </div>

      {loading && <p style={{ marginTop: '20px', color: '#3b82f6' }}>Loading...</p>}
    </div>
  );
}
