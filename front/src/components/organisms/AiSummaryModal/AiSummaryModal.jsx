import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../atoms/Card';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { Badge } from '../../atoms/Badge';
import { Sparkles, X, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../lib/api';

function formatTokens(n) {
    if (n == null) return '–';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function estimateCostUsd(model, tokensIn, tokensOut, cacheRead = 0) {
    // Rough estimates for display only — keep in sync with publicly-known pricing.
    // Opus 4.7: $5/1M input, $25/1M output, ~$0.50/1M cache reads.
    const isOpus = model?.includes('opus');
    const inPerM = isOpus ? 5 : 3;
    const outPerM = isOpus ? 25 : 15;
    const cachePerM = isOpus ? 0.5 : 0.3;
    const nonCachedIn = Math.max(0, (tokensIn || 0) - (cacheRead || 0));
    const cost = (nonCachedIn * inPerM + (tokensOut || 0) * outPerM + (cacheRead || 0) * cachePerM) / 1_000_000;
    return cost;
}

export function AiSummaryModal({ repo, onClose }) {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [regenerating, setRegenerating] = useState(false);
    const [error, setError] = useState(null);

    const load = async (force = false) => {
        setError(null);
        setLoading(!force);
        setRegenerating(force);
        try {
            // First check existing summary via /docs endpoint to avoid an LLM call when we already have one.
            if (!force) {
                const docsRes = await apiFetch(`/api/repos/${repo.fullName}/docs`);
                if (docsRes.ok) {
                    const docs = await docsRes.json();
                    if (docs.summary?.source === 'ai') {
                        setSummary(docs.summary);
                        setLoading(false);
                        return;
                    }
                }
            }
            // No cached AI summary (or force) — call the generator.
            const url = `/api/repos/${repo.fullName}/generate-summary${force ? '?force=true' : ''}`;
            const res = await apiFetch(url, { method: 'POST' });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Failed to generate summary');
            setSummary(body.summary);
            if (force) toast.success('Summary regenerated');
        } catch (err) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
            setRegenerating(false);
        }
    };

    useEffect(() => {
        load(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo.fullName]);

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16 overflow-y-auto" onClick={onClose}>
            <Card className="relative w-full max-w-2xl p-6 shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-purple-500" />
                        <Text variant="h3" className="text-gray-900">{repo.fullName}</Text>
                    </div>
                    <Button onClick={onClose} variant="ghost" size="icon" className="h-7 w-7">
                        <X size={16} />
                    </Button>
                </div>

                {loading && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 size={32} className="animate-spin text-purple-500" />
                        <Text variant="muted" className="mt-3">Generating summary with Claude…</Text>
                    </div>
                )}

                {error && !loading && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {summary && !loading && (
                    <div className="space-y-4">
                        <div>
                            <Text variant="h4" className="text-gray-900">{summary.title}</Text>
                            <Text className="text-gray-700 mt-1">{summary.description}</Text>
                        </div>

                        <div>
                            <Text variant="small" className="font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Key Features</Text>
                            <ul className="space-y-1">
                                {summary.keyFeatures?.map((f, i) => (
                                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                        <span className="text-purple-400 mt-0.5">•</span>
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <Text variant="small" className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Primary Use Case</Text>
                                <Text className="text-sm text-gray-700">{summary.primaryUseCase}</Text>
                            </div>
                            <div>
                                <Text variant="small" className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Audience</Text>
                                <Text className="text-sm text-gray-700">{summary.audience}</Text>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Badge variant="outline" className="text-[10px]">{summary.model || 'claude'}</Badge>
                                <span>
                                    {formatTokens(summary.tokens_in)} in · {formatTokens(summary.tokens_out)} out
                                    {summary.cache_read_input_tokens > 0 && (
                                        <span className="text-green-600"> · {formatTokens(summary.cache_read_input_tokens)} cached</span>
                                    )}
                                </span>
                                <span className="text-gray-400">·</span>
                                <span>~${estimateCostUsd(summary.model, summary.tokens_in, summary.tokens_out, summary.cache_read_input_tokens).toFixed(4)}</span>
                            </div>
                            <Button
                                onClick={() => load(true)}
                                disabled={regenerating}
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                            >
                                <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
                                Regenerate
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
