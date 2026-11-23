import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteRepoModal } from '@/components/organisms/DeleteRepoModal/DeleteRepoModal';

describe('DeleteRepoModal', () => {
  const mockRepo = {
    fullName: 'owner/my-repo',
    deletionDetectedAt: '2026-02-20T10:00:00Z',
  };

  let onClose;
  let onConfirm;

  beforeEach(() => {
    onClose = vi.fn();
    onConfirm = vi.fn().mockResolvedValue(undefined);
  });

  it('renders modal with repo name', () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText('Delete Repository')).toBeInTheDocument();
    expect(screen.getByText('owner/my-repo')).toBeInTheDocument();
  });

  it('shows deletion detected date', () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText(/Detected:/)).toBeInTheDocument();
  });

  it('does not show detected date when not available', () => {
    render(<DeleteRepoModal repo={{ fullName: 'owner/repo' }} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
  });

  it('shows warning about data removal', () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText(/Repository metadata/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button is clicked', () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    // X button is the ghost button in the header
    const buttons = screen.getAllByRole('button');
    const xButton = buttons.find(b => b.querySelector('.lucide-x'));
    if (xButton) fireEvent.click(xButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onConfirm and onClose when Delete is clicked', async () => {
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete from Database'));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(mockRepo);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows deleting state', async () => {
    onConfirm.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete from Database'));
    await waitFor(() => {
      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });
  });

  it('handles error in onConfirm', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    onConfirm.mockRejectedValue(new Error('fail'));
    render(<DeleteRepoModal repo={mockRepo} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete from Database'));
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });
});
