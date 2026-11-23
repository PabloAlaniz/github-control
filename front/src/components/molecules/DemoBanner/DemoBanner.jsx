import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlaskConical } from 'lucide-react';
import { getDemo, getDemoBlocked, subscribeDemo } from '../../../lib/demo';

const REPO_URL = 'https://github.com/PabloAlaniz/github-control';
const NOTICE_MS = 4000;

function resetText({ readOnly, resetMinutes }) {
    if (readOnly) return 'Read-only.';
    if (!resetMinutes) return 'Changes are not kept.';
    const every = resetMinutes % 60 === 0
        ? (resetMinutes === 60 ? 'hour' : `${resetMinutes / 60} hours`)
        : `${resetMinutes} minutes`;
    return `Changes reset every ${every}.`;
}

/** A small bar at the bottom of a demo instance. Renders nothing anywhere else. */
export function DemoBanner() {
    const demo = useSyncExternalStore(subscribeDemo, getDemo);
    const blocked = useSyncExternalStore(subscribeDemo, getDemoBlocked);
    const [notice, setNotice] = useState(false);

    useEffect(() => {
        if (blocked === 0) return undefined;
        setNotice(true);
        const timer = setTimeout(() => setNotice(false), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [blocked]);

    if (!demo) return null;

    return (
        <div
            role="status"
            className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-lg"
        >
            <FlaskConical size={14} className="flex-shrink-0" />
            {notice ? (
                <span className="font-medium">That needs a real GitHub account: not available in the demo.</span>
            ) : (
                <span>
                    <span className="font-medium">Demo</span> with fictional data. {resetText(demo)}
                </span>
            )}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex-shrink-0 font-medium underline underline-offset-2">
                Run your own
            </a>
        </div>
    );
}
