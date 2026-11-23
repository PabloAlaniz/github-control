import React, { useState } from 'react';
import { Card } from '../../atoms/Card';
import { Badge } from '../../atoms/Badge';
import { Text } from '../../atoms/Text';
import { Button } from '../../atoms/Button';
import { ColorDot } from '../../atoms/ColorDot';
import { ExternalLink } from '../../atoms/ExternalLink';
import { MenuItem } from '../../atoms/MenuItem';
import { RepoMetric } from '../../molecules/RepoMetric';
import { Dropdown } from '../../molecules/Dropdown';
import { cn } from '../../../lib/utils';
import { STATUS_COLORS, STATUS_LABELS } from '../../../lib/constants';
import { formatTimeAgo, getLanguageColor } from '../../../lib/formatters';
import {
    Star,
    GitFork,
    CircleDot,
    GitPullRequest,
    FileCode,
    BookOpen,
    ExternalLink as ExternalLinkIcon,
    MoreVertical,
    Archive,
    CheckCircle,
    Clock,
    FolderPlus
} from 'lucide-react';

export function RepoCard({ repo, groups, onArchive, onSetStatus, onAddToGroup, onRemoveFromGroup, onOpenDocs }) {
    const [showActions, setShowActions] = useState(false);
    const [showGroupMenu, setShowGroupMenu] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    function handleDragStart(e) {
        e.dataTransfer.setData('text/plain', repo.fullName);
        e.dataTransfer.effectAllowed = 'copy';
        setIsDragging(true);
    }

    function handleDragEnd() {
        setIsDragging(false);
    }

    // Utils now imported

    const repoGroups = groups.filter(g => repo.groups?.includes(g.id));

    return (
        <Card
            className={cn(
                "relative transition-all duration-200 hover:shadow-lg group",
                repo.isArchived && "opacity-75 bg-gray-50",
                isDragging && "opacity-50 ring-2 ring-blue-500 cursor-grabbing",
                !isDragging && "cursor-grab"
            )}
            draggable="true"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="p-5 flex flex-col h-full">
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                    <div className="space-y-1 overflow-hidden">
                        <div className="flex items-center gap-2 flex-wrap">
                            <ExternalLink
                                href={repo.htmlUrl}
                                className="font-semibold text-lg text-gray-900 hover:text-blue-600 truncate hover:underline flex items-center gap-1"
                            >
                                {repo.name}
                                <ExternalLinkIcon size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
                            </ExternalLink>

                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                            {repo.isPrivate && <Badge variant="outline" className="text-gray-500 border-gray-300">Private</Badge>}
                            {repo.isArchived && <Badge variant="danger">Archived</Badge>}
                            {repo.isFork && <Badge variant="warning">Fork</Badge>}
                        </div>
                    </div>

                    <div
                        className={cn("w-3 h-3 rounded-full flex-shrink-0 mt-2", STATUS_COLORS[repo.activityStatus])}
                        title={STATUS_LABELS[repo.activityStatus]}
                    />
                </div>

                {/* Description */}
                <Text className="text-gray-600 line-clamp-2 mb-4 flex-1 h-[40px]">
                    {repo.description || <span className="italic text-gray-400">No description provided</span>}
                </Text>

                {/* Groups */}
                {repoGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                        {repoGroups.map(group => (
                            <span
                                key={group.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
                                style={{ backgroundColor: group.color }}
                                onClick={() => onRemoveFromGroup(group.id, repo.fullName)}
                                title="Click to remove from group"
                            >
                                {group.name}
                            </span>
                        ))}
                    </div>
                )}

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-4 text-sm">
                    {repo.language && (
                        <div className="flex items-center gap-1.5 col-span-2">
                            <ColorDot color={getLanguageColor(repo.language)} size="lg" />
                            <span className="text-gray-600 font-medium">{repo.language}</span>
                        </div>
                    )}

                    <RepoMetric icon={Star} value={repo.stargazersCount} label="Stars" />
                    <RepoMetric icon={GitFork} value={repo.forksCount} label="Forks" />
                    <RepoMetric icon={CircleDot} value={repo.openIssuesCount} label="Issues" />
                    <RepoMetric icon={GitPullRequest} value={repo.openPRsCount} label="PRs" />
                </div>

                {/* Footer actions */}
                <div className="pt-4 border-t border-gray-100 flex items-center justify-between mt-auto">
                    <div className="text-xs text-gray-500">
                        Updated {formatTimeAgo(repo.pushedAt)}
                    </div>

                    <div className="flex gap-1 relative">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onOpenDocs(repo)}
                            title="Documentation"
                            className="relative"
                        >
                            <BookOpen size={18} />
                            {repo.docsInfo?.hasSummary && (
                                <span className="absolute top-2 right-2 flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </span>
                            )}
                        </Button>

                        <div className="relative">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowActions(!showActions)}
                            >
                                <MoreVertical size={18} />
                            </Button>

                            <Dropdown open={showActions} onClose={() => setShowActions(false)}>
                                        <MenuItem
                                            icon={BookOpen}
                                            onClick={() => {
                                                onOpenDocs(repo);
                                                setShowActions(false);
                                            }}
                                        >
                                            View Docs
                                        </MenuItem>
                                        <MenuItem
                                            icon={CheckCircle}
                                            onClick={() => {
                                                onSetStatus(repo.owner, repo.name, 'reviewed')
                                                setShowActions(false);
                                            }}
                                        >
                                            Mark Reviewed
                                        </MenuItem>
                                        <MenuItem
                                            icon={Clock}
                                            onClick={() => {
                                                onSetStatus(repo.owner, repo.name, 'pending')
                                                setShowActions(false);
                                            }}
                                        >
                                            Mark Pending
                                        </MenuItem>
                                        <MenuItem
                                            icon={FolderPlus}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowGroupMenu(!showGroupMenu);
                                            }}
                                        >
                                            Add to Group
                                        </MenuItem>

                                        {!repo.isArchived && (
                                            <MenuItem
                                                icon={Archive}
                                                variant="danger"
                                                className="border-t border-gray-100"
                                                onClick={() => {
                                                    onArchive(repo.owner, repo.name);
                                                    setShowActions(false);
                                                }}
                                            >
                                                Archive Repo
                                            </MenuItem>
                                        )}
                                    </Dropdown>

                                    {/* Submenu for groups overlay */}
                                    {showGroupMenu && showActions && (
                                        <div className="absolute right-full bottom-full mb-2 mr-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 z-30 py-1 flex flex-col animate-in fade-in slide-in-from-right-2">
                                            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 border-b border-gray-100 uppercase">Select Group</div>
                                            {groups.map(group => (
                                                <MenuItem
                                                    key={group.id}
                                                    onClick={() => {
                                                        onAddToGroup(group.id, repo.fullName);
                                                        setShowGroupMenu(false);
                                                        setShowActions(false);
                                                    }}
                                                >
                                                    <ColorDot color={group.color} size="sm" />
                                                    {group.name}
                                                </MenuItem>
                                            ))}
                                        </div>
                                    )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
}
