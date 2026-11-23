import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/atoms/Card';
import { Input } from '../components/atoms/Input';
import { Button } from '../components/atoms/Button';
import { Text } from '../components/atoms/Text';
import { apiFetch } from '../lib/api';

const LOCKED_NOTE = 'Set by an environment variable on the server.';

function Field({ id, label, hint, locked, children }) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
            {children}
            <p className="text-xs text-gray-500">{locked ? LOCKED_NOTE : hint}</p>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <fieldset className="space-y-3 border-t border-gray-200 pt-4">
            <legend className="text-sm font-semibold text-gray-900 pr-2">{title}</legend>
            {children}
        </fieldset>
    );
}

const BASELINE_CHOICES = [['on', 'Must be on'], ['off', 'Must be off'], ['ignore', 'Not checked']];
const toChoice = (expected) => (expected === null ? 'ignore' : expected ? 'on' : 'off');
/** `{ setting: 'on' | 'off' | 'ignore' }` as the `{ setting: expected }` map the API takes. */
const toBaseline = (choices) => Object.fromEntries(
    Object.entries(choices).filter(([, choice]) => choice !== 'ignore').map(([key, choice]) => [key, choice === 'on']),
);
const choicesOf = (options = []) => Object.fromEntries(options.map((option) => [option.key, toChoice(option.expected)]));

const parseOrgs = (text) => text.split(',').map((o) => o.trim()).filter(Boolean);

