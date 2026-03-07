import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './mocks/server';

// Polyfill HTMLDialogElement methods for jsdom (not supported natively)
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset handlers and cleanup after each test
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Close MSW server after all tests
afterAll(() => server.close());

// Mock WebCrypto API subtle methods for tests
// In jsdom environment, crypto already exists but subtle may need mocking
if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
  vi.spyOn(globalThis.crypto.subtle, 'generateKey');
  vi.spyOn(globalThis.crypto.subtle, 'exportKey');
  vi.spyOn(globalThis.crypto.subtle, 'sign');
  vi.spyOn(globalThis.crypto.subtle, 'verify');
} else {
  // Fallback: define crypto if it doesn't exist
  const cryptoMock = {
    subtle: {
      generateKey: vi.fn(),
      sign: vi.fn(),
      verify: vi.fn(),
      exportKey: vi.fn(),
      importKey: vi.fn(),
    },
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
  };

  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoMock,
    writable: true,
    configurable: true,
  });
}
