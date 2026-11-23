import React from 'react';
import { Text } from '../../atoms/Text';
import { Button } from '../../atoms/Button';
import { Card } from '../../atoms/Card';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

export function ErrorState({
    message,
    title = 'Something went wrong',
    onRetry,
    retryLabel = 'Try Again',
    variant = 'page',
    icon: Icon = AlertCircle,
    className,
}) {
    if (variant === 'banner') {
        return (
            <div className={cn('p-4 bg-red-50 text-red-600 text-sm border-b border-red-100', className)}>
                {message}
            </div>
        );
    }

    if (variant === 'inline') {
        return (
            <Card className={cn('p-4', className)}>
                <div className="flex items-center gap-2 text-red-600">
                    <Icon size={16} />
                    <Text>{message}</Text>
                </div>
            </Card>
        );
    }

    // variant === 'page'
    return (
        <div className={cn('flex h-screen w-full items-center justify-center bg-gray-50', className)}>
            <div className="flex flex-col items-center gap-4 text-center">
                <Icon size={32} className="text-red-400" />
                <Text variant="h3" className="text-red-600">{title}</Text>
                <Text className="text-gray-600 max-w-md">{message}</Text>
                {onRetry && (
                    <Button onClick={onRetry}>{retryLabel}</Button>
                )}
            </div>
        </div>
    );
}
