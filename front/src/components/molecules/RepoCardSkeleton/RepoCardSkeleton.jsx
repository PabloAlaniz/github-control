import React from 'react';
import { Card } from '../../atoms/Card';

export function RepoCardSkeleton() {
    return (
        <Card className="h-full p-5 space-y-4 animate-pulse">
            <div className="flex justify-between items-start">
                <div className="space-y-2 w-3/4">
                    <div className="h-5 bg-gray-200 rounded w-1/2"></div>
                    <div className="flex gap-2">
                        <div className="h-5 w-16 bg-gray-200 rounded-full"></div>
                        <div className="h-5 w-16 bg-gray-200 rounded-full"></div>
                    </div>
                </div>
                <div className="h-3 w-3 bg-gray-200 rounded-full mt-2"></div>
            </div>

            <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
            </div>

            <div className="pt-4 mt-auto border-t border-gray-100 flex justify-between items-center">
                <div className="h-3 bg-gray-200 rounded w-24"></div>
                <div className="h-8 w-8 bg-gray-200 rounded-lg"></div>
            </div>
        </Card>
    );
}
