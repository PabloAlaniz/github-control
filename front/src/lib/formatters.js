import { LANGUAGE_COLORS } from './constants';

export function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays}d ago`;

    const months = Math.floor(diffDays / 30);
    if (months < 12) return `${months}mo ago`;

    const years = Math.floor(months / 12);
    return `${years}y ago`;
}

export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function getLanguageColor(language) {
    // Use constants map or default
    return LANGUAGE_COLORS[language] || LANGUAGE_COLORS.Unknown || '#6b7280';
}

// Activity Status Logic
export function getActivityStatus(repo) {
    if (!repo.pushedAt && !repo.lastCommitDate) return 'abandoned';
    const lastPush = new Date(repo.pushedAt || repo.lastCommitDate);
    const daysSince = (Date.now() - lastPush) / (1000 * 60 * 60 * 24);
    if (daysSince < 30) return 'active';
    if (daysSince < 180) return 'inactive';
    return 'abandoned';
}

/**
 * Days since the last commit on a repo. Tries lastCommitAt then pushedAt then lastCommitDate.
 * Returns null if no usable date is available.
 */
export function daysSinceLastCommit(repo) {
    const raw = repo?.lastCommitAt || repo?.pushedAt || repo?.lastCommitDate;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

/**
 * Repo is "stale" when its last commit is older than `thresholdDays` (default 30).
 * Repos without commit data are not considered stale (returns false).
 */
export function isStale(repo, thresholdDays = 30) {
    const days = daysSinceLastCommit(repo);
    return days !== null && days > thresholdDays;
}
