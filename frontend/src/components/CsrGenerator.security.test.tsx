/**
 * Security-specific tests for CSR Generator Component
 *
 * Tests verify critical security properties:
 * 1. Private keys never sent over network (only CSR PEM in callback)
 * 2. Error messages sanitized (no key material in DOM)
 * 3. Browser compatibility checks shown
 * 4. 3-second delay before user can continue past private key modal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CsrGenerator from './CsrGenerator';
import { DomainsProvider } from '../context/DomainsContext';
import * as csrGenerator from '../utils/csrGenerator';
import type { GeneratedCsrResult } from '@krakenkey/shared';

// Mock API
vi.mock('../services/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [
        { hostname: 'example.com', isVerified: true },
        { hostname: 'www.example.com', isVerified: true },
      ],
    }),
  },
}));

// Mock toast
vi.mock('../utils/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Partial mock - only mock async functions, keep pure functions real
vi.mock('../utils/csrGenerator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csrGenerator')>();
  return {
    ...actual,
    generateCsr: vi.fn(),
    generateKeyPair: vi.fn(),
    // Keep these real:
    isBrowserCompatible: actual.isBrowserCompatible,
    sanitizeErrorMessage: actual.sanitizeErrorMessage,
    getSecurityLevel: actual.getSecurityLevel,
    getGenerationTime: actual.getGenerationTime,
  };
});

const mockCsrResult: GeneratedCsrResult = {
  csrPem:
    '-----BEGIN CERTIFICATE REQUEST-----\nMOCK_CSR\n-----END CERTIFICATE REQUEST-----',
  privateKeyPem:
    '-----BEGIN PRIVATE KEY-----\nSECRET_KEY\n-----END PRIVATE KEY-----',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nPUBLIC\n-----END PUBLIC KEY-----',
  algorithm: 'RSA',
  keySize: 2048,
  keyType: 'RSA-2048',
};

describe('CsrGenerator - Security Tests', () => {
  const mockOnCsrGenerated = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <DomainsProvider>
        <CsrGenerator
          onCsrGenerated={mockOnCsrGenerated}
          onCancel={mockOnCancel}
        />
      </DomainsProvider>,
    );
  };

  describe('Private Key Handling', () => {
    it('should not expose private key in initial DOM', () => {
      const { container } = renderComponent();

      // Private key should not be in the DOM on initial render
      expect(container.innerHTML).not.toContain('BEGIN PRIVATE KEY');
    });

    it(
      'should only pass CSR PEM to onCsrGenerated (not private key)',
      { timeout: 10000 },
      async () => {
        vi.mocked(csrGenerator.generateCsr).mockResolvedValue(mockCsrResult);

        renderComponent();

        // Fill CN and generate
        const cnInput = screen.getByPlaceholderText('example.com');
        await userEvent.type(cnInput, 'example.com');

        const generateButton = screen.getByText('Generate CSR');
        await userEvent.click(generateButton);

        // Wait for private key modal
        await waitFor(() => {
          expect(
            screen.getByText(/Save Your Private Key/i),
          ).toBeInTheDocument();
        });

        // Wait 3+ seconds for checkbox to appear
        await waitFor(
          () => {
            expect(
              screen.getByText(/I have securely saved/i),
            ).toBeInTheDocument();
          },
          { timeout: 4000 },
        );

        // Check the box
        const checkbox = screen.getByRole('checkbox');
        await userEvent.click(checkbox);

        // Click continue
        const continueButton = screen.getByText('Continue');
        await userEvent.click(continueButton);

        // Verify callback only received CSR PEM, not private key
        await waitFor(() => {
          expect(mockOnCsrGenerated).toHaveBeenCalledTimes(1);
          const callArg = mockOnCsrGenerated.mock.calls[0][0];
          expect(callArg).toContain('CERTIFICATE REQUEST');
          expect(callArg).not.toContain('PRIVATE KEY');
        });
      },
    );
  });

  describe('Checkpoint Security (3-second delay)', () => {
    it('should not show confirmation checkbox immediately', async () => {
      vi.mocked(csrGenerator.generateCsr).mockResolvedValue(mockCsrResult);

      renderComponent();

      const cnInput = screen.getByPlaceholderText('example.com');
      await userEvent.type(cnInput, 'example.com');

      const generateButton = screen.getByText('Generate CSR');
      await userEvent.click(generateButton);

      // Wait for modal
      await waitFor(() => {
        expect(screen.getByText(/Save Your Private Key/i)).toBeInTheDocument();
      });

      // Immediately after modal appears, should show "Please read" message, not checkbox
      expect(screen.getByText(/Please read the warning/i)).toBeInTheDocument();

      // Continue button should be disabled
      const continueButton = screen.getByText('Continue');
      expect(continueButton).toBeDisabled();
    });

    it('should show checkbox after ~3 seconds', async () => {
      vi.mocked(csrGenerator.generateCsr).mockResolvedValue(mockCsrResult);

      renderComponent();

      const cnInput = screen.getByPlaceholderText('example.com');
      await userEvent.type(cnInput, 'example.com');

      const generateButton = screen.getByText('Generate CSR');
      await userEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(/Save Your Private Key/i)).toBeInTheDocument();
      });

      // After 3+ seconds, checkbox should appear
      await waitFor(
        () => {
          expect(screen.getByRole('checkbox')).toBeInTheDocument();
        },
        { timeout: 4000 },
      );
    });
  });

  describe('Browser Compatibility', () => {
    it('should show error when browser is incompatible', () => {
      // Mock isBrowserCompatible to return false
      vi.spyOn(csrGenerator, 'isBrowserCompatible').mockReturnValue(false);

      renderComponent();

      // Should show error about browser support
      expect(screen.getByText(/does not support/i)).toBeInTheDocument();

      // Should only show Close button, not the form
      expect(screen.getByText('Close')).toBeInTheDocument();
      expect(screen.queryByText('Generate CSR')).not.toBeInTheDocument();

      // Restore
      vi.mocked(csrGenerator.isBrowserCompatible).mockRestore();
    });
  });

  describe('Default Key Type Security', () => {
    it('should default to ECDSA-P384 (strongest recommended option)', () => {
      renderComponent();

      // The ECDSA-P384 radio should be checked by default
      const radio = screen.getByDisplayValue('ECDSA-P384') as HTMLInputElement;
      expect(radio.checked).toBe(true);
    });

    it('should show warning when RSA-2048 is selected', async () => {
      renderComponent();

      // Select RSA-2048
      const rsa2048Radio = screen.getByDisplayValue('RSA-2048');
      await userEvent.click(rsa2048Radio);

      // Should show minimum strength warning
      expect(screen.getByText(/minimum strength/i)).toBeInTheDocument();
    });
  });
});
