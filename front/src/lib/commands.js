import {
    GitBranch, Folder, Bookmark, RefreshCw, Activity, BarChart3, LogOut,
    LayoutGrid, FlaskConical, Server, RotateCcw, Package, DownloadCloud, Settings, SunMoon, Bell, Inbox, BadgeCheck, ScrollText, FileSearch,
} from 'lucide-react';
import { isInboxView } from './inbox';
import { nextTheme, setTheme } from './theme';

/**
 * Builds the palette's command list from the dashboard state.
 * Actions go first so the empty palette shows the most used ones.
 */
export function buildCommands({ repos = [], groups = [], views = [], actions }) {
    const a = actions;
    const commands = [
        { id: 'act:refresh', section: 'Actions', icon: RefreshCw, label: 'Refresh data from GitHub', keywords: ['sync', 'reload'], run: a.refresh },
        ...(a.syncAll ? [{ id: 'act:sync', section: 'Actions', icon: DownloadCloud, label: 'Sync all repos', keywords: ['full sync', 'health', 'signals'], run: a.syncAll }] : []),
        { id: 'act:reset', section: 'Actions', icon: RotateCcw, label: 'Reset filters', keywords: ['clear'], run: a.resetFilters },
        { id: 'act:theme', section: 'Actions', icon: SunMoon, label: 'Change theme', keywords: ['dark', 'light', 'system', 'appearance'], run: () => setTheme(nextTheme()) },
        { id: 'tab:default', section: 'Go to', icon: LayoutGrid, label: 'Default tab', keywords: ['repos', 'health'], run: () => a.setTab('default') },
        { id: 'tab:testing', section: 'Go to', icon: FlaskConical, label: 'Testing tab', keywords: ['coverage'], run: () => a.setTab('testing') },
        { id: 'tab:infrastructure', section: 'Go to', icon: Server, label: 'Infra tab', keywords: ['services', 'infrastructure'], run: () => a.setTab('infrastructure') },
        { id: 'nav:activity', section: 'Go to', icon: Activity, label: 'Activity', keywords: ['log'], run: () => a.navigate('/activity') },
        { id: 'nav:dependencies', section: 'Go to', icon: Package, label: 'Dependencies', keywords: ['packages', 'runtimes', 'versions'], run: () => a.navigate('/dependencies') },
        { id: 'nav:inbox', section: 'Go to', icon: Inbox, label: 'Inbox', keywords: ['pull requests', 'prs', 'issues', 'reviews', 'dependabot', 'merge'], run: () => a.navigate('/inbox') },
        { id: 'nav:search', section: 'Go to', icon: FileSearch, label: 'Search code', keywords: ['grep', 'find', 'files', 'text', 'source'], run: () => a.navigate('/search') },
        { id: 'nav:alerts', section: 'Go to', icon: Bell, label: 'Alerts', keywords: ['notifications', 'channels', 'slack', 'webhook', 'digest'], run: () => a.navigate('/alerts') },
        { id: 'nav:embeds', section: 'Go to', icon: BadgeCheck, label: 'Badges and embeds', keywords: ['badge', 'card', 'svg', 'readme', 'status page', 'snippet', 'markdown'], run: () => a.navigate('/embeds') },
        { id: 'nav:policy', section: 'Go to', icon: ScrollText, label: 'Policy', keywords: ['baseline', 'weights', 'checks', 'yaml', 'standards', 'rules', 'dry run'], run: () => a.navigate('/policy') },
        { id: 'nav:settings', section: 'Go to', icon: Settings, label: 'Settings', keywords: ['config', 'token', 'baseline'], run: () => a.navigate('/settings') },
        { id: 'nav:metrics', section: 'Go to', icon: BarChart3, label: 'Metrics', keywords: ['charts'], run: () => a.navigate('/metrics') },
    ];

    for (const view of views) {
        commands.push({
            id: `view:${view.id}`, section: 'Views', icon: Bookmark,
            label: view.name, hint: isInboxView(view) ? 'Inbox view' : 'View',
            run: () => (isInboxView(view) ? a.navigate(`/inbox?${view.query}`) : a.applyView(view)),
        });
    }

    for (const group of groups) {
        commands.push({
            id: `group:${group.slug}`, section: 'Groups', icon: Folder,
            label: group.name, hint: 'Filter by group', keywords: [group.slug],
            run: () => a.filterByGroup(group.slug),
        });
    }

    for (const repo of repos) {
        if (repo.isDeleted) continue;
        commands.push({
            id: `repo:${repo.fullName}`, section: 'Repos', icon: GitBranch,
            label: repo.fullName || repo.name, hint: 'Evolution',
            keywords: [repo.name, repo.description].filter(Boolean),
            run: () => a.navigate(`/metrics/${repo.fullName}`),
            runAlt: () => a.openExternal(`https://github.com/${repo.fullName}`),
        });
    }

    commands.push({ id: 'act:logout', section: 'Session', icon: LogOut, label: 'Log out', run: a.logout });
    return commands;
}
