import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceTable } from '@/components/organisms/ServiceTable/ServiceTable';

import * as uptimeHook from '@/hooks/useServiceUptime';

vi.mock('@/hooks/useServiceUptime', () => ({ useServiceUptime: vi.fn(() => ({})) }));

vi.mock('@/lib/formatters', () => ({
    formatTimeAgo: vi.fn(() => '2 hours ago'),
}));

describe('ServiceTable', () => {
    const mockServices = [
        {
            slug: 'my-api',
            name: 'My API',
            url: 'https://api.example.com',
            provider: 'gcp',
            env: 'production',
            sourceRepoFullName: 'owner/repo',
            sourcePath: 'api/',
            lastCheckStatus: 'healthy',
            lastCheckResponseMs: 150,
            lastCheckAt: '2026-02-26T10:00:00Z',
            description: 'Main API service',
        },
        {
            slug: 'my-worker',
            name: 'My Worker',
            url: null,
            provider: 'cloudflare',
            env: 'staging',
            sourceRepoFullName: null,
            sourcePath: null,
            lastCheckStatus: null,
            lastCheckResponseMs: null,
            lastCheckAt: null,
            description: null,
        },
    ];

    const defaultProps = {
        services: mockServices,
        loading: false,
        onCheckHealth: vi.fn(),
        onCheckAllHealth: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        checkingSlug: null,
        checkingAll: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state', () => {
        render(<ServiceTable {...defaultProps} loading={true} />);

        expect(screen.getByText('Loading services...')).toBeInTheDocument();
    });

    it('renders empty state when no services', () => {
        render(<ServiceTable {...defaultProps} services={[]} />);

        expect(screen.getByText('No services found')).toBeInTheDocument();
    });

    it('renders services in table with correct data', () => {
        render(<ServiceTable {...defaultProps} />);

        expect(screen.getByText('My API')).toBeInTheDocument();
        expect(screen.getByText('My Worker')).toBeInTheDocument();
        expect(screen.getByText('api.example.com')).toBeInTheDocument();
        expect(screen.getByText('GCP')).toBeInTheDocument();
        expect(screen.getByText('Cloudflare')).toBeInTheDocument();
        expect(screen.getByText('production')).toBeInTheDocument();
        expect(screen.getByText('staging')).toBeInTheDocument();
        expect(screen.getByText('owner/repo')).toBeInTheDocument();
        expect(screen.getByText('150ms')).toBeInTheDocument();
        expect(screen.getByText('2 hours ago')).toBeInTheDocument();
        expect(screen.getByText('Main API service')).toBeInTheDocument();
    });

    it('shows status badge and dot', () => {
        render(<ServiceTable {...defaultProps} />);

        expect(screen.getByText('healthy')).toBeInTheDocument();
        expect(screen.getByText('unknown')).toBeInTheDocument();

        const healthyDot = screen.getByTitle('healthy');
        expect(healthyDot).toBeInTheDocument();
        const unknownDot = screen.getByTitle('unknown');
        expect(unknownDot).toBeInTheDocument();
    });

    it('Check All button calls onCheckAllHealth', () => {
        render(<ServiceTable {...defaultProps} />);

        const checkAllButton = screen.getByText('Check All').closest('button');
        fireEvent.click(checkAllButton);

        expect(defaultProps.onCheckAllHealth).toHaveBeenCalledTimes(1);
    });

    it('individual health check button calls onCheckHealth with slug', () => {
        render(<ServiceTable {...defaultProps} />);

        const healthCheckButtons = screen.getAllByTitle('Health check');
        fireEvent.click(healthCheckButtons[0]);

        expect(defaultProps.onCheckHealth).toHaveBeenCalledWith('my-api');
    });

    it('edit button calls onEdit with service', () => {
        render(<ServiceTable {...defaultProps} />);

        const editButtons = screen.getAllByTitle('Edit');
        fireEvent.click(editButtons[0]);

        expect(defaultProps.onEdit).toHaveBeenCalledWith(mockServices[0]);
    });

    it('delete button calls onDelete with slug', () => {
        render(<ServiceTable {...defaultProps} />);

        const deleteButtons = screen.getAllByTitle('Delete');
        fireEvent.click(deleteButtons[0]);

        expect(defaultProps.onDelete).toHaveBeenCalledWith('my-api');
    });

    it('sort by clicking headers changes order', () => {
        const { container } = render(<ServiceTable {...defaultProps} />);

        // Default sort is by name ascending: My API, My Worker
        let rows = container.querySelectorAll('tbody tr');
        expect(rows[0]).toHaveTextContent('My API');
        expect(rows[1]).toHaveTextContent('My Worker');

        // Click Name header to toggle to descending
        const nameHeader = screen.getByText('Name').closest('th');
        fireEvent.click(nameHeader);

        rows = container.querySelectorAll('tbody tr');
        expect(rows[0]).toHaveTextContent('My Worker');
        expect(rows[1]).toHaveTextContent('My API');

        // Click Provider header to sort by provider ascending
        const providerHeader = screen.getByText('Provider').closest('th');
        fireEvent.click(providerHeader);

        rows = container.querySelectorAll('tbody tr');
        // cloudflare < gcp alphabetically
        expect(rows[0]).toHaveTextContent('My Worker');
        expect(rows[1]).toHaveTextContent('My API');
    });

    describe('uptime history', () => {
        const services = [
            { slug: 'api', name: 'API', url: 'https://api.test', provider: 'cloudflare', env: 'production', lastCheckAt: '2026-11-23T10:00:00Z' },
            { slug: 'web', name: 'Web', url: 'https://web.test', provider: 'vercel', env: 'production' },
        ];

        it('shows uptime for services with history and a placeholder for the rest', () => {
            uptimeHook.useServiceUptime.mockReturnValue({
                api: { checks: 10, uptimePct: 98.5, avgMs: 210, incidents: 2, lastDownAt: null, daily: [{ date: '2026-11-23', checks: 10, down: 0, degraded: 0, avgMs: 210 }] },
            });

            render(<ServiceTable services={services} />);

            expect(screen.getByText('Uptime 30d')).toBeInTheDocument();
            expect(screen.getByText('98.5%')).toBeInTheDocument();
            expect(screen.getByText('2 incidents')).toBeInTheDocument();
            expect(screen.getByText('no history')).toBeInTheDocument();
        });

        it('keys the uptime request on the last check of each service', () => {
            render(<ServiceTable services={services} />);
            expect(uptimeHook.useServiceUptime).toHaveBeenCalledWith('api:2026-11-23T10:00:00Z|web:');
        });
    });
});
