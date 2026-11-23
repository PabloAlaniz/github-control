import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityItem } from '@/components/molecules/ActivityItem/ActivityItem';

describe('ActivityItem', () => {
    const mockActivity = {
        action: 'priority.set',
        entityType: 'repo',
        entityId: 'acme/test-repo',
        fieldChanged: 'priority',
        oldValue: 'low',
        newValue: 'high',
        actorType: 'agent',
        actorName: 'triage-bot',
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min ago
    };

    it('renders activity item with correct action label', () => {
        render(<ActivityItem activity={mockActivity} />);
        expect(screen.getByText('Set priority')).toBeInTheDocument();
    });

    it('renders actor badge', () => {
        render(<ActivityItem activity={mockActivity} />);
        expect(screen.getByText('triage-bot')).toBeInTheDocument();
    });

    it('renders repo name when showRepo is true', () => {
        render(<ActivityItem activity={mockActivity} showRepo={true} />);
        expect(screen.getByText('acme/test-repo')).toBeInTheDocument();
    });

    it('does not render repo name when showRepo is false', () => {
        render(<ActivityItem activity={mockActivity} showRepo={false} />);
        expect(screen.queryByText('acme/test-repo')).not.toBeInTheDocument();
    });

    it('renders old and new values', () => {
        render(<ActivityItem activity={mockActivity} />);
        expect(screen.getByText('low')).toBeInTheDocument();
        expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('renders time ago', () => {
        render(<ActivityItem activity={mockActivity} />);
        expect(screen.getByText(/ago|just now/)).toBeInTheDocument();
    });

    it('renders only old value when no new value', () => {
        const activityWithOnlyOld = {
            ...mockActivity,
            newValue: null
        };
        render(<ActivityItem activity={activityWithOnlyOld} />);
        expect(screen.getByText('low')).toBeInTheDocument();
        expect(screen.queryByText('high')).not.toBeInTheDocument();
    });

    it('renders only new value when no old value', () => {
        const activityWithOnlyNew = {
            ...mockActivity,
            oldValue: null
        };
        render(<ActivityItem activity={activityWithOnlyNew} />);
        expect(screen.getByText('high')).toBeInTheDocument();
        expect(screen.queryByText('low')).not.toBeInTheDocument();
    });

    it('handles group.add action', () => {
        const groupAddActivity = {
            ...mockActivity,
            action: 'group.add'
        };
        render(<ActivityItem activity={groupAddActivity} />);
        expect(screen.getByText('Added to group')).toBeInTheDocument();
    });

    it('handles group.remove action', () => {
        const groupRemoveActivity = {
            ...mockActivity,
            action: 'group.remove'
        };
        render(<ActivityItem activity={groupRemoveActivity} />);
        expect(screen.getByText('Removed from group')).toBeInTheDocument();
    });

    it('handles health.update action', () => {
        const healthActivity = {
            ...mockActivity,
            action: 'health.update'
        };
        render(<ActivityItem activity={healthActivity} />);
        expect(screen.getByText('Updated health')).toBeInTheDocument();
    });

    it('handles blocker.add action', () => {
        const blockerActivity = {
            ...mockActivity,
            action: 'blocker.add'
        };
        render(<ActivityItem activity={blockerActivity} />);
        expect(screen.getByText('Added blocker')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        const { container } = render(
            <ActivityItem activity={mockActivity} className="custom-class" />
        );
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('handles unknown action gracefully', () => {
        const unknownActivity = {
            ...mockActivity,
            action: 'unknown.action'
        };
        render(<ActivityItem activity={unknownActivity} />);
        expect(screen.getByText('unknown action')).toBeInTheDocument();
    });

    it('formats time correctly for recent activity', () => {
        const recentActivity = {
            ...mockActivity,
            createdAt: new Date(Date.now() - 30 * 1000).toISOString() // 30 sec ago
        };
        render(<ActivityItem activity={recentActivity} />);
        expect(screen.getByText('just now')).toBeInTheDocument();
    });

    it('formats time correctly for hours ago', () => {
        const hoursActivity = {
            ...mockActivity,
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago
        };
        render(<ActivityItem activity={hoursActivity} />);
        expect(screen.getByText('2h ago')).toBeInTheDocument();
    });

    it('formats time correctly for days ago', () => {
        const daysActivity = {
            ...mockActivity,
            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3d ago
        };
        render(<ActivityItem activity={daysActivity} />);
        expect(screen.getByText('3d ago')).toBeInTheDocument();
    });
});
