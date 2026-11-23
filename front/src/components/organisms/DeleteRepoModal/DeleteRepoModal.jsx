import React from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { X, AlertTriangle } from 'lucide-react';

export function DeleteRepoModal({ repo, onClose, onConfirm }) {
    const [deleting, setDeleting] = React.useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await onConfirm(repo);
            onClose();
        } catch (error) {
            console.error('Failed to delete repo:', error);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <AlertTriangle size={24} className="text-red-600" />
                        <Text variant="h3">Delete Repository</Text>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 h-8 w-8"
                    >
                        <X size={20} />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <Text className="text-gray-700">
                        This repository has been deleted from GitHub and can be removed from your local database.
                    </Text>

                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <Text variant="small" className="font-semibold text-red-900 mb-1">
                            {repo.fullName}
                        </Text>
                        {repo.deletionDetectedAt && (
                            <Text variant="small" className="text-red-700">
                                Detected: {new Date(repo.deletionDetectedAt).toLocaleDateString()}
                            </Text>
                        )}
                    </div>

                    <Text variant="small" className="text-gray-600">
                        This action will remove all associated data including:
                    </Text>
                    <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                        <li>Repository metadata</li>
                        <li>Health check history</li>
                        <li>Group associations</li>
                        <li>Activity log entries</li>
                    </ul>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <Text variant="small" className="text-amber-800">
                            ⚠️ This action cannot be undone.
                        </Text>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={deleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="danger"
                        onClick={handleDelete}
                        disabled={deleting}
                    >
                        {deleting ? 'Deleting...' : 'Delete from Database'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
