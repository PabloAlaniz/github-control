import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Activity, BadgeCheck, BarChart3, Bell, FileSearch, Inbox, LayoutGrid, LogOut, Menu, Monitor, Moon, Newspaper, Package,
    ScrollText, Settings, Sun, X,
} from 'lucide-react';
import { useAlertCount } from '../../../hooks/useAlertCount';
import { useTheme } from '../../../hooks/useTheme';
import { logout } from '../../../lib/auth';
import { cn } from '../../../lib/utils';

/** Where the app can take you. `match` says which paths light the item up. */
export const NAV_ITEMS = [
    { path: '/', label: 'Repos', icon: LayoutGrid, match: (pathname) => pathname === '/' },
    { path: '/inbox', label: 'Inbox', icon: Inbox },
    { path: '/alerts', label: 'Alerts', icon: Bell },
    { path: '/report', label: 'Report', icon: Newspaper },
    { path: '/search', label: 'Search', icon: FileSearch },
    { path: '/metrics', label: 'Metrics', icon: BarChart3 },
    { path: '/dependencies', label: 'Deps', icon: Package },
    { path: '/activity', label: 'Activity', icon: Activity },
    { path: '/policy', label: 'Policy', icon: ScrollText },
    { path: '/embeds', label: 'Badges', icon: BadgeCheck },
    { path: '/settings', label: 'Settings', icon: Settings },
];

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

const isActive = (item, pathname) => (item.match ? item.match(pathname) : pathname === item.path || pathname.startsWith(`${item.path}/`));

function Count({ value, className }) {
    if (!(value > 0)) return null;
    return (
        <span className={cn('min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white', className)}>
            {value > 99 ? '99+' : value}
        </span>
    );
}

/**
 * The app's navigation: a rail on the left on wide screens, a top bar with a
 * menu on narrow ones. One list of destinations for every page.
 */
export function AppNav() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { count: alertCount, refresh } = useAlertCount();
    const { theme, cycle } = useTheme();
    const [open, setOpen] = useState(false);

    // A new page may have changed what is open (a sync, a resolved alert): ask again, and close the menu.
    useEffect(() => {
        setOpen(false);
        refresh();
    }, [pathname, refresh]);

    const go = (path) => { setOpen(false); navigate(path); };
    const signOut = () => { logout(); go('/login'); };
    const ThemeIcon = THEME_ICONS[theme];
    const badge = (item) => (item.path === '/alerts' ? alertCount : 0);
    const label = (item) => (badge(item) > 0 ? `${item.label}: ${badge(item)} open` : item.label);

    return (
        <>
            {/* Wide screens: a rail */}
            <nav aria-label="Main" className="hidden w-16 flex-shrink-0 flex-col items-center gap-1 border-r border-gray-200 bg-white py-3 md:flex">
                {NAV_ITEMS.map((item) => {
                    const active = isActive(item, pathname);
                    return (
                        <button
                            key={item.path} type="button" onClick={() => go(item.path)}
                            aria-current={active ? 'page' : undefined} aria-label={label(item)} title={label(item)}
                            className={cn(
                                'relative flex w-14 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors',
                                active ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                            )}
                        >
                            <item.icon size={18} />
                            {item.label}
                            <Count value={badge(item)} className="absolute right-1.5 top-0.5" />
                        </button>
                    );
                })}
                <div className="mt-auto flex flex-col items-center gap-1">
                    <button type="button" onClick={cycle} title={`${THEME_LABELS[theme]} (click to change)`} aria-label={`${THEME_LABELS[theme]}. Change theme`}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
                        <ThemeIcon size={18} />
                    </button>
                    <button type="button" onClick={signOut} title="Logout" aria-label="Logout"
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
                        <LogOut size={18} />
                    </button>
                </div>
            </nav>

            {/* Narrow screens: a bar with a menu */}
            <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 md:hidden">
                <span className="text-sm font-semibold text-gray-900">GitHub Control</span>
                <div className="flex items-center gap-2">
                    <Count value={alertCount} />
                    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="app-menu"
                        aria-label={open ? 'Close menu' : 'Open menu'} className="rounded-lg p-2 text-gray-700 hover:bg-gray-100">
                        {open ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
            </div>
            {open && (
                <nav id="app-menu" aria-label="Main menu" className="absolute inset-x-0 top-12 z-40 max-h-[calc(100vh-3rem)] overflow-y-auto border-b border-gray-200 bg-white p-2 shadow-lg md:hidden">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item, pathname);
                        return (
                            <button
                                key={item.path} type="button" onClick={() => go(item.path)} aria-current={active ? 'page' : undefined}
                                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm', active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100')}
                            >
                                <item.icon size={18} />
                                <span className="flex-1">{item.label}</span>
                                <Count value={badge(item)} />
                            </button>
                        );
                    })}
                    <div className="mt-2 flex gap-2 border-t border-gray-100 pt-2">
                        <button type="button" onClick={cycle} className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">
                            <ThemeIcon size={18} />{THEME_LABELS[theme]}
                        </button>
                        <button type="button" onClick={signOut} className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">
                            <LogOut size={18} />Logout
                        </button>
                    </div>
                </nav>
            )}
        </>
    );
}
