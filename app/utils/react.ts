import { lazy, memo } from 'react';

export const genericMemo: <T extends keyof JSX.IntrinsicElements | React.JSXElementConstructor<any>>(
  component: T,
  propsAreEqual?: (prevProps: React.ComponentProps<T>, nextProps: React.ComponentProps<T>) => boolean,
) => T & { displayName?: string } = memo;

/**
 * SSR-safe wrapper around React.lazy for .client.tsx modules.
 *
 * React Router v7 stubs .client module exports to `undefined` on the server.
 * This wrapper detects that and returns a no-op component so SSR completes
 * without the "Element type is invalid: got undefined" error.
 */
export function clientLazy<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const mod = await factory();

    if (mod.default) {
      return mod;
    }

    // SSR: .client module export is undefined — render nothing
    return { default: (() => null) as unknown as T };
  });
}
