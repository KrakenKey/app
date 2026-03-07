import { useState, useEffect } from 'react';
import { AlertTriangle, Download, Copy, Plus, Trash2, Loader2 } from 'lucide-react';
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
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';

interface CsrGeneratorProps {
  onCsrGenerated: (csrPem: string) => void;
  onCancel: () => void;
}

export default function CsrGenerator({ onCsrGenerated, onCancel }: CsrGeneratorProps) {
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

  const [keyType, setKeyType] = useState<KeyType>('ECDSA-P384');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedCsr, setGeneratedCsr] = useState<string | null>(null);
  const [csrPreview, setCsrPreview] = useState<CsrPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Private key modal state
  const [showPrivateKeyModal, setShowPrivateKeyModal] = useState(false);
  const [privateKeyPem, setPrivateKeyPem] = useState<string>('');
  const [publicKeyPem, setPublicKeyPem] = useState<string>('');
  const [showSaveCheckbox, setShowSaveCheckbox] = useState(false);
  const [privateKeySaved, setPrivateKeySaved] = useState(false);

  const { verifiedDomains, loading: domainsLoading, fetchDomains } = useDomains();

  useEffect(() => {
    if (!isBrowserCompatible()) {
      setCompatible(false);
      setError(
        'Your browser does not support cryptographic operations. ' +
        'Please upgrade to the latest version of Chrome, Firefox, Safari, or Edge.'
      );
    }
    fetchDomains();
  }, [fetchDomains]);

  useEffect(() => {
    if (showPrivateKeyModal) {
      setShowSaveCheckbox(false);
      setPrivateKeySaved(false);
      const timer = setTimeout(() => setShowSaveCheckbox(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [showPrivateKeyModal]);

  const handleGenerate = async () => {
    setError(null);
    setFieldErrors({});

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

    const totalSans = sanDnsNames.filter(d => d.trim()).length
      + sanIpAddresses.filter(i => i.trim()).length
      + sanEmailAddresses.filter(e => e.trim()).length;
    if (totalSans > 100) {
      setError('Too many Subject Alternative Names. Maximum 100 entries allowed.');
      toast.error('Too many SAN entries');
      return;
    }

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

    const allDomains = [commonName.trim(), ...sanDnsNames.filter(d => d.trim())];
    const verifiedDomainNames = verifiedDomains.map(d => d.hostname);
    const authError = validateDomainAuthorization(allDomains, verifiedDomainNames);
    if (authError) {
      setError(authError);
      toast.error('Domain authorization failed');
      return;
    }

    const sans: CsrSanFields = {
      dnsNames: sanDnsNames.filter(d => d.trim()),
      ipAddresses: sanIpAddresses.filter(ip => ip.trim()),
      emailAddresses: sanEmailAddresses.filter(e => e.trim()),
    };

    try {
      setGenerating(true);
      const result = await generateCsr(keyType, subject, sans);
      setGeneratedCsr(result.csrPem);
      setPublicKeyPem(result.publicKeyPem);

      const preview: CsrPreviewData = {
        commonName: subject.commonName,
        sans: [...sans.dnsNames, ...sans.ipAddresses, ...sans.emailAddresses],
        keyType: `${result.algorithm} ${result.keySize === 256 ? 'P-256' : result.keySize === 384 ? 'P-384' : result.keySize}`,
        keySize: result.keySize,
        securityLevel: getSecurityLevel(keyType),
      };
      setCsrPreview(preview);
      setPrivateKeyPem(result.privateKeyPem);
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
    setPrivateKeyPem('');
    setShowPrivateKeyModal(false);
    if (generatedCsr) {
      onCsrGenerated(generatedCsr);
    }
  };

  if (!compatible) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 text-red-400">
          {error}
        </div>
        <Button variant="secondary" onClick={onCancel}>Close</Button>
      </div>
    );
  }

  if (generatedCsr && csrPreview && !showPrivateKeyModal) {
    return (
      <div className="max-w-3xl mx-auto">
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">CSR Generated Successfully</h3>

        <Card className="mb-4">
          <h4 className="text-sm font-medium text-zinc-400 mb-3">CSR Preview</h4>
          <div className="space-y-2 text-sm mb-4">
            <div className="flex gap-2">
              <span className="text-zinc-500 min-w-[180px]">Common Name:</span>
              <span className="text-zinc-200 font-mono">{csrPreview.commonName}</span>
            </div>
            {csrPreview.sans.length > 0 && (
              <div className="flex gap-2">
                <span className="text-zinc-500 min-w-[180px]">Subject Alternative Names:</span>
                <span className="text-zinc-200 font-mono">{csrPreview.sans.join(', ')}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-zinc-500 min-w-[180px]">Key Type:</span>
              <span className="text-zinc-200 font-mono">{csrPreview.keyType}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-zinc-500 min-w-[180px]">Key Size:</span>
              <span className="text-zinc-200 font-mono">{csrPreview.keySize} bits ({csrPreview.securityLevel})</span>
            </div>
          </div>

          <h5 className="text-sm font-medium text-zinc-400 mb-2">CSR PEM:</h5>
          <textarea
            readOnly
            value={generatedCsr}
            rows={8}
            className="w-full font-mono text-xs p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 resize-y"
          />

          <details className="mt-4">
            <summary className="text-sm text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors p-2 bg-zinc-950 rounded-lg">
              Show Public Key
            </summary>
            <textarea
              readOnly
              value={publicKeyPem}
              rows={6}
              className="w-full font-mono text-xs p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 resize-y mt-2"
            />
          </details>
        </Card>

        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-sm text-cyan-400">
          The CSR has been populated in the certificate request form. Review it and click "Submit CSR" to request your certificate.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h3 className="text-lg font-semibold text-zinc-100 mb-1">Generate Certificate Signing Request</h3>
      <p className="text-sm text-zinc-500 mb-6">
        Generate a CSR with a new cryptographic key pair. Your private key will be generated locally and never sent to the server.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 text-red-400 text-sm whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Subject Fields */}
      <Card className="mb-6">
        <h4 className="text-sm font-medium text-zinc-200 mb-4">Subject Information</h4>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Common Name (CN) <span className="text-red-400">*</span>
          </label>
          <Input
            value={commonName}
            onChange={(e) => setCommonName(e.target.value)}
            placeholder="example.com"
            disabled={generating}
          />
          {fieldErrors.commonName && (
            <span className="block text-xs text-red-400 mt-1">{fieldErrors.commonName}</span>
          )}
          <span className="block text-xs text-zinc-600 mt-1">
            Must be a verified domain. This is the primary domain for your certificate.
          </span>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Organization (O)</label>
          <Input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Example Inc"
            disabled={generating}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Organizational Unit (OU)</label>
            <Input
              value={organizationalUnit}
              onChange={(e) => setOrganizationalUnit(e.target.value)}
              placeholder="IT Department"
              disabled={generating}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Locality (L)</label>
            <Input
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              placeholder="San Francisco"
              disabled={generating}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">State/Province (ST)</label>
            <Input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="California"
              disabled={generating}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Country (C)</label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="US"
              maxLength={2}
              disabled={generating}
            />
            {fieldErrors.country && (
              <span className="block text-xs text-red-400 mt-1">{fieldErrors.country}</span>
            )}
            <span className="block text-xs text-zinc-600 mt-1">2-letter ISO code (e.g., US, GB, FR)</span>
          </div>
        </div>
      </Card>

      {/* Subject Alternative Names */}
      <Card className="mb-6">
        <h4 className="text-sm font-medium text-zinc-200 mb-1">Subject Alternative Names (Optional)</h4>
        <p className="text-xs text-zinc-500 mb-4">
          Add additional domains, IP addresses, or email addresses to your certificate.
        </p>

        {/* DNS Names */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-zinc-300 mb-2">DNS Names</label>
          {sanDnsNames.map((dns, idx) => (
            <div key={idx} className="flex gap-2 mb-2">
              <Input
                value={dns}
                onChange={(e) => {
                  const newDns = [...sanDnsNames];
                  newDns[idx] = e.target.value;
                  setSanDnsNames(newDns);
                }}
                placeholder="www.example.com"
                disabled={generating}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setSanDnsNames(sanDnsNames.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setSanDnsNames([...sanDnsNames, ''])}>
            Add DNS Name
          </Button>
        </div>

        {/* IP Addresses */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-zinc-300 mb-2">IP Addresses</label>
          {sanIpAddresses.map((ip, idx) => (
            <div key={idx} className="flex gap-2 mb-2">
              <Input
                value={ip}
                onChange={(e) => {
                  const newIps = [...sanIpAddresses];
                  newIps[idx] = e.target.value;
                  setSanIpAddresses(newIps);
                }}
                placeholder="192.168.1.1"
                disabled={generating}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setSanIpAddresses(sanIpAddresses.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setSanIpAddresses([...sanIpAddresses, ''])}>
            Add IP Address
          </Button>
        </div>

        {/* Email Addresses */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Email Addresses</label>
          {sanEmailAddresses.map((email, idx) => (
            <div key={idx} className="flex gap-2 mb-2">
              <Input
                value={email}
                onChange={(e) => {
                  const newEmails = [...sanEmailAddresses];
                  newEmails[idx] = e.target.value;
                  setSanEmailAddresses(newEmails);
                }}
                placeholder="admin@example.com"
                disabled={generating}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setSanEmailAddresses(sanEmailAddresses.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setSanEmailAddresses([...sanEmailAddresses, ''])}>
            Add Email Address
          </Button>
        </div>
      </Card>

      {/* Key Type Selector */}
      <Card className="mb-6">
        <h4 className="text-sm font-medium text-zinc-200 mb-4">Cryptographic Key Type</h4>

        <div className="space-y-2">
          {(['ECDSA-P384', 'ECDSA-P256', 'RSA-4096', 'RSA-2048'] as KeyType[]).map((kt) => (
            <label
              key={kt}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                keyType === kt
                  ? 'border-cyan-500/50 bg-cyan-500/5'
                  : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30'
              }`}
            >
              <input
                type="radio"
                name="keyType"
                value={kt}
                checked={keyType === kt}
                onChange={(e) => setKeyType(e.target.value as KeyType)}
                disabled={generating}
                className="accent-cyan-500"
              />
              <span className="font-mono text-sm font-medium text-zinc-200 min-w-[100px]">{kt}</span>
              <span className="text-xs text-zinc-500 ml-auto">
                {getSecurityLevel(kt)} &bull; {getGenerationTime(kt)}
              </span>
              {kt === 'ECDSA-P384' && <Badge variant="success">Recommended</Badge>}
            </label>
          ))}
        </div>

        {keyType === 'RSA-2048' && (
          <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            RSA 2048 is the minimum strength allowed by Let's Encrypt. For better security, we recommend RSA 4096 or ECDSA P-384.
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={generating}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleGenerate}
          disabled={generating || domainsLoading}
          icon={generating ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
        >
          {generating ? 'Generating...' : 'Generate CSR'}
        </Button>
      </div>

      {/* Private Key Modal */}
      <Modal
        open={showPrivateKeyModal}
        onClose={() => {}}
        title=""
        className="max-w-2xl"
      >
        <h3 className="text-lg font-semibold text-red-400 flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5" />
          Save Your Private Key
        </h3>

        <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-lg p-4 mb-4 space-y-2">
          <p className="text-sm font-bold text-amber-400">CRITICAL: SAVE THIS PRIVATE KEY NOW</p>
          <p className="text-sm text-zinc-300">
            This private key will NOT be shown again and is NOT stored by KrakenKey.
            You are the sole custodian. Without it, your certificate is useless.
          </p>
          <p className="text-sm text-zinc-300">
            <strong className="text-amber-400">Security Warning:</strong> Clipboard history tools may retain this key.
            If you copy it, securely delete it from clipboard history after pasting.
          </p>
        </div>

        <textarea
          readOnly
          value={privateKeyPem}
          rows={12}
          className="w-full font-mono text-xs p-3 bg-amber-500/5 border-2 border-amber-500/30 rounded-lg text-zinc-300 resize-y mb-4"
          autoComplete="off"
          spellCheck={false}
          data-sensitive="true"
        />

        <div className="flex gap-3 mb-5">
          <Button variant="primary" icon={<Download className="w-4 h-4" />} onClick={handleDownloadPrivateKey}>
            Download Private Key
          </Button>
          <Button variant="secondary" icon={<Copy className="w-4 h-4" />} onClick={handleCopyPrivateKey}>
            Copy to Clipboard
          </Button>
        </div>

        {showSaveCheckbox ? (
          <label className="flex items-center gap-3 p-3 bg-zinc-950 border border-zinc-800 rounded-lg cursor-pointer text-sm text-zinc-300 mb-4">
            <input
              type="checkbox"
              checked={privateKeySaved}
              onChange={(e) => setPrivateKeySaved(e.target.checked)}
              className="accent-cyan-500"
            />
            I have securely saved my private key and understand it will not be shown again.
          </label>
        ) : (
          <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-center text-sm text-cyan-400 mb-4">
            Please read the warning above carefully...
          </div>
        )}

        <Button
          variant="primary"
          onClick={handleContinue}
          disabled={!privateKeySaved}
          className="w-full"
        >
          Continue
        </Button>
      </Modal>
    </div>
  );
}
