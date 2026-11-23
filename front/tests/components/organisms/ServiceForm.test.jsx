import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServiceForm } from '@/components/organisms/ServiceForm/ServiceForm';

describe('ServiceForm', () => {
    const defaultProps = {
        service: null,
        onSubmit: vi.fn().mockResolvedValue({}),
        onClose: vi.fn(),
    };

    const mockService = {
        name: 'My API',
        url: 'https://api.example.com',
        provider: 'gcp',
        project: 'my-project',
        region: 'us-central1',
        env: 'production',
        sourceRepoFullName: 'owner/repo',
        sourcePath: 'api/',
        description: 'Main API service',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders in create mode with "Add Service" title', () => {
        render(<ServiceForm {...defaultProps} />);

        expect(screen.getByText('Add Service')).toBeInTheDocument();
        expect(screen.getByText('Create')).toBeInTheDocument();
    });

    it('renders in edit mode with "Edit Service" title and pre-filled fields', () => {
        render(<ServiceForm {...defaultProps} service={mockService} />);

        expect(screen.getByText('Edit Service')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
        expect(screen.getByDisplayValue('My API')).toBeInTheDocument();
        expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument();
        expect(screen.getByDisplayValue('my-project')).toBeInTheDocument();
        expect(screen.getByDisplayValue('us-central1')).toBeInTheDocument();
        expect(screen.getByDisplayValue('owner/repo')).toBeInTheDocument();
        expect(screen.getByDisplayValue('api/')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Main API service')).toBeInTheDocument();
    });

    it('submit calls onSubmit with form data', async () => {
        render(<ServiceForm {...defaultProps} />);

        const nameInput = screen.getByPlaceholderText('My API');
        const urlInput = screen.getByPlaceholderText('https://api.example.com');
        const descriptionInput = screen.getByPlaceholderText('Brief description');

        fireEvent.change(nameInput, { target: { value: 'Test Service' } });
        fireEvent.change(urlInput, { target: { value: 'https://test.com' } });
        fireEvent.change(descriptionInput, { target: { value: 'A test service' } });

        const submitButton = screen.getByText('Create');
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(defaultProps.onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Test Service',
                    url: 'https://test.com',
                    description: 'A test service',
                    provider: 'gcp',
                    env: 'production',
                })
            );
        });

        await waitFor(() => {
            expect(defaultProps.onClose).toHaveBeenCalled();
        });
    });

    it('cancel button calls onClose', () => {
        render(<ServiceForm {...defaultProps} />);

        const cancelButton = screen.getByText('Cancel');
        fireEvent.click(cancelButton);

        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('X button calls onClose', () => {
        render(<ServiceForm {...defaultProps} />);

        // The X button is a ghost/icon button. Find it by its position near the title.
        // The ServiceForm has two ghost buttons: the X close button and the Cancel button.
        // The X button is the first one with size="icon".
        const buttons = screen.getAllByRole('button');
        // First button is the X (close) icon button
        const xButton = buttons[0];
        fireEvent.click(xButton);

        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('submit is disabled when name is empty', () => {
        render(<ServiceForm {...defaultProps} />);

        // In create mode with default empty name, the Create button should be disabled
        const submitButton = screen.getByText('Create');
        expect(submitButton).toBeDisabled();
    });
});