/** Change the server's settings without editing its config file. */
export function SettingsPage() {
    const navigate = useNavigate();
    const [settings, setSettings] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [token, setToken] = useState('');
    const [orgs, setOrgs] = useState('');
    const [interval, setIntervalHours] = useState('24');
    const [badges, setBadges] = useState(false);
    const [baseline, setBaseline] = useState({});
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    const apply = (next) => {
        setSettings(next);
        if (!next.editable) return;
        setOrgs(next.githubOrgs.join(', '));
        setIntervalHours(String(next.syncIntervalHours));
        setBadges(next.publicBadges);
        setBaseline(choicesOf(next.repoBaseline));
        setToken('');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
    };

    useEffect(() => {
        let active = true;
        apiFetch('/api/settings')
            .then(async (res) => {
                if (!res.ok) throw new Error('Could not load the settings');
                const body = await res.json();
                if (active) apply(body);
            })
            .catch((err) => { if (active) setLoadError(err.message); });
        return () => { active = false; };
    }, []);

    const isLocked = (name) => settings?.locked?.includes(name);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSaved(false);

        // Send only what changed.
        const patch = {};
        if (token.trim()) patch.githubToken = token.trim();
        if (parseOrgs(orgs).join(',') !== settings.githubOrgs.join(',')) patch.githubOrgs = parseOrgs(orgs);
        if (Number(interval) !== settings.syncIntervalHours) patch.syncIntervalHours = Number(interval);
        if (badges !== settings.publicBadges) patch.publicBadges = badges;
        if (JSON.stringify(toBaseline(baseline)) !== JSON.stringify(toBaseline(choicesOf(settings.repoBaseline)))) {
            patch.repoBaseline = toBaseline(baseline);
        }
        if (newPassword || currentPassword) {
            if (newPassword !== confirmPassword) {
                setError('The new passwords do not match');
                return;
            }
            patch.password = { current: currentPassword, next: newPassword };
        }
        if (Object.keys(patch).length === 0) {
            setError('Nothing to save');
            return;
        }

        setSaving(true);
        try {
            const res = await apiFetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const fieldErrors = Object.values(body.details?.fieldErrors ?? {}).flat();
                throw new Error([body.error, ...fieldErrors].filter(Boolean).join(': ') || 'Could not save the settings');
            }
            apply(body);
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="max-w-lg mx-auto space-y-4">
                <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Dashboard
                </Button>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">Settings</CardTitle>
                        {settings?.editable && (
                            <Text variant="muted">
                                Signed in as {settings.username || 'unknown'} · storage: {settings.storageDriver}
                            </Text>
                        )}
                    </CardHeader>
                    <CardContent>
                        {loadError && <Text className="text-red-600">{loadError}</Text>}
                        {!settings && !loadError && <Text variant="muted">Loading…</Text>}
                        {settings && !settings.editable && (
                            <Text variant="muted">
                                This server takes its settings from its deployment configuration; they cannot be changed here.
                            </Text>
                        )}
                        {settings?.editable && (
                            <form onSubmit={handleSubmit} className="space-y-5">
                                {error && (
                                    <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200">
                                        {error}
                                    </div>
                                )}
                                {saved && (
                                    <div role="status" className="bg-green-50 text-green-700 text-sm p-3 rounded-lg border border-green-200">
                                        Settings saved.
                                    </div>
                                )}

                                <Section title="GitHub access">
                                    <Field
                                        id="settings-token" label="Personal access token" locked={isLocked('githubToken')}
                                        hint={settings.githubTokenSet ? 'A token is set. Leave blank to keep it.' : 'No token set.'}
                                    >
                                        <Input
                                            id="settings-token" type="password" value={token} autoComplete="off"
                                            placeholder="ghp_…" disabled={isLocked('githubToken')}
                                            onChange={(e) => setToken(e.target.value)}
                                        />
                                    </Field>
                                    <Field
                                        id="settings-orgs" label="Organizations" locked={isLocked('githubOrgs')}
                                        hint="Comma-separated. Their repositories are added to your own."
                                    >
                                        <Input
                                            id="settings-orgs" value={orgs} placeholder="my-org, another-org"
                                            disabled={isLocked('githubOrgs')} onChange={(e) => setOrgs(e.target.value)}
                                        />
                                    </Field>
                                </Section>

                                <Section title="Sync">
                                    <Field
                                        id="settings-interval" label="Hours between automatic syncs"
                                        locked={isLocked('syncIntervalHours')} hint="0 turns the automatic sync off."
                                    >
                                        <Input
                                            id="settings-interval" type="number" min="0" max="720" value={interval}
                                            disabled={isLocked('syncIntervalHours')}
                                            onChange={(e) => setIntervalHours(e.target.value)}
                                        />
                                    </Field>
                                </Section>

                                <Section title="Badges">
                                    <label className="flex items-start gap-3 text-sm text-gray-700">
                                        <input
                                            type="checkbox" checked={badges} className="mt-1"
                                            disabled={isLocked('publicBadges')} onChange={(e) => setBadges(e.target.checked)}
                                        />
                                        <span>
                                            Serve public SVG badges
                                            <span className="block text-xs text-gray-500">
                                                {isLocked('publicBadges') ? LOCKED_NOTE : 'Anyone can fetch them, without signing in. Only for public repositories.'}
                                            </span>
                                        </span>
                                    </label>
                                </Section>

                                {settings.repoBaseline?.length > 0 && (
                                    <Section title="Repo settings baseline">
                                        <p className="text-xs text-gray-500">
                                            {isLocked('repoBaseline')
                                                ? LOCKED_NOTE
                                                : 'What every repository is expected to have. Repos that differ are flagged as drift; nothing changes on GitHub until you apply the baseline to a repo.'}
                                        </p>
                                        {settings.repoBaseline.map((option) => (
                                            <label key={option.key} htmlFor={`baseline-${option.key}`} className="flex items-center justify-between gap-3 text-sm text-gray-700">
                                                <span>{option.label}</span>
                                                <select
                                                    id={`baseline-${option.key}`}
                                                    value={baseline[option.key] ?? 'ignore'}
                                                    disabled={isLocked('repoBaseline')}
                                                    onChange={(e) => setBaseline((prev) => ({ ...prev, [option.key]: e.target.value }))}
                                                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100"
                                                >
                                                    {BASELINE_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                                </select>
                                            </label>
                                        ))}
                                    </Section>
                                )}

                                <Section title="Change password">
                                    {isLocked('password') ? (
                                        <Text variant="muted">{LOCKED_NOTE}</Text>
                                    ) : (
                                        <>
                                            <Field id="settings-current-password" label="Current password">
                                                <Input
                                                    id="settings-current-password" type="password" value={currentPassword}
                                                    autoComplete="current-password" onChange={(e) => setCurrentPassword(e.target.value)}
                                                />
                                            </Field>
                                            <Field id="settings-new-password" label="New password" hint="At least 8 characters.">
                                                <Input
                                                    id="settings-new-password" type="password" value={newPassword} minLength={8}
                                                    autoComplete="new-password" onChange={(e) => setNewPassword(e.target.value)}
                                                />
                                            </Field>
                                            <Field id="settings-confirm-password" label="Confirm new password">
                                                <Input
                                                    id="settings-confirm-password" type="password" value={confirmPassword}
                                                    autoComplete="new-password" onChange={(e) => setConfirmPassword(e.target.value)}
                                                />
                                            </Field>
                                        </>
                                    )}
                                </Section>

                                <Button type="submit" disabled={saving} className="w-full">
                                    {saving ? 'Saving…' : 'Save settings'}
                                </Button>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
