import React from 'react';
import { Badge } from '../../atoms/Badge';
import { cn } from '../../../lib/utils';
import { ArrowUp, ArrowDown, CheckCircle, XCircle, HelpCircle } from 'lucide-react';

export function renderBool(value) {
    if (value === true) return <CheckCircle size={16} className="text-green-500 mx-auto" />;
    if (value === false) return <XCircle size={16} className="text-red-500 mx-auto" />;
    return <HelpCircle size={16} className="text-gray-300 mx-auto" />;
}

export function renderBoolWithLabel(value, label) {
    if (value === true) {
        return (
            <div className="flex flex-col items-center gap-0.5">
                <CheckCircle size={16} className="text-green-500" />
                {label && <span className="text-[10px] text-gray-400">{label}</span>}
            </div>
        );
    }
    if (value === false) return <XCircle size={16} className="text-red-500 mx-auto" />;
    return <HelpCircle size={16} className="text-gray-300 mx-auto" />;
}

export const stackColors = {
    python: 'bg-blue-100 text-blue-800',
    node: 'bg-green-100 text-green-800',
    php: 'bg-purple-100 text-purple-800',
    go: 'bg-cyan-100 text-cyan-800',
    java: 'bg-orange-100 text-orange-800',
    ruby: 'bg-red-100 text-red-800',
};

export function renderStack(stack) {
    if (!stack) return <span className="text-gray-400">-</span>;
    return (
        <Badge className={cn("uppercase text-[10px]", stackColors[stack] || "bg-gray-100 text-gray-800")}>
            {stack === 'python' ? 'py' : stack === 'node' ? 'js' : stack}
        </Badge>
    );
}

export function coverageColor(value) {
    return value >= 80 ? 'text-green-600' : value >= 50 ? 'text-yellow-600' : 'text-red-600';
}

export function renderCoverage(repo) {
    // Monorepo with apps: show average of app coverages (never fall through to legacy)
    if (repo.apps?.length > 0) {
        const appsWithCov = repo.apps.filter(a => a.coverageValue != null);
        if (appsWithCov.length > 0) {
            const avg = Math.round(appsWithCov.reduce((s, a) => s + a.coverageValue, 0) / appsWithCov.length);
            return <span className={cn("font-semibold font-mono", coverageColor(avg))}>{avg}%</span>;
        }
        return <span className="text-gray-400">-</span>;
    }
    // Simple repo: single coverage value
    const reports = repo.coverageReports;
    if (reports?.length === 1 && reports[0].label === 'default') {
        return <span className={cn("font-semibold font-mono", coverageColor(reports[0].coverage))}>{reports[0].coverage}%</span>;
    }
    if (reports?.length > 0) {
        const avg = Math.round(reports.reduce((s, r) => s + r.coverage, 0) / reports.length);
        return <span className={cn("font-semibold font-mono", coverageColor(avg))}>{avg}%</span>;
    }
    const coverage = repo.testCoverage;
    if (coverage == null) return <span className="text-gray-400">-</span>;
    return <span className={cn("font-semibold font-mono", coverageColor(coverage))}>{coverage}%</span>;
}

export function formatSize(kb) {
    if (kb == null) return null;
    if (kb < 1024) return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
}

export function formatLoc(loc) {
    if (loc == null) return null;
    return loc.toLocaleString();
}

export function SortHeader({ field, sortField, sortDir, onSort, children, className }) {
    return (
        <th
            onClick={() => onSort(field)}
            className={cn(
                "px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors select-none",
                className
            )}
        >
            <div className="flex items-center gap-1">
                {children}
                {sortField === field && (
                    sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                )}
            </div>
        </th>
    );
}

export function avgCoverage(repo) {
    if (repo.apps?.length > 0) {
        const appsWithCov = repo.apps.filter(a => a.coverageValue != null);
        if (appsWithCov.length > 0) {
            return appsWithCov.reduce((s, a) => s + a.coverageValue, 0) / appsWithCov.length;
        }
        return -1;
    }
    const reps = repo.coverageReports;
    if (reps && reps.length > 0) {
        return reps.reduce((sum, r) => sum + r.coverage, 0) / reps.length;
    }
    return repo.testCoverage ?? -1;
}
