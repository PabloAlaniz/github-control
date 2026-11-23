import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/atoms/Card';
import { Input } from '../components/atoms/Input';
import { Button } from '../components/atoms/Button';
import { Text } from '../components/atoms/Text';
import { fetchSetupStatus, submitSetup } from '../lib/setup';
import { login } from '../lib/auth';

function Field({ id, label, hint, children }) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
            {children}
            {hint && <p className="text-xs text-gray-500">{hint}</p>}
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

/** First-run wizard: shown only while the server reports it is not configured. */
export function SetupPage() {
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [setupCode, setSetupCode] = useState('');
    const [driver, setDriver] = useState('json');
    const [token, setToken] = useState('');
    const [orgs, setOrgs] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        fetchSetupStatus().then((s) => {
            if (!active) return;
            setStatus(s);
            if (s.storageOptions?.length) setDriver(s.storageOptions[0].id); // first option is the recommended one
        });
        return () => { active = false; };
    }, []);

    if (!status) {
        return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Loading…</div>;
    }
    if (status.configured) {
        return <Navigate to="/" replace />;
    }

    const needs = status.needs ?? { storage: true, github: true, admin: true };

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (needs.admin && password !== confirm) {
            setError('Passwords do not match');
            return;
        }

        setSaving(true);
        try {
            await submitSetup({
                setupCode: setupCode.trim(),
                ...(needs.storage && { storage: { driver } }),
                ...(needs.github && {
                    github: { token: token.trim(), orgs: orgs.split(',').map((o) => o.trim()).filter(Boolean) },
                }),
                ...(needs.admin && { admin: { username: username.trim(), password } }),
            });
            if (needs.admin) {
                await login(username.trim(), password);
                navigate('/');
            } else {
                navigate('/login');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <CardTitle className="text-center text-xl">Set up GitHub Control</CardTitle>
                    <Text variant="muted" className="text-center">
                        A few settings and you are ready. You can change them later in the config file.
                    </Text>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200">
                                {error}
                            </div>
                        )}

                        <Field
                            id="setup-code"
                            label="Setup code"
                            hint="Printed in the server log at startup (for Docker: docker logs github-control). It proves you run this server."
                        >
                            <Input
                                id="setup-code"
                                value={setupCode}
                                onChange={(e) => setSetupCode(e.target.value)}
                                autoComplete="off"
                                required
                                autoFocus
                            />
                        </Field>

                        {needs.storage && (
                            <Section title="Where to keep your data">
                                <div className="space-y-2">
                                    {(status.storageOptions ?? []).map((option) => (
                                        <label
                                            key={option.id}
                                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                                                driver === option.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="storage"
                                                value={option.id}
                                                checked={driver === option.id}
                                                onChange={() => setDriver(option.id)}
                                                className="mt-1"
                                            />
                                            <span>
                                                <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                                                <span className="block text-xs text-gray-500">{option.description}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {needs.github && (
                            <Section title="GitHub access">
                                <Field
                                    id="github-token"
                                    label="Personal access token"
                                    hint="Needs the repo scope to read your repositories. It is stored on this server only."
                                >
                                    <Input
                                        id="github-token"
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="ghp_…"
                                        autoComplete="off"
                                        required
                                    />
                                </Field>
                                <Field
                                    id="github-orgs"
                                    label="Organizations (optional)"
                                    hint="Comma-separated. Their repositories are added to your own."
                                >
                                    <Input
                                        id="github-orgs"
                                        value={orgs}
                                        onChange={(e) => setOrgs(e.target.value)}
                                        placeholder="my-org, another-org"
                                    />
                                </Field>
                            </Section>
                        )}

                        {needs.admin && (
                            <Section title="Your account">
                                <Field id="admin-username" label="Username">
                                    <Input
                                        id="admin-username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        autoComplete="username"
                                        required
                                    />
                                </Field>
                                <Field id="admin-password" label="Password" hint="At least 8 characters.">
                                    <Input
                                        id="admin-password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="new-password"
                                        minLength={8}
                                        required
                                    />
                                </Field>
                                <Field id="admin-confirm" label="Confirm password">
                                    <Input
                                        id="admin-confirm"
                                        type="password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        autoComplete="new-password"
                                        required
                                    />
                                </Field>
                            </Section>
                        )}

                        <Button type="submit" disabled={saving} className="w-full">
                            {saving ? 'Saving…' : 'Finish setup'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
