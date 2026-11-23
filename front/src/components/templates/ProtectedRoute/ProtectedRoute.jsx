import { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../../../lib/auth';

export function ProtectedRoute({ children }) {
    const location = useLocation();
    const from = location.pathname + location.search;
    // Remember where the visitor was going, to return there after sign-in.
    // Memoized: a new state object on every render would make Navigate fire again.
    const state = useMemo(() => ({ from }), [from]);
    if (!isAuthenticated()) {
        return <Navigate to="/login" replace state={state} />;
    }
    return children;
}
