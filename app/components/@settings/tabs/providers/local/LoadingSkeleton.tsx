import React from 'react';
import { classNames } from '~/utils/classNames';

interface LoadingSkeletonProps {
  className?: string;
  lines?: number;
  height?: string;
}

function LoadingSkeleton({ className, lines = 1, height = 'h-4' }: LoadingSkeletonProps) {
  return (
    <div className={classNames('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={classNames('bg-devonz-elements-background-depth-3 rounded', height, 'animate-pulse')}
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

interface ModelCardSkeletonProps {
  className?: string;
}

export function ModelCardSkeleton({ className }: ModelCardSkeletonProps) {
  return (
    <div
      className={classNames(
        'border rounded-lg p-4',
        'bg-devonz-elements-background-depth-2',
        'border-devonz-elements-borderColor',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-3 h-3 rounded-full bg-devonz-elements-textTertiary animate-pulse" />
          <div className="space-y-2 flex-1">
            <LoadingSkeleton height="h-5" lines={1} className="w-3/4" />
            <LoadingSkeleton height="h-3" lines={1} className="w-1/2" />
          </div>
        </div>
        <div className="w-4 h-4 bg-devonz-elements-textTertiary rounded animate-pulse" />
      </div>
    </div>
  );
}
