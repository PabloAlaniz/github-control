import React from 'react';
import { RepoCard } from '../RepoCard';
import { Text } from '../../atoms/Text';
import { Icon } from '../../atoms/Icon';
import { RepoCardSkeleton } from '../../molecules/RepoCardSkeleton';
import { SearchX } from 'lucide-react';

export function RepoList({ repos, groups, loading, onArchive, onSetStatus, onAddToGroup, onRemoveFromGroup, onOpenDocs }) {
    if (loading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Text variant="small" className="text-gray-500 font-medium">
                        Loading repositories...
                    </Text>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <RepoCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        );
    }
    if (repos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50/50">
                <Icon icon={SearchX} size={48} className="text-gray-300 mb-4" />
                <Text variant="h3" className="text-gray-900 mb-1">No repositories found</Text>
                <Text variant="muted">Try adjusting your filters or search query.</Text>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Text variant="small" className="text-gray-500 font-medium">
                    Showing {repos.length} repositories
                </Text>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {repos.map(repo => (
                    <RepoCard
                        key={repo.id}
                        repo={repo}
                        groups={groups}
                        onArchive={onArchive}
                        onSetStatus={onSetStatus}
                        onAddToGroup={onAddToGroup}
                        onRemoveFromGroup={onRemoveFromGroup}
                        onOpenDocs={onOpenDocs}
                    />
                ))}
            </div>
        </div>
    );
}
