import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../lib/utils';

const GRADE_COLORS = {
    A: 'bg-green-100 text-green-800 border-green-300',
    B: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    C: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    D: 'bg-orange-100 text-orange-800 border-orange-300',
    F: 'bg-red-100 text-red-800 border-red-300',
};

const CATEGORY_LABELS = {
    ci: 'CI/CD',
    tests: 'Tests',
    docs: 'Docs',
    quality: 'Quality',
    hygiene: 'Hygiene',
    freshness: 'Freshness',
    custom: 'Policy checks',
};

function CategoryBar({ name, score, max }) {
    const pct = max > 0 ? (score / max) * 100 : 0;
    const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
    return (
        <div className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{name}</span>
                <span className="font-mono text-gray-900">{score}/{max}</span>
            </div>
            <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

export function HealthScoreBadge({ healthScore, className }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    if (!healthScore) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    const { score, grade, breakdown, archived } = healthScore;
    const colorClass = GRADE_COLORS[grade] || GRADE_COLORS.F;

    return (
        <div className="relative inline-block" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums hover:opacity-80 transition-opacity',
                    colorClass,
                    archived && 'opacity-60',
                    className
                )}
                title={archived ? 'Archived repo (informational score)' : `Health score: ${score}/100 (${grade})`}
            >
                <span className="font-mono">{score}</span>
                <span className="text-[10px] font-bold opacity-70">{grade}</span>
            </button>

            {open && breakdown && (
                <div
                    className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                    role="dialog"
                >
                    <div className="mb-2 flex items-baseline justify-between border-b border-gray-100 pb-2">
                        <div className="text-sm font-semibold text-gray-900">Health Score Breakdown</div>
                        <div className="text-2xl font-bold tabular-nums">
                            <span className={cn('px-1.5 rounded', colorClass)}>
                                {score} <span className="text-sm">{grade}</span>
                            </span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {Object.entries(breakdown).map(([key, cat]) => (
                            <CategoryBar
                                key={key}
                                name={CATEGORY_LABELS[key] || key}
                                score={cat.score}
                                max={cat.max}
                            />
                        ))}
                    </div>
                    {archived && (
                        <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 italic">
                            This repo is archived; score is informational.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
