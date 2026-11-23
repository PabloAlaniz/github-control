import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../atoms/Button';
import { Database, Download, Upload, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { cn } from '../../../lib/utils';

export function BackupMenu({ onImportSuccess }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef(null);

    const close = () => setOpen(false);

    async function handleExport() {
        setBusy(true);
        try {
            const res = await apiFetch('/api/export');
            if (!res.ok) throw new Error('Export failed');
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `github-control-backup-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`Exported ${data.groups.length} groups, ${data.repo_groups.length} edges, ${data.meta_overrides.length} meta overrides`);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
            close();
        }
    }

    async function handleImport(file) {
        setBusy(true);
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const res = await apiFetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed),
            });
            const body = await res.json();
            if (!res.ok) {
                throw new Error(body.error || 'Import failed');
            }
            const s = body.summary;
            toast.success(`Imported: ${s.groups_upserted} groups, ${s.repo_groups_added} edges, ${s.meta_applied} meta overrides`);
            onImportSuccess?.();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(false);
            close();
            if (fileRef.current) fileRef.current.value = '';
        }
    }

    return (
        <div className="relative">
            <Button onClick={() => setOpen(o => !o)} variant="ghost" className="gap-2" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                <span className="hidden 2xl:inline">Backup</span>
            </Button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={close} />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                        <button
                            className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', busy && 'opacity-50')}
                            onClick={handleExport}
                            disabled={busy}
                        >
                            <Download size={14} />
                            Export to JSON
                        </button>
                        <button
                            className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50', busy && 'opacity-50')}
                            onClick={() => fileRef.current?.click()}
                            disabled={busy}
                        >
                            <Upload size={14} />
                            Import from JSON
                        </button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleImport(f);
                            }}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
