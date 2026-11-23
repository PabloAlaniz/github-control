import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { BackupMenu } from '../BackupMenu';
import { RefreshCw, Activity, LogOut, Plus, BarChart3, Command, Package, DownloadCloud, Settings, Sun, Moon, Monitor, Bell } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';

const SUBTITLES = {
    default: 'Manage and monitor your repositories',
    testing: 'Test quality and coverage across repos',
    infrastructure: 'Deployed services and health monitoring',
};

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function ThemeToggle() {
    const { theme, cycle } = useTheme();
    const Icon = THEME_ICONS[theme];
    return (
        <Button
            onClick={cycle}
            variant="ghost"
            className="px-2.5"
            title={`${THEME_LABELS[theme]} (click to change)`}
            aria-label={`${THEME_LABELS[theme]}. Change theme`}
        >
            <Icon size={16} />
        </Button>
    );
}

/** "Sync all", or the progress of the sync in flight. */
function syncLabel({ running, progress }) {
    if (!running) return 'Sync all';
    if (!progress || progress.phase === 'refreshing' || !progress.total) return 'Syncing…';
    return `Syncing ${progress.done}/${progress.total}`;
}

function syncTitle({ running, lastRun, error }) {
    if (running) return 'Updating health, metrics, CI status and traffic of every repo';
    if (error) return `Last sync failed: ${error}`;
    if (lastRun) {
        const { synced, total, failed } = lastRun.repos;
        return `Last sync: ${synced}/${total} repos${failed ? `, ${failed} failed` : ''}`;
    }
    return 'Refresh the list and update health, metrics, CI status and traffic of every repo';
}

export function HomeHeader({
    activeTab,
    refreshing,
    onRefresh,
    onAddService,
    onActivity,
    onMetrics,
    onDependencies,
    onAlerts,
    alertCount,
    onSettings,
    onLogout,
    onImportSuccess,
    onOpenPalette,
    sync,
}) {
    const isRepoTab = activeTab === 'default' || activeTab === 'testing';
    const isServiceTab = activeTab === 'infrastructure';

    return (
        <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div>
                    <Text variant="h2" className="whitespace-nowrap">GitHub Control</Text>
                    <Text variant="muted" className="hidden xl:block">
                        {SUBTITLES[activeTab] || SUBTITLES.default}
                    </Text>
                </div>
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
                {onOpenPalette && (
                    <Button
                        onClick={onOpenPalette}
                        variant="ghost"
                        className="gap-1.5 text-gray-500"
                        title="Command palette (Cmd/Ctrl+K)"
                        aria-label="Open command palette"
                    >
                        <Command size={14} />
                        <kbd className="font-mono text-xs">K</kbd>
                    </Button>
                )}
                {isRepoTab && (
                    <Button onClick={onRefresh} disabled={refreshing} variant="outline" className="gap-2">
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                    </Button>
                )}
                {isRepoTab && sync && (
                    <Button
                        onClick={sync.start}
                        disabled={sync.running}
                        variant="outline"
                        className="gap-2"
                        title={syncTitle(sync)}
                    >
                        <DownloadCloud size={16} className={sync.running ? 'animate-pulse' : ''} />
                        <span className="hidden sm:inline">{syncLabel(sync)}</span>
                    </Button>
                )}
                {isServiceTab && (
                    <Button onClick={onAddService} variant="outline" className="gap-2">
                        <Plus size={16} />
                        <span className="hidden sm:inline">Add Service</span>
                    </Button>
                )}
                <Button onClick={onActivity} variant="ghost" className="gap-2">
                    <Activity size={16} />
                    <span className="hidden sm:inline">Activity</span>
                </Button>
                <Button onClick={onMetrics} variant="ghost" className="gap-2">
                    <BarChart3 size={16} />
                    <span className="hidden sm:inline">Metrics</span>
                </Button>
                {onDependencies && (
                    <Button onClick={onDependencies} variant="ghost" className="gap-2">
                        <Package size={16} />
                        <span className="hidden sm:inline">Deps</span>
                    </Button>
                )}
                {onAlerts && (
                    <Button
                        onClick={onAlerts}
                        variant="ghost"
                        className="relative px-2.5"
                        title={alertCount ? `${alertCount} open alert${alertCount === 1 ? '' : 's'}` : 'Alerts'}
                        aria-label={alertCount ? `Alerts: ${alertCount} open` : 'Alerts'}
                    >
                        <Bell size={16} />
                        {alertCount > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">
                                {alertCount > 99 ? '99+' : alertCount}
                            </span>
                        )}
                    </Button>
                )}
                <BackupMenu onImportSuccess={onImportSuccess} />
                {onSettings && (
                    <Button onClick={onSettings} variant="ghost" className="gap-2" aria-label="Settings" title="Settings">
                        <Settings size={16} />
                        <span className="hidden 2xl:inline">Settings</span>
                    </Button>
                )}
                <ThemeToggle />
                <Button onClick={onLogout} variant="ghost" className="gap-2" aria-label="Logout" title="Logout">
                    <LogOut size={16} />
                    <span className="hidden 2xl:inline">Logout</span>
                </Button>
            </div>
        </header>
    );
}
