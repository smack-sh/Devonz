import { useMemo } from 'react';
import { computed } from 'nanostores';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Subscribe to a single file's content without re-rendering on
 * changes to other files. Much cheaper than subscribing to the
 * entire files MapStore.
 */
export function useFileContent(filePath: string): string | undefined {
  const fileAtom = useMemo(
    () =>
      computed(workbenchStore.files, (files) => {
        const entry = files[filePath];
        return entry?.type === 'file' ? entry.content : undefined;
      }),
    [filePath],
  );

  return useStore(fileAtom);
}
