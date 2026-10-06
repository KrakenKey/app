import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Copy,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Webhook,
} from 'lucide-react';
import {
  ALERT_EVENTS,
  ALERT_EVENT_DESCRIPTIONS,
  DEFAULT_ALERT_EVENTS,
  MAX_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_TYPES,
} from '@krakenkey/shared';
import type {
  AlertEvent,
  NotificationChannel,
  NotificationChannelType,
  TestNotificationChannelResponse,
  UpdateNotificationChannelRequest,
} from '@krakenkey/shared';
import * as channelService from '../services/notificationChannelService';
import { useActionSet } from '../hooks/useActionSet';
import { copyToClipboard } from '../utils/clipboard';
import { toast } from '../utils/toast';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';

export const SIGNATURE_DOCS_URL =
  'https://github.com/KrakenKey/app/blob/main/backend/docs/API_REFERENCE.md#verifying-the-signature';

const TYPE_INFO: Record<
  NotificationChannelType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    placeholder: string;
    help: string;
  }
> = {
  slack: {
    label: 'Slack',
    icon: MessageSquare,
    placeholder: 'https://hooks.slack.com/services/...',
    help: 'A Slack incoming webhook URL, starting with https://hooks.slack.com/services/.',
  },
  teams: {
    label: 'Microsoft Teams',
    icon: Users,
    placeholder: 'https://....logic.azure.com/workflows/...',
    help: 'The URL from a Teams Workflows flow that starts with "When a Teams webhook request is received". Office 365 connector URLs are not accepted because Microsoft has retired connectors.',
  },
  webhook: {
    label: 'Webhook',
    icon: Webhook,
    placeholder: 'https://hooks.example.com/krakenkey',
    help: 'Any HTTPS URL whose host resolves to a public address. Each delivery is signed with a secret you get once.',
  },
};

/** Short label for an event, e.g. "cert.expiring" -> "cert expiring". */
function shortEvent(event: AlertEvent): string {
  return event.replace(/[._]/g, ' ');
}

/** Messages from a 400 response, or null for any other failure. */
function validationMessages(error: unknown): string[] | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) {
    return null;
  }
  const msg = (error.response.data as { message?: unknown } | undefined)
    ?.message;
  if (Array.isArray(msg)) return msg.map(String);
  if (typeof msg === 'string') return [msg];
  return ['The request was rejected. Check the fields and try again.'];
}

function sameEvents(a: AlertEvent[], b: AlertEvent[]): boolean {
  return a.length === b.length && a.every((e) => b.includes(e));
}

interface FormState {
  /** Channel being edited, or null when adding one. */
  editing: NotificationChannel | null;
  type: NotificationChannelType;
  name: string;
  url: string;
  events: AlertEvent[];
}

const emptyForm = (): FormState => ({
  editing: null,
  type: 'slack',
  name: '',
  url: '',
  events: [...DEFAULT_ALERT_EVENTS],
});

interface Revealed {
  channelName: string;
  secret: string;
}

