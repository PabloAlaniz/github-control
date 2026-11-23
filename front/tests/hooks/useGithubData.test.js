import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGithubData, mapRepo } from '@/hooks/useGithubData';

describe('mapRepo', () => {
    it('converts snake_case API fields to camelCase', () => {
        const apiRepo = {
            id: 1, name: 'my-repo', full_name: 'owner/my-repo',
            is_private: false, is_archived: true, has_ci: true,
            has_tests: false, has_readme: true, test_coverage: 85,
            last_health_check: '2026-01-01',
            is_deleted: false, default_branch: 'main',
        };
        const mapped = mapRepo(apiRepo);

        expect(mapped.fullName).toBe('owner/my-repo');
        expect(mapped.isPrivate).toBe(false);
        expect(mapped.isArchived).toBe(true);
        expect(mapped.hasCi).toBe(true);
        expect(mapped.hasTests).toBe(false);
        expect(mapped.hasReadme).toBe(true);
        expect(mapped.testCoverage).toBe(85);
        expect(mapped.lastHealthCheck).toBe('2026-01-01');
        expect(mapped.isDeleted).toBe(false);
        expect(mapped.defaultBranch).toBe('main');
    });

    it('preserves already camelCase fields', () => {
        const alreadyCamel = { id: 1, fullName: 'owner/repo', hasCi: true };
        const mapped = mapRepo(alreadyCamel);
        expect(mapped.fullName).toBe('owner/repo');
        expect(mapped.hasCi).toBe(true);
    });
});

describe('useGithubData', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with loading state', () => {
        const { result } = renderHook(() => useGithubData());
        expect(result.current.loading).toBe(true);
        expect(result.current.repos).toEqual([]);
    });

    it('fetches data and maps snake_case to camelCase', async () => {
        const mockApiRepos = [{ id: 1, name: 'repo1', full_name: 'user/repo1', has_ci: true, is_archived: false }];
        const mockGroups = [{ id: 1, name: 'group1' }];
        const mockCache = { exists: true };

        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => mockApiRepos }) // repos
            .mockResolvedValueOnce({ ok: true, json: async () => mockGroups }) // groups
            .mockResolvedValueOnce({ ok: true, json: async () => mockCache }); // cache

        const { result } = renderHook(() => useGithubData());

        act(() => {
            result.current.fetchAll();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.repos[0].fullName).toBe('user/repo1');
        expect(result.current.repos[0].hasCi).toBe(true);
        expect(result.current.repos[0].isArchived).toBe(false);
        expect(result.current.groups).toEqual(mockGroups);
        expect(result.current.cacheInfo).toEqual(mockCache);
        expect(result.current.error).toBeNull();
    });

    it('handles fetch error', async () => {
        global.fetch.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useGithubData());

        act(() => {
            result.current.fetchAll();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Network error');
    });

    it('archives repo and refetches', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true }) // archive POST
            .mockResolvedValue({ ok: true, json: async () => [] }); // subseq fetch calls

        const { result } = renderHook(() => useGithubData());

        await act(async () => {
            await result.current.archiveRepo('user', 'repo1');
        });

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/repos/user/repo1/archive'),
            expect.objectContaining({ method: 'POST' })
        );
        // Should trigger fetchAll, checks if called
        expect(global.fetch).toHaveBeenCalledTimes(4); // 1 archive + 3 fetchAll calls (repos, groups, cache)
    });

    describe('removeRepoFromGroup', () => {
        it('calls DELETE on the group repos endpoint and refetches', async () => {
            global.fetch
                .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // DELETE /api/groups/:id/repos
                .mockResolvedValue({ ok: true, json: async () => [] }); // subsequent fetchAll calls

            const { result } = renderHook(() => useGithubData());

            await act(async () => {
                await result.current.removeRepoFromGroup(42, 'owner/my-repo');
            });

            // Verify the DELETE call was made with correct URL, method, headers, and body
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/groups/42/repos'),
                expect.objectContaining({
                    method: 'DELETE',
                    body: JSON.stringify({ full_name: 'owner/my-repo' })
                })
            );

            // Should trigger fetchAll after removing: 1 DELETE + 3 fetchAll calls
            expect(global.fetch).toHaveBeenCalledTimes(4);
        });

        it('handles error when removing repo from group fails', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            global.fetch.mockRejectedValueOnce(new Error('Network failure'));

            const { result } = renderHook(() => useGithubData());

            await act(async () => {
                await result.current.removeRepoFromGroup(42, 'owner/my-repo');
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to remove repo from group:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('deleteRepo', () => {
        it('calls DELETE with actor headers and refetches on success', async () => {
            const mockDeleteResponse = { message: 'Deleted' };
            global.fetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockDeleteResponse }) // DELETE /api/repos/:fullName
                .mockResolvedValue({ ok: true, json: async () => [] }); // subsequent fetchAll calls

            const { result } = renderHook(() => useGithubData());

            let returnValue;
            await act(async () => {
                returnValue = await result.current.deleteRepo('owner/my-repo');
            });

            // Verify the DELETE call with correct URL and actor headers
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/repos/owner/my-repo'),
                expect.objectContaining({
                    method: 'DELETE',
                })
            );

            // Verify return value from successful deletion
            expect(returnValue).toEqual(mockDeleteResponse);

            // Should trigger fetchAll: 1 DELETE + 3 fetchAll calls
            expect(global.fetch).toHaveBeenCalledTimes(4);
        });

        it('throws when the API returns a non-ok response', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            global.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Repo not found' })
            });

            const { result } = renderHook(() => useGithubData());

            await act(async () => {
                await expect(result.current.deleteRepo('owner/missing-repo')).rejects.toThrow('Repo not found');
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to delete repo:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it('throws with default message when API error has no error field', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            global.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({})
            });

            const { result } = renderHook(() => useGithubData());

            await act(async () => {
                await expect(result.current.deleteRepo('owner/repo')).rejects.toThrow('Failed to delete repo');
            });

            consoleSpy.mockRestore();
        });

        it('handles network error and re-throws', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            global.fetch.mockRejectedValueOnce(new Error('Network error'));

            const { result } = renderHook(() => useGithubData());

            await act(async () => {
                await expect(result.current.deleteRepo('owner/repo')).rejects.toThrow('Network error');
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                'Failed to delete repo:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });
});
