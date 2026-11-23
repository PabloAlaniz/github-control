import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { cn } from '../../../lib/utils';

/**
 * Editable internal notes for a repo (single free-text field, overwrite semantics).
 * Reads from `repo.notes` and persists via `onSave(value)`.
 */
export function RepoNotes({ repo, onSave }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(repo.notes ?? '');
    const [saving, setSaving] = useState(false);

    const startEditing = () => {
        setValue(repo.notes ?? '');
        setEditing(true);
    };

    const cancel = () => {
        setValue(repo.notes ?? '');
        setEditing(false);
    };

    const save = async () => {
        setSaving(true);
        try {
            await onSave(value.trim());
            setEditing(false);
            toast.success('Notas guardadas');
        } catch (err) {
            toast.error('No se pudieron guardar las notas');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Notas internas
                </span>
                {!editing && (
                    <button
                        onClick={startEditing}
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                    >
                        <Pencil size={12} /> Editar
                    </button>
                )}
            </div>

            {editing ? (
                <div className="space-y-2">
                    <textarea
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        rows={4}
                        placeholder="Escribí notas internas sobre este repo…"
                        className="flex w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 resize-y"
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
                            {saving ? 'Guardando…' : 'Guardar'}
                        </Button>
                    </div>
                </div>
            ) : (
                <p
                    onClick={startEditing}
                    className={cn(
                        'text-sm whitespace-pre-wrap cursor-text rounded-md px-2 py-1.5 -mx-2 hover:bg-gray-50 transition-colors',
                        repo.notes ? 'text-gray-700' : 'text-gray-400 italic'
                    )}
                >
                    {repo.notes || 'Sin notas internas. Click para agregar.'}
                </p>
            )}
        </div>
    );
}
