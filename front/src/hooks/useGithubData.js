import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';

/** Map snake_case app response to camelCase */
function mapApp(a) {
    return {
        id: a.id,
        repoFullName: a.repo_full_name ?? a.repoFullName,
        appPath: a.app_path ?? a.appPath,
        appName: a.app_name ?? a.appName,
        slug: a.slug,
        stack: a.stack,
        hasCi: a.has_ci ?? a.hasCi,
        hasTests: a.has_tests ?? a.hasTests,
        hasReadme: a.has_readme ?? a.hasReadme,
        readmeLines: a.readme_lines ?? a.readmeLines,
        loc: a.loc,
        fileCount: a.file_count ?? a.fileCount,
        docsQuality: a.docs_quality ?? a.docsQuality,
        detectionSource: a.detection_source ?? a.detectionSource,
        lastHealthCheck: a.last_health_check ?? a.lastHealthCheck,
        coverageValue: a.coverage_value ?? a.coverageValue ?? null,
        // Testing metadata
        hasUnitTests: a.has_unit_tests ?? a.hasUnitTests,
        hasIntegrationTests: a.has_integration_tests ?? a.hasIntegrationTests,
        hasE2eTests: a.has_e2e_tests ?? a.hasE2eTests,
        hasLintConfig: a.has_lint_config ?? a.hasLintConfig,
        hasTypeChecking: a.has_type_checking ?? a.hasTypeChecking,
        hasSecurityScan: a.has_security_scan ?? a.hasSecurityScan,
        hasPerfTests: a.has_perf_tests ?? a.hasPerfTests,
        testFramework: a.test_framework ?? a.testFramework ?? null,
        e2eFramework: a.e2e_framework ?? a.e2eFramework ?? null,
        lintTool: a.lint_tool ?? a.lintTool ?? null,
    };
}

/** Map snake_case API response to camelCase frontend fields */
export function mapRepo(r) {
    return {
        ...r,
        fullName: r.full_name ?? r.fullName,
        isPrivate: r.is_private ?? r.isPrivate,
        isArchived: r.is_archived ?? r.isArchived,
        defaultBranch: r.default_branch ?? r.defaultBranch,
        openIssues: r.open_issues ?? r.openIssues,
        lastCommitAt: r.last_commit_at ?? r.lastCommitAt,
        hasCi: r.has_ci ?? r.hasCi,
        hasTests: r.has_tests ?? r.hasTests,
        hasReadme: r.has_readme ?? r.hasReadme,
        hasGitignore: r.has_gitignore ?? r.hasGitignore,
        hasRoadmap: r.has_roadmap ?? r.hasRoadmap,
        testCoverage: r.test_coverage ?? r.testCoverage,
        coverageReports: r.coverage_reports ?? r.coverageReports ?? [],
        healthScore: r.health_score ?? r.healthScore ?? null,
        ciStatus: r.ci_status ?? r.ciStatus ?? null,
        ciStatusUrl: r.ci_status_url ?? r.ciStatusUrl ?? null,
        ciStatusRunAt: r.ci_status_run_at ?? r.ciStatusRunAt ?? null,
        ciStatusCheckedAt: r.ci_status_checked_at ?? r.ciStatusCheckedAt ?? null,
        trend: r.trend ?? null,
        readmeLines: r.readme_lines ?? r.readmeLines,
        docsQuality: r.docs_quality ?? r.docsQuality,
        docsFileCount: r.docs_file_count ?? r.docsFileCount,
        lastHealthCheck: r.last_health_check ?? r.lastHealthCheck,
        isDeleted: r.is_deleted ?? r.isDeleted,
        repoCreatedAt: r.repo_created_at ?? r.repoCreatedAt,
        repoUpdatedAt: r.repo_updated_at ?? r.repoUpdatedAt,
        repoSizeKb: r.repo_size_kb ?? r.repoSizeKb,
        fileCount: r.file_count ?? r.fileCount,
        loc: r.loc,
        githubCachedAt: r.github_cached_at ?? r.githubCachedAt,
        apps: (r.apps || []).map(mapApp),
        isMonorepo: r.is_monorepo ?? r.isMonorepo ?? false,
        // Testing metadata
        hasUnitTests: r.has_unit_tests ?? r.hasUnitTests,
        hasIntegrationTests: r.has_integration_tests ?? r.hasIntegrationTests,
        hasE2eTests: r.has_e2e_tests ?? r.hasE2eTests,
        hasLintConfig: r.has_lint_config ?? r.hasLintConfig,
        hasTypeChecking: r.has_type_checking ?? r.hasTypeChecking,
        hasSecurityScan: r.has_security_scan ?? r.hasSecurityScan,
        hasPerfTests: r.has_perf_tests ?? r.hasPerfTests,
        testFramework: r.test_framework ?? r.testFramework ?? null,
        e2eFramework: r.e2e_framework ?? r.e2eFramework ?? null,
        lintTool: r.lint_tool ?? r.lintTool ?? null,
    };
}

