import axios from 'axios';
import { toast } from '../utils/toast';
import type { ApiErrorResponse } from '@krakenkey/shared';

export const API_URL = window.__env__?.KK_API_URL || 'https://api-dev.krakenkey.io';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: Handle errors globally
api.interceptors.response.use(
  // Success responses pass through
  (response) => response,

  // Error responses are handled here
  (error) => {
    console.error('API Error:', error);

    // Handle network errors (no response from server)
    if (!error.response) {
      toast.error('Network error. Please check your connection.');
      return Promise.reject(error);
    }

    const { status } = error.response;
    const data = error.response.data as ApiErrorResponse | undefined;
    const rawMessage = data?.message || data?.error || 'Something went wrong';
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;

    // Handle specific status codes
    switch (status) {
      case 401:
        // Unauthorized - clear token and redirect to login
        toast.error('Session expired. Please login again.');
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        // Redirect to home after a brief delay
        setTimeout(() => {
          window.location.href = '/';
        }, 1500);
        break;

      case 403:
        toast.error('You do not have permission to perform this action.');
        break;

      case 404:
        toast.error('Resource not found.');
        break;

      case 422:
        // Validation errors
        if (Array.isArray(data?.message)) {
          // NestJS validation pipe returns array of errors
          data.message.forEach((msg: string) => toast.error(msg));
        } else {
          toast.error(message);
        }
        break;

      case 429:
        toast.error('Too many requests. Please slow down.');
        break;

      case 500:
        toast.error('Server error. Please try again later.');
        break;

      default:
        // For other errors, show the message from the server
        toast.error(message);
    }

    return Promise.reject(error);
  }
);

export default api;
