import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from '~/utils/classNames';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-devonz-elements-bg-depth-3 text-devonz-elements-textPrimary hover:bg-devonz-elements-bg-depth-4',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline:
          'border border-devonz-elements-borderColor bg-transparent hover:bg-devonz-elements-bg-depth-3 text-devonz-elements-textPrimary',
        secondary: 'bg-devonz-elements-bg-depth-3 text-devonz-elements-textPrimary hover:bg-devonz-elements-bg-depth-4',
        ghost: 'hover:bg-devonz-elements-bg-depth-3 text-devonz-elements-textPrimary',
        link: 'text-devonz-elements-textPrimary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  _asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, _asChild = false, ...props }, ref) => {
    return (
      <button type="button" className={classNames(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
