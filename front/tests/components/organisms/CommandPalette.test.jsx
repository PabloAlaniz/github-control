import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '@/components/organisms/CommandPalette';
import { buildCommands } from '@/lib/commands';

describe('CommandPalette', () => {
    let commands;
    let onClose;

    beforeEach(() => {
        onClose = vi.fn();
        commands = [
            { id: 'a', section: 'Actions', label: 'Refresh data', run: vi.fn() },
            { id: 'b', section: 'Repos', label: 'me/api', hint: 'Evolution', run: vi.fn(), runAlt: vi.fn() },
            { id: 'c', section: 'Repos', label: 'me/web', keywords: ['landing'], run: vi.fn() },
        ];
    });

    const input = () => screen.getByRole('combobox');
    const options = () => screen.getAllByRole('option').map(o => o.textContent);

    it('renders nothing when closed', () => {
        render(<CommandPalette open={false} onClose={onClose} commands={commands} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lists all commands grouped by section', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(screen.getByText('Actions')).toBeInTheDocument();
        expect(screen.getAllByText('Repos')).toHaveLength(1);
    });

    it('filters by label and keywords', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);

        fireEvent.change(input(), { target: { value: 'landing' } });
        expect(options()).toEqual(['me/web']);

        fireEvent.change(input(), { target: { value: 'zzz' } });
        expect(screen.getByText('No matches')).toBeInTheDocument();
    });

    it('runs the highlighted command on Enter and closes', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);

        fireEvent.keyDown(input(), { key: 'ArrowDown' });
        fireEvent.keyDown(input(), { key: 'Enter' });

        expect(commands[1].run).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('wraps around with the arrow keys', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);

        fireEvent.keyDown(input(), { key: 'ArrowUp' });
        fireEvent.keyDown(input(), { key: 'Enter' });

        expect(commands[2].run).toHaveBeenCalled();
    });

    it('runs the alternate action on Shift+Enter, falling back to run', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);

        fireEvent.change(input(), { target: { value: 'api' } });
        fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
        expect(commands[1].runAlt).toHaveBeenCalled();
        expect(commands[1].run).not.toHaveBeenCalled();
    });

    it('runs a command on click', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.click(screen.getByText('me/web'));
        expect(commands[2].run).toHaveBeenCalled();
    });

    it('closes on Escape and on backdrop click, without running anything', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);

        fireEvent.keyDown(input(), { key: 'Escape' });
        fireEvent.mouseDown(screen.getByRole('dialog').parentElement);

        expect(onClose).toHaveBeenCalledTimes(2);
        commands.forEach(c => expect(c.run).not.toHaveBeenCalled());
    });

    it('does nothing on Enter without matches', () => {
        render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.change(input(), { target: { value: 'zzz' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('resets the query when reopened', () => {
        const { rerender } = render(<CommandPalette open onClose={onClose} commands={commands} />);
        fireEvent.change(input(), { target: { value: 'api' } });

        rerender(<CommandPalette open={false} onClose={onClose} commands={commands} />);
        rerender(<CommandPalette open onClose={onClose} commands={commands} />);

        expect(input()).toHaveValue('');
    });
});

describe('buildCommands', () => {
    const actions = {
        refresh: vi.fn(), resetFilters: vi.fn(), setTab: vi.fn(), navigate: vi.fn(),
        applyView: vi.fn(), filterByGroup: vi.fn(), openExternal: vi.fn(), logout: vi.fn(),
    };
    const commands = buildCommands({
        repos: [
            { fullName: 'me/api', name: 'api', description: 'backend' },
            { fullName: 'me/gone', name: 'gone', isDeleted: true },
        ],
        groups: [{ slug: 'prod', name: 'Producción' }],
        views: [{ id: 7, name: 'Stale', query: 'stale=1' }],
        actions,
    });
    const run = (id, alt) => {
        const c = commands.find(cmd => cmd.id === id);
        (alt ? c.runAlt : c.run)();
    };

    it('skips deleted repos', () => {
        expect(commands.find(c => c.id === 'repo:me/gone')).toBeUndefined();
    });

    it('wires every kind of command to its action', () => {
        run('act:refresh'); run('act:reset'); run('act:logout');
        run('tab:default'); run('tab:testing'); run('tab:infrastructure');
        run('nav:activity'); run('nav:metrics');
        run('view:7'); run('group:prod');
        run('repo:me/api'); run('repo:me/api', true);

        expect(actions.refresh).toHaveBeenCalled();
        expect(actions.resetFilters).toHaveBeenCalled();
        expect(actions.logout).toHaveBeenCalled();
        expect(actions.setTab.mock.calls.map(c => c[0])).toEqual(['default', 'testing', 'infrastructure']);
        expect(actions.navigate.mock.calls.map(c => c[0])).toEqual(['/activity', '/metrics', '/metrics/me/api']);
        expect(actions.applyView).toHaveBeenCalledWith({ id: 7, name: 'Stale', query: 'stale=1' });
        expect(actions.filterByGroup).toHaveBeenCalledWith('prod');
        expect(actions.openExternal).toHaveBeenCalledWith('https://github.com/me/api');
    });

    it('works with no data', () => {
        expect(buildCommands({ actions }).length).toBeGreaterThan(0);
    });
});
