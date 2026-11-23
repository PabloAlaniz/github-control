import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * Renders a small ↑/↓/− arrow with an optional delta number.
 * Positive deltas are green (growth), negative red (decline), zero gray.
 * For metrics where "down is good" (e.g. open_issues), pass `inverted={true}`.
 */
export function TrendIndicator({ delta, inverted = false, suffix = '', size = 12, className }) {
    if (delta == null) {
        return <span className={cn('text-gray-300 text-xs', className)} title="No history">–</span>;
    }
    const n = Number(delta);
    if (n === 0) {
        return (
            <span className={cn('inline-flex items-center gap-0.5 text-gray-400 text-xs', className)} title="No change">
                <Minus size={size} />
            </span>
        );
    }
    const goingUp = n > 0;
    const isGood = inverted ? !goingUp : goingUp;
    const colorClass = isGood ? 'text-green-600' : 'text-red-600';
    const Icon = goingUp ? ArrowUp : ArrowDown;
    const formatted = Math.abs(n).toLocaleString();
    return (
        <span
            className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', colorClass, className)}
            title={`${goingUp ? '+' : '-'}${formatted}${suffix} vs ~30d ago`}
        >
            <Icon size={size} />
            {formatted}{suffix}
        </span>
    );
}
