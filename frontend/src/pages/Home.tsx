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
    <div className="page-center">
      <img src="/favicon.svg" alt="KrakenKey" width={64} height={64} />
      <h1>KrakenKey</h1>
      <p className="tagline">Certificate Automagick</p>
      <div className="btn-group">
        <button className="btn-outline" onClick={login}>
          Login
        </button>
        <button className="btn-primary" onClick={register}>
          Sign Up
        </button>
      </div>
      <a href="https://krakenkey.io" className="learn-more">
        Learn more at krakenkey.io
      </a>
    </div>
  );
};

export default Home;
