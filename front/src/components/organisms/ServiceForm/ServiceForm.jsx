import React, { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Input } from '../../atoms/Input';
import { Select } from '../../atoms/Select';
import { Text } from '../../atoms/Text';
import { Card } from '../../atoms/Card';
import { X } from 'lucide-react';

const PROVIDERS = [
    { value: 'gcp', label: 'Google Cloud' },
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'vercel', label: 'Vercel' },
    { value: 'aws', label: 'AWS' },
    { value: 'railway', label: 'Railway' },
    { value: 'render', label: 'Render' },
    { value: 'fly', label: 'Fly.io' },
    { value: 'heroku', label: 'Heroku' },
    { value: 'other', label: 'Other' },
];

const ENVS = [
    { value: 'production', label: 'Production' },
    { value: 'staging', label: 'Staging' },
    { value: 'development', label: 'Development' },
    { value: 'preview', label: 'Preview' },
];

export function ServiceForm({ service, onSubmit, onClose }) {
    const isEdit = !!service;
    const [form, setForm] = useState({
        name: service?.name || '',
        url: service?.url || '',
        provider: service?.provider || 'gcp',
        project: service?.project || '',
        region: service?.region || '',
        env: service?.env || 'production',
        source_repo_full_name: service?.sourceRepoFullName || service?.source_repo_full_name || '',
        source_path: service?.sourcePath || service?.source_path || '',
        description: service?.description || '',
    });
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (field) => (e) => {
        setForm(prev => ({ ...prev, [field]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await onSubmit(form);
            onClose();
        } catch {
            // error handled by parent
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-lg p-6 mx-4">
                <div className="flex items-center justify-between mb-4">
                    <Text size="lg" weight="semibold">
                        {isEdit ? 'Edit Service' : 'Add Service'}
                    </Text>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Name *</label>
                            <Input
                                value={form.name}
                                onChange={handleChange('name')}
                                placeholder="My API"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">URL</label>
                            <Input
                                value={form.url}
                                onChange={handleChange('url')}
                                placeholder="https://api.example.com"
                                type="url"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Provider *</label>
                            <Select value={form.provider} onChange={handleChange('provider')}>
                                {PROVIDERS.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </Select>
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Project</label>
                            <Input
                                value={form.project}
                                onChange={handleChange('project')}
                                placeholder="project-id"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Environment</label>
                            <Select value={form.env} onChange={handleChange('env')}>
                                {ENVS.map(e => (
                                    <option key={e.value} value={e.value}>{e.label}</option>
                                ))}
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Source Repo</label>
                            <Input
                                value={form.source_repo_full_name}
                                onChange={handleChange('source_repo_full_name')}
                                placeholder="owner/repo"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Source Path</label>
                            <Input
                                value={form.source_path}
                                onChange={handleChange('source_path')}
                                placeholder="api/"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Region</label>
                        <Input
                            value={form.region}
                            onChange={handleChange('region')}
                            placeholder="us-central1"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Description</label>
                        <Input
                            value={form.description}
                            onChange={handleChange('description')}
                            placeholder="Brief description"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
                        <Button type="submit" disabled={submitting || !form.name || !form.provider}>
                            {submitting ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save' : 'Create')}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
}
