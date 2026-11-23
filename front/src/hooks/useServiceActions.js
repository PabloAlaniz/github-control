import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

export function useServiceActions({ services, createService, updateService, deleteService, checkHealth, checkAllHealth, fetchServices }) {
    const [showServiceForm, setShowServiceForm] = useState(false);
    const [editingService, setEditingService] = useState(null);
    const [checkingSlug, setCheckingSlug] = useState(null);
    const [checkingAll, setCheckingAll] = useState(false);

    const handleCreate = useCallback(async (data) => {
        await createService(data);
        toast.success('Service created');
        setShowServiceForm(false);
        fetchServices();
    }, [createService, fetchServices]);

    const handleUpdate = useCallback(async (data) => {
        await updateService(editingService.slug, data);
        toast.success('Service updated');
        setEditingService(null);
        fetchServices();
    }, [updateService, editingService, fetchServices]);

    const handleDelete = useCallback(async (slug) => {
        if (!confirm(`Delete service "${slug}"?`)) return;
        try {
            await deleteService(slug);
            toast.success('Service deleted');
            fetchServices();
        } catch (err) {
            toast.error(err.message);
        }
    }, [deleteService, fetchServices]);

    const handleCheckHealth = useCallback(async (slug) => {
        setCheckingSlug(slug);
        try {
            const result = await checkHealth(slug);
            toast.success(`${result.name}: ${result.status} (${result.responseMs}ms)`);
            fetchServices();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setCheckingSlug(null);
        }
    }, [checkHealth, fetchServices]);

    const handleCheckAllHealth = useCallback(async () => {
        setCheckingAll(true);
        try {
            const result = await checkAllHealth();
            toast.success(`Checked ${result.total}: ${result.healthy} healthy, ${result.degraded} degraded, ${result.down} down`);
            fetchServices();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setCheckingAll(false);
        }
    }, [checkAllHealth, fetchServices]);

    return {
        showServiceForm,
        setShowServiceForm,
        editingService,
        setEditingService,
        checkingSlug,
        checkingAll,
        handleCreate,
        handleUpdate,
        handleDelete,
        handleCheckHealth,
        handleCheckAllHealth,
    };
}