const AlertChannels: React.FC = () => {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestNotificationChannelResponse>
  >({});
  const busy = useActionSet<string>();

  const load = useCallback(async () => {
    try {
      const data = await channelService.fetchNotificationChannels();
      setChannels(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load alert channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const atLimit = channels.length >= MAX_NOTIFICATION_CHANNELS;

  const replaceChannel = (updated: NotificationChannel) =>
    setChannels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  const openCreate = () => {
    setFormErrors([]);
    setForm(emptyForm());
  };

  const openEdit = (channel: NotificationChannel) => {
    setFormErrors([]);
    setForm({
      editing: channel,
      type: channel.type,
      name: channel.name,
      url: '',
      events: [...channel.events],
    });
  };

  const closeForm = () => {
    setForm(null);
    setFormErrors([]);
  };

  const toggleFormEvent = (event: AlertEvent) => {
    setForm((f) =>
      f
        ? {
            ...f,
            events: f.events.includes(event)
              ? f.events.filter((e) => e !== event)
              : [...f.events, event],
          }
        : f,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    const name = form.name.trim();
    const url = form.url.trim();
    const errors: string[] = [];
    if (!name) errors.push('Enter a name for this channel.');
    if (!form.editing && !url) errors.push('Enter the destination URL.');
    if (form.events.length === 0) errors.push('Pick at least one event.');
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    // Keep events in the shared order so requests are predictable.
    const events = ALERT_EVENTS.filter((ev) => form.events.includes(ev));

    setSaving(true);
    setFormErrors([]);
    try {
      if (form.editing) {
        const original = form.editing;
        const changes: UpdateNotificationChannelRequest = {};
        if (name !== original.name) changes.name = name;
        if (url) changes.url = url;
        if (!sameEvents(events, original.events)) changes.events = events;
        if (Object.keys(changes).length > 0) {
          const updated = await channelService.updateNotificationChannel(
            original.id,
            changes,
          );
          replaceChannel(updated);
          toast.success(`Alert channel "${updated.name}" updated`);
        }
      } else {
        const { secret, ...created } =
          await channelService.createNotificationChannel({
            type: form.type,
            name,
            url,
            events,
          });
        setChannels((prev) => [...prev, created]);
        if (secret) setRevealed({ channelName: created.name, secret });
        toast.success(`Alert channel "${created.name}" added`);
      }
      setForm(null);
    } catch (error) {
      const messages = validationMessages(error);
      if (messages) setFormErrors(messages);
      console.error('Failed to save alert channel:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (channel: NotificationChannel) => {
    busy.add(channel.id);
    try {
      const updated = await channelService.updateNotificationChannel(
        channel.id,
        { enabled: !channel.enabled },
      );
      replaceChannel(updated);
    } catch (error) {
      console.error('Failed to update alert channel:', error);
    } finally {
      busy.remove(channel.id);
    }
  };

  const handleTest = async (channel: NotificationChannel) => {
    busy.add(channel.id);
    try {
      const result = await channelService.testNotificationChannel(channel.id);
      setTestResults((prev) => ({ ...prev, [channel.id]: result }));
      // The test is recorded as the channel's last delivery.
      replaceChannel({
        ...channel,
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: result.ok ? 'ok' : 'failed',
        lastError: result.ok ? null : result.error,
      });
    } catch (error) {
      console.error('Failed to send test alert:', error);
    } finally {
      busy.remove(channel.id);
    }
  };

  const handleDelete = async (channel: NotificationChannel) => {
    if (
      !confirm(
        `Delete alert channel "${channel.name}"? It stops receiving alerts right away.`,
      )
    ) {
      return;
    }
    busy.add(channel.id);
    try {
      await channelService.deleteNotificationChannel(channel.id);
      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
      if (form?.editing?.id === channel.id) closeForm();
      toast.success(`Alert channel "${channel.name}" deleted`);
    } catch (error) {
      console.error('Failed to delete alert channel:', error);
    } finally {
      busy.remove(channel.id);
    }
  };

  const handleRotate = async (channel: NotificationChannel) => {
    if (
      !confirm(
        `Rotate the signing secret for "${channel.name}"? The current secret stops working immediately.`,
      )
    ) {
      return;
    }
    busy.add(channel.id);
    try {
      const { secret } = await channelService.rotateNotificationChannelSecret(
        channel.id,
      );
      setRevealed({ channelName: channel.name, secret });
    } catch (error) {
      console.error('Failed to rotate webhook secret:', error);
    } finally {
      busy.remove(channel.id);
    }
  };

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
          <Webhook className="w-4 h-4" />
          Alert Channels
        </h2>
        {!form && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={openCreate}
            disabled={loading || atLimit}
          >
            Add channel
          </Button>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Send alerts to Slack, Microsoft Teams or your own HTTPS endpoint, in
        addition to email. {channels.length} of {MAX_NOTIFICATION_CHANNELS}{' '}
        channels used.
      </p>

      {revealed && (
        <div
          className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col gap-3"
          data-testid="webhook-secret"
        >
          <p className="text-sm font-medium text-emerald-400">
            Signing secret for "{revealed.channelName}"
          </p>
          <code className="block bg-zinc-950 rounded-lg px-4 py-3 font-mono text-sm text-zinc-200 break-all">
            {revealed.secret}
          </code>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => copyToClipboard(revealed.secret)}
            >
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Copy this secret now. It will not be shown again.
          </p>
          <p className="text-xs text-zinc-400">
            Each delivery carries{' '}
            <code className="text-zinc-300">
              X-KrakenKey-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;
            </code>
            , where v1 is the HMAC-SHA256 of{' '}
            <code className="text-zinc-300">"&lt;t&gt;.&lt;raw body&gt;"</code>{' '}
            keyed with this secret. Compare it in constant time and reject old
            timestamps.{' '}
            <a
              href={SIGNATURE_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              How to verify signatures
            </a>
          </p>
        </div>
      )}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg bg-zinc-950 p-4 flex flex-col gap-4"
          aria-label={form.editing ? 'Edit alert channel' : 'Add alert channel'}
          noValidate
        >
          <h3 className="text-sm font-medium text-zinc-200">
            {form.editing
              ? `Edit "${form.editing.name}"`
              : 'Add an alert channel'}
          </h3>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="alert-channel-type"
              className="text-sm font-medium text-zinc-300"
            >
              Type
            </label>
            <select
              id="alert-channel-type"
              value={form.type}
              disabled={!!form.editing}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as NotificationChannelType,
                })
              }
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none disabled:opacity-50"
            >
              {NOTIFICATION_CHANNEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_INFO[t].label}
                </option>
              ))}
            </select>
          </div>

          <Input
            id="alert-channel-name"
            label="Name"
            value={form.name}
            maxLength={100}
            placeholder="e.g. #ops-alerts"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          <Input
            id="alert-channel-url"
            label="URL"
            type="url"
            value={form.url}
            autoComplete="off"
            placeholder={
              form.editing
                ? `Current: ${form.editing.urlMasked}`
                : TYPE_INFO[form.type].placeholder
            }
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            helpText={
              form.editing
                ? `Leave blank to keep the current URL. ${TYPE_INFO[form.type].help}`
                : TYPE_INFO[form.type].help
            }
          />

          <fieldset>
            <legend className="text-sm font-medium text-zinc-300 mb-2">
              Events
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALERT_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-cyan-600"
                    checked={form.events.includes(event)}
                    onChange={() => toggleFormEvent(event)}
                  />
                  <span>
                    <span className="block text-xs font-mono text-zinc-200">
                      {event}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {ALERT_EVENT_DESCRIPTIONS[event]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {formErrors.length > 0 && (
            <ul
              role="alert"
              className="text-xs text-red-400 space-y-1 rounded-lg border border-red-500/20 bg-red-500/5 p-3"
            >
              {formErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={saving}>
              {saving
                ? 'Saving...'
                : form.editing
                  ? 'Save changes'
                  : 'Add channel'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={closeForm}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading alert channels...</p>
      ) : channels.length === 0 ? (
        !form && (
          <p className="text-sm text-zinc-500">
            No alert channels yet. Add one to get alerts in chat or your own
            systems.
          </p>
        )
      ) : (
        <ul className="space-y-3">
          {channels.map((channel) => {
            const info = TYPE_INFO[channel.type];
            const Icon = info.icon;
            const isBusy = busy.has(channel.id);
            const result = testResults[channel.id];
            return (
              <li
                key={channel.id}
                className="p-3 bg-zinc-950 rounded-lg flex flex-col gap-2"
                data-testid={`alert-channel-${channel.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                      <span className="text-sm text-zinc-200 font-medium break-all">
                        {channel.name}
                      </span>
                      <Badge variant="neutral" dot={false}>
                        {info.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500 font-mono break-all mt-1">
                      {channel.urlMasked}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={channel.enabled}
                    aria-label={`Enable ${channel.name}`}
                    disabled={isBusy}
                    onClick={() => handleToggleEnabled(channel)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      channel.enabled ? 'bg-cyan-600' : 'bg-zinc-700'
                    } ${isBusy ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${
                        channel.enabled
                          ? 'translate-x-4 ml-0.5'
                          : 'translate-x-0 ml-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  {channel.events.map((event) => (
                    <span
                      key={event}
                      title={ALERT_EVENT_DESCRIPTIONS[event]}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 text-[11px] text-zinc-400"
                    >
                      {shortEvent(event)}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-zinc-500">
                  {channel.lastDeliveryAt ? (
                    <>
                      Last delivery{' '}
                      {new Date(channel.lastDeliveryAt).toLocaleString()}:{' '}
                      {channel.lastDeliveryStatus === 'ok' ? (
                        <span className="text-emerald-400">ok</span>
                      ) : (
                        <span className="text-red-400">
                          failed
                          {channel.lastError ? ` (${channel.lastError})` : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    'No deliveries yet'
                  )}
                </p>

                {result && (
                  <p
                    role="status"
                    className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {result.ok
                      ? `Test alert delivered${result.status ? ` (HTTP ${result.status})` : ''}.`
                      : `Test alert failed${result.status ? ` (HTTP ${result.status})` : ''}: ${result.error ?? 'unknown error'}`}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Send className="w-3.5 h-3.5" />}
                    disabled={isBusy}
                    onClick={() => handleTest(channel)}
                    aria-label={`Send test to ${channel.name}`}
                  >
                    Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil className="w-3.5 h-3.5" />}
                    disabled={isBusy || saving}
                    onClick={() => openEdit(channel)}
                    aria-label={`Edit ${channel.name}`}
                  >
                    Edit
                  </Button>
                  {channel.type === 'webhook' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                      disabled={isBusy}
                      onClick={() => handleRotate(channel)}
                      aria-label={`Rotate secret for ${channel.name}`}
                    >
                      Rotate secret
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    disabled={isBusy}
                    onClick={() => handleDelete(channel)}
                    aria-label={`Delete ${channel.name}`}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {atLimit && (
        <p className="text-xs text-amber-400 mt-3">
          You have reached the limit of {MAX_NOTIFICATION_CHANNELS} channels.
          Delete one to add another.
        </p>
      )}
    </Card>
  );
};

export default AlertChannels;