export function useGithubData() {
    const [data, setData] = useState({
        repos: [],
        groups: [],
        cacheInfo: null
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);

    const fetchAll = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [reposRes, groupsRes, cacheRes] = await Promise.all([
                apiFetch('/api/repos?include_deleted=true&include_paused=true'),
                apiFetch('/api/groups'),
                apiFetch('/api/cache/status')
            ]);

            if (!reposRes.ok) throw new Error('Failed to fetch repositories');

            const repos = (await reposRes.json()).map(mapRepo);
            const groups = await groupsRes.json();
            const cacheInfo = await cacheRes.json();

            setData({ repos, groups, cacheInfo });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshData = useCallback(async () => {
        try {
            setRefreshing(true);
            setError(null);
            const res = await apiFetch('/api/repos/refresh', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to refresh repositories');

            // Refresh returns a summary, not the repos array.
            // Re-fetch the updated repos list + cache status.
            const [reposRes, cacheRes] = await Promise.all([
                apiFetch('/api/repos?include_deleted=true&include_paused=true'),
                apiFetch('/api/cache/status')
            ]);
            const repos = (await reposRes.json()).map(mapRepo);
            const cacheInfo = await cacheRes.json();

            setData(prev => ({ ...prev, repos, cacheInfo }));
        } catch (err) {
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    }, []);

    const archiveRepo = useCallback(async (owner, repoName) => {
        try {
            const res = await apiFetch(`/api/repos/${owner}/${repoName}/archive`, { method: 'POST' });
            if (res.ok) {
                // Optimistic update or refetch
                // For simplicity, let's just refetch to ensure sync
                fetchAll();
            }
        } catch (err) {
            console.error('Failed to archive repo:', err);
        }
    }, [fetchAll]);

    const updateRepoStatus = useCallback(async (owner, repoName, status) => {
        try {
            await apiFetch(`/api/repos/${owner}/${repoName}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            // We could update local state optimistically, but let's refetch for consistency
            fetchAll();
        } catch (err) {
            console.error('Failed to set status:', err);
        }
    }, [fetchAll]);

    // Group operations
    const createGroup = useCallback(async (name, description, color) => {
        try {
            const res = await apiFetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, color })
            });
            if (res.ok) {
                const groupsRes = await apiFetch('/api/groups');
                const groups = await groupsRes.json();
                setData(prev => ({ ...prev, groups }));
            }
        } catch (err) {
            console.error('Failed to create group:', err);
        }
    }, []);

    const deleteGroup = useCallback(async (groupId) => {
        try {
            await apiFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
            const groupsRes = await apiFetch('/api/groups');
            const groups = await groupsRes.json();
            setData(prev => ({ ...prev, groups }));
            fetchAll(); // Fetch all because repos might be affected (removed from group)
        } catch (err) {
            console.error('Failed to delete group:', err);
        }
    }, [fetchAll]);

    const addRepoToGroup = useCallback(async (groupId, repoFullName) => {
        try {
            await apiFetch(`/api/groups/${groupId}/repos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name: repoFullName })
            });
            fetchAll();
        } catch (err) {
            console.error('Failed to add repo to group:', err);
        }
    }, [fetchAll]);

    const removeRepoFromGroup = useCallback(async (groupId, repoFullName) => {
        try {
            await apiFetch(`/api/groups/${groupId}/repos`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name: repoFullName })
            });
            fetchAll();
        } catch (err) {
            console.error('Failed to remove repo from group:', err);
        }
    }, [fetchAll]);

    const updateRepoNotes = useCallback(async (fullName, notes) => {
        // Optimistic local update
        setData(prev => ({
            ...prev,
            repos: prev.repos.map(r =>
                r.fullName === fullName ? { ...r, notes } : r
            ),
        }));
        try {
            const [owner, repoName] = fullName.split('/');
            const res = await apiFetch(`/api/meta/${owner}/${repoName}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Actor-Name': 'user', // Should be dynamic
                    'X-Actor-Type': 'human',
                },
                body: JSON.stringify({ notes }),
            });
            if (!res.ok) throw new Error('Failed to save notes');
            return true;
        } catch (err) {
            console.error('Failed to update notes:', err);
            fetchAll(); // Revert to server truth on failure
            throw err;
        }
    }, [fetchAll]);

    const deleteRepo = useCallback(async (fullName) => {
        try {
            const res = await apiFetch(`/api/repos/${fullName}`, {
                method: 'DELETE',
                headers: {
                    'X-Actor-Name': 'user', // Should be dynamic
                    'X-Actor-Type': 'human'
                }
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to delete repo');
            }

            // Refetch all data after deletion
            fetchAll();
            return await res.json();
        } catch (err) {
            console.error('Failed to delete repo:', err);
            throw err;
        }
    }, [fetchAll]);

    return {
        ...data,
        loading,
        refreshing,
        error,
        fetchAll,
        refreshData,
        archiveRepo,
        updateRepoStatus,
        createGroup,
        deleteGroup,
        addRepoToGroup,
        removeRepoFromGroup,
        deleteRepo,
        updateRepoNotes
    };
}
