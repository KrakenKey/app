import { useState, useEffect } from 'react';
import type { KeyType, CsrSubjectFields, CsrSanFields, CsrPreviewData } from '@krakenkey/shared';
import { useDomains } from '../context/DomainsContext';
import {
  generateCsr,
  isBrowserCompatible,
  getSecurityLevel,
  getGenerationTime,
} from '../utils/csrGenerator';
import {
  validateSubjectFields,
  validateDnsName,
  validateIpAddress,
  validateEmail,
  validateDomainAuthorization,
} from '../utils/csrValidation';
import { toast } from '../utils/toast';
import './CsrGenerator.css';

interface CsrGeneratorProps {
  onCsrGenerated: (csrPem: string) => void;
  onCancel: () => void;
}

export default function CsrGenerator({ onCsrGenerated, onCancel }: CsrGeneratorProps) {
  // Check browser compatibility on mount
  const [compatible, setCompatible] = useState(true);

  // Form state
  const [commonName, setCommonName] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationalUnit, setOrganizationalUnit] = useState('');
  const [locality, setLocality] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');

  const [sanDnsNames, setSanDnsNames] = useState<string[]>([]);
  const [sanIpAddresses, setSanIpAddresses] = useState<string[]>([]);
  const [sanEmailAddresses, setSanEmailAddresses] = useState<string[]>([]);

  const [keyType, setKeyType] = useState<KeyType>('ECDSA-P384'); // Secure default

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedCsr, setGeneratedCsr] = useState<string | null>(null);
  const [csrPreview, setCsrPreview] = useState<CsrPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Private key modal state
  const [showPrivateKeyModal, setShowPrivateKeyModal] = useState(false);
  const [privateKeyPem, setPrivateKeyPem] = useState<string>(''); // Local variable, not persisted
  const [publicKeyPem, setPublicKeyPem] = useState<string>('');
  const [showSaveCheckbox, setShowSaveCheckbox] = useState(false);
  const [privateKeySaved, setPrivateKeySaved] = useState(false);

  // Get verified domains from context
  const { verifiedDomains, loading: domainsLoading, fetchDomains } = useDomains();

  useEffect(() => {
    // Check browser compatibility
    if (!isBrowserCompatible()) {
      setCompatible(false);
      setError(
        'Your browser does not support cryptographic operations. ' +
        'Please upgrade to the latest version of Chrome, Firefox, Safari, or Edge.'
      );
    }

    // Fetch domains if not already loaded
    fetchDomains();
  }, [fetchDomains]);

  // Private key modal: Show checkbox after 3 seconds
  useEffect(() => {
    if (showPrivateKeyModal) {
      setShowSaveCheckbox(false);
      setPrivateKeySaved(false);

      const timer = setTimeout(() => {
        setShowSaveCheckbox(true);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [showPrivateKeyModal]);

  const handleGenerate = async () => {
    setError(null);
    setFieldErrors({});

    // Validate subject fields
    const subject: CsrSubjectFields = {
      commonName: commonName.trim(),
      organization: organization.trim() || undefined,
      organizationalUnit: organizationalUnit.trim() || undefined,
      locality: locality.trim() || undefined,
      state: state.trim() || undefined,
      country: country.trim().toUpperCase() || undefined,
    };

    const subjectErrors = validateSubjectFields(subject);
    if (subjectErrors) {
      setFieldErrors(subjectErrors);
      toast.error('Please fix the validation errors');
      return;
    }

    // Enforce maximum SAN entry count (100 total per Let's Encrypt limits)
    const totalSans = sanDnsNames.filter(d => d.trim()).length
      + sanIpAddresses.filter(i => i.trim()).length
      + sanEmailAddresses.filter(e => e.trim()).length;
    if (totalSans > 100) {
      setError('Too many Subject Alternative Names. Maximum 100 entries allowed.');
      toast.error('Too many SAN entries');
      return;
    }

    // Validate individual SAN entries
    const sanErrors: string[] = [];
    for (const dns of sanDnsNames.filter(d => d.trim())) {
      const err = validateDnsName(dns);
      if (err) sanErrors.push(`DNS "${dns}": ${err}`);
    }
    for (const ip of sanIpAddresses.filter(i => i.trim())) {
      const err = validateIpAddress(ip);
      if (err) sanErrors.push(`IP "${ip}": ${err}`);
    }
    for (const email of sanEmailAddresses.filter(e => e.trim())) {
      const err = validateEmail(email);
      if (err) sanErrors.push(`Email "${email}": ${err}`);
    }
    if (sanErrors.length > 0) {
      setError(`SAN validation errors:\n${sanErrors.join('\n')}`);
      toast.error('Please fix SAN validation errors');
      return;
    }

    // Collect all domains (CN + SANs)
    const allDomains = [
      commonName.trim(),
      ...sanDnsNames.filter(d => d.trim()),
    ];

    // Validate domain authorization
    const verifiedDomainNames = verifiedDomains.map(d => d.hostname);
    const authError = validateDomainAuthorization(allDomains, verifiedDomainNames);
    if (authError) {
      setError(authError);
      toast.error('Domain authorization failed');
      return;
    }

    // Build SANs
    const sans: CsrSanFields = {
      dnsNames: sanDnsNames.filter(d => d.trim()),
      ipAddresses: sanIpAddresses.filter(ip => ip.trim()),
      emailAddresses: sanEmailAddresses.filter(e => e.trim()),
    };

    try {
      setGenerating(true);

      // Generate CSR (this happens client-side, keys never sent to server)
      const result = await generateCsr(keyType, subject, sans);

      // Store CSR and public key
      setGeneratedCsr(result.csrPem);
      setPublicKeyPem(result.publicKeyPem);

      // Create preview data
      const preview: CsrPreviewData = {
        commonName: subject.commonName,
        sans: [...sans.dnsNames, ...sans.ipAddresses, ...sans.emailAddresses],
        keyType: `${result.algorithm} ${result.keySize === 256 ? 'P-256' : result.keySize === 384 ? 'P-384' : result.keySize}`,
        keySize: result.keySize,
        securityLevel: getSecurityLevel(keyType),
      };
      setCsrPreview(preview);

      // Store private key temporarily (will be cleared after user saves it)
      setPrivateKeyPem(result.privateKeyPem);

      // Show private key modal
      setShowPrivateKeyModal(true);

      toast.success('CSR generated successfully!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSR generation failed';
      setError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPrivateKey = () => {
    if (!privateKeyPem) return;

    const blob = new Blob([privateKeyPem], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `private-key-${commonName}-${Date.now()}.key`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Private key downloaded');
  };

  const handleCopyPrivateKey = () => {
    if (!privateKeyPem) return;

    navigator.clipboard.writeText(privateKeyPem);
    toast.success('Private key copied to clipboard');
    toast.info('Remember to securely delete from clipboard history');
  };

  const handleContinue = () => {
    // Clear private key from memory
    setPrivateKeyPem('');
    // (Setting to empty string doesn't guarantee memory zeroing in JS, but it's the best we can do)

    setShowPrivateKeyModal(false);

    // Pass CSR to parent component
    if (generatedCsr) {
      onCsrGenerated(generatedCsr);
    }
  };

  const handleAddSanDns = () => {
    setSanDnsNames([...sanDnsNames, '']);
  };

  const handleAddSanIp = () => {
    setSanIpAddresses([...sanIpAddresses, '']);
  };

  const handleAddSanEmail = () => {
    setSanEmailAddresses([...sanEmailAddresses, '']);
  };

  if (!compatible) {
    return (
      <div className="csr-generator">
        <div className="error-banner">
          {error}
        </div>
        <button onClick={onCancel} className="btn-secondary">
          Close
        </button>
      </div>
    );
  }

  if (generatedCsr && csrPreview && !showPrivateKeyModal) {
    // CSR Preview (after private key modal is dismissed)
    return (
      <div className="csr-generator">
        <h3>CSR Generated Successfully</h3>

        <div className="csr-preview-section">
          <h4>CSR Preview</h4>
          <div className="preview-fields">
            <div className="field">
              <label>Common Name:</label>
              <span>{csrPreview.commonName}</span>
            </div>
            {csrPreview.sans.length > 0 && (
              <div className="field">
                <label>Subject Alternative Names:</label>
                <span>{csrPreview.sans.join(', ')}</span>
              </div>
            )}
            <div className="field">
              <label>Key Type:</label>
              <span>{csrPreview.keyType}</span>
            </div>
            <div className="field">
              <label>Key Size:</label>
              <span>{csrPreview.keySize} bits ({csrPreview.securityLevel})</span>
            </div>
          </div>

          <h5>CSR PEM:</h5>
          <textarea readOnly value={generatedCsr} rows={8} className="csr-textarea" />

          <details className="public-key-details">
            <summary>Show Public Key</summary>
            <textarea readOnly value={publicKeyPem} rows={6} className="csr-textarea" />
          </details>
        </div>

        <p className="info-text">
          The CSR has been populated in the certificate request form. Review it and click "Submit CSR" to request your certificate.
        </p>
      </div>
    );
  }

  return (
    <div className="csr-generator">
      <h3>Generate Certificate Signing Request</h3>
      <p className="subtitle">
        Generate a CSR with a new cryptographic key pair. Your private key will be generated locally and never sent to the server.
      </p>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {/* Subject Fields */}
      <div className="form-section">
        <h4>Subject Information</h4>

        <div className="form-field">
          <label>
            Common Name (CN) <span className="required">*</span>
          </label>
          <input
            type="text"
            value={commonName}
            onChange={(e) => setCommonName(e.target.value)}
            placeholder="example.com"
            disabled={generating}
          />
          {fieldErrors.commonName && (
            <span className="field-error">{fieldErrors.commonName}</span>
          )}
          <span className="field-help">
            Must be a verified domain. This is the primary domain for your certificate.
          </span>
        </div>

        <div className="form-field">
          <label>Organization (O)</label>
          <input
            type="text"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Example Inc"
            disabled={generating}
          />
        </div>

        <div className="form-row">
          <div className="form-field">
            <label>Organizational Unit (OU)</label>
            <input
              type="text"
              value={organizationalUnit}
              onChange={(e) => setOrganizationalUnit(e.target.value)}
              placeholder="IT Department"
              disabled={generating}
            />
          </div>

          <div className="form-field">
            <label>Locality (L)</label>
            <input
              type="text"
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              placeholder="San Francisco"
              disabled={generating}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label>State/Province (ST)</label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="California"
              disabled={generating}
            />
          </div>

          <div className="form-field">
            <label>Country (C)</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="US"
              maxLength={2}
              disabled={generating}
            />
            {fieldErrors.country && (
              <span className="field-error">{fieldErrors.country}</span>
            )}
            <span className="field-help">2-letter ISO code (e.g., US, GB, FR)</span>
          </div>
        </div>
      </div>

      {/* Subject Alternative Names */}
      <div className="form-section">
        <h4>Subject Alternative Names (Optional)</h4>
        <p className="section-help">
          Add additional domains, IP addresses, or email addresses to your certificate.
        </p>

        <div className="san-section">
          <label>DNS Names</label>
          {sanDnsNames.map((dns, idx) => (
            <div key={idx} className="san-input-row">
              <input
                type="text"
                value={dns}
                onChange={(e) => {
                  const newDns = [...sanDnsNames];
                  newDns[idx] = e.target.value;
                  setSanDnsNames(newDns);
                }}
                placeholder="www.example.com"
                disabled={generating}
              />
              <button
                onClick={() => setSanDnsNames(sanDnsNames.filter((_, i) => i !== idx))}
                className="btn-remove"
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={handleAddSanDns} className="btn-secondary btn-small">
            + Add DNS Name
          </button>
        </div>

        <div className="san-section">
          <label>IP Addresses</label>
          {sanIpAddresses.map((ip, idx) => (
            <div key={idx} className="san-input-row">
              <input
                type="text"
                value={ip}
                onChange={(e) => {
                  const newIps = [...sanIpAddresses];
                  newIps[idx] = e.target.value;
                  setSanIpAddresses(newIps);
                }}
                placeholder="192.168.1.1"
                disabled={generating}
              />
              <button
                onClick={() => setSanIpAddresses(sanIpAddresses.filter((_, i) => i !== idx))}
                className="btn-remove"
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={handleAddSanIp} className="btn-secondary btn-small">
            + Add IP Address
          </button>
        </div>

        <div className="san-section">
          <label>Email Addresses</label>
          {sanEmailAddresses.map((email, idx) => (
            <div key={idx} className="san-input-row">
              <input
                type="text"
                value={email}
                onChange={(e) => {
                  const newEmails = [...sanEmailAddresses];
                  newEmails[idx] = e.target.value;
                  setSanEmailAddresses(newEmails);
                }}
                placeholder="admin@example.com"
                disabled={generating}
              />
              <button
                onClick={() => setSanEmailAddresses(sanEmailAddresses.filter((_, i) => i !== idx))}
                className="btn-remove"
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={handleAddSanEmail} className="btn-secondary btn-small">
            + Add Email Address
          </button>
        </div>
      </div>

      {/* Key Type Selector */}
      <div className="form-section">
        <h4>Cryptographic Key Type</h4>

        <div className="key-type-selector">
          {(['ECDSA-P384', 'ECDSA-P256', 'RSA-4096', 'RSA-2048'] as KeyType[]).map((kt) => (
            <label key={kt} className="key-type-option">
              <input
                type="radio"
                name="keyType"
                value={kt}
                checked={keyType === kt}
                onChange={(e) => setKeyType(e.target.value as KeyType)}
                disabled={generating}
              />
              <span className="key-type-label">{kt}</span>
              <span className="key-type-info">
                {getSecurityLevel(kt)} • {getGenerationTime(kt)}
              </span>
              {kt === 'ECDSA-P384' && <span className="recommended-badge">Recommended</span>}
            </label>
          ))}
        </div>

        {keyType === 'RSA-2048' && (
          <div className="key-type-warning">
            ⚠️ RSA 2048 is the minimum strength allowed by Let's Encrypt. For better security, we recommend RSA 4096 or ECDSA P-384.
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="form-actions">
        <button onClick={onCancel} className="btn-secondary" disabled={generating}>
          Cancel
        </button>
        <button onClick={handleGenerate} className="btn-primary" disabled={generating || domainsLoading}>
          {generating ? 'Generating...' : 'Generate CSR'}
        </button>
      </div>

      {/* Private Key Modal */}
      {showPrivateKeyModal && (
        <div className="modal-overlay">
          <div className="modal private-key-modal">
            <h3>⚠️ Save Your Private Key</h3>

            <div className="private-key-warning">
              <p><strong>CRITICAL: SAVE THIS PRIVATE KEY NOW</strong></p>
              <p>
                This private key will NOT be shown again and is NOT stored by KrakenKey.
                You are the sole custodian. Without it, your certificate is useless.
              </p>
              <p>
                <strong>Security Warning:</strong> Clipboard history tools may retain this key.
                If you copy it, securely delete it from clipboard history after pasting.
              </p>
            </div>

            <textarea
              readOnly
              value={privateKeyPem}
              rows={12}
              className="private-key-textarea"
              autoComplete="off"
              spellCheck={false}
              data-sensitive="true"
            />

            <div className="private-key-actions">
              <button onClick={handleDownloadPrivateKey} className="btn-primary">
                Download Private Key
              </button>
              <button onClick={handleCopyPrivateKey} className="btn-secondary">
                Copy to Clipboard
              </button>
            </div>

            {showSaveCheckbox ? (
              <label className="save-confirmation">
                <input
                  type="checkbox"
                  checked={privateKeySaved}
                  onChange={(e) => setPrivateKeySaved(e.target.checked)}
                />
                I have securely saved my private key and understand it will not be shown again.
              </label>
            ) : (
              <div className="save-checkpoint-timer">
                Please read the warning above carefully...
              </div>
            )}

            <button
              onClick={handleContinue}
              disabled={!privateKeySaved}
              className="btn-primary btn-full-width"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
