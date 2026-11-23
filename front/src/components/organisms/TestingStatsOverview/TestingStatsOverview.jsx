import React from 'react';
import { StatCard } from '../../molecules/StatCard';
import { FlaskConical, Globe, BarChart3, SpellCheck, ShieldCheck, AlertTriangle } from 'lucide-react';

export function TestingStatsOverview({ repos }) {
    const active = repos.filter(r => !r.isArchived && !r.isDeleted);

    const withUnit = active.filter(r => r.hasUnitTests === true).length;
    const withE2e = active.filter(r => r.hasE2eTests === true).length;
    const withLint = active.filter(r => r.hasLintConfig === true).length;
    const withTypes = active.filter(r => r.hasTypeChecking === true).length;
    const noTests = active.filter(r =>
        r.hasUnitTests !== true && r.hasIntegrationTests !== true && r.hasE2eTests !== true && r.hasTests !== true
    ).length;

    const covRepos = active.filter(r => {
        const reps = r.coverageReports;
        return (reps && reps.length > 0) || (r.testCoverage != null && r.testCoverage >= 0);
    });
    const avgCov = covRepos.length > 0
        ? Math.round(
            covRepos.reduce((sum, r) => {
                const reps = r.coverageReports;
                if (reps && reps.length > 0) {
                    return sum + reps.reduce((s, rep) => s + rep.coverage, 0) / reps.length;
                }
                return sum + (r.testCoverage || 0);
            }, 0) / covRepos.length
        )
        : 0;

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
                label="Unit Tests"
                value={`${withUnit}/${active.length}`}
                variant="primary"
                icon={FlaskConical}
            />
            <StatCard
                label="E2E Tests"
                value={`${withE2e}/${active.length}`}
                variant="primary"
                icon={Globe}
            />
            <StatCard
                label="Avg Coverage"
                value={`${avgCov}%`}
                variant={avgCov >= 60 ? 'success' : avgCov >= 30 ? 'warning' : 'danger'}
                icon={BarChart3}
            />
            <StatCard
                label="Has Lint"
                value={`${withLint}/${active.length}`}
                variant="success"
                icon={SpellCheck}
            />
            <StatCard
                label="Type Checked"
                value={`${withTypes}/${active.length}`}
                variant="success"
                icon={ShieldCheck}
            />
            <StatCard
                label="No Tests"
                value={noTests}
                variant={noTests > 0 ? 'danger' : 'success'}
                icon={AlertTriangle}
            />
        </div>
    );
}
