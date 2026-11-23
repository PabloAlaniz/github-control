import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/atoms/Card';
import { Input } from '../components/atoms/Input';
import { Button } from '../components/atoms/Button';
import { Text } from '../components/atoms/Text';
import { login, isAuthenticated } from '../lib/auth';

export function LoginPage() {
    const navigate = useNavigate();
    const from = useLocation().state?.from || '/';
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (isAuthenticated()) {
        return <Navigate to={from} replace />;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(username, password);
            navigate(from);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-center text-xl">GitHub Control</CardTitle>
                    <Text variant="muted" className="text-center">Sign in to your account</Text>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200">
                                {error}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label htmlFor="username" className="text-sm font-medium text-gray-700">
                                Username
                            </label>
                            <Input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Enter username"
                                required
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium text-gray-700">
                                Password
                            </label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                required
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full"
                        >
                            {loading ? 'Signing in...' : 'Sign in'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
