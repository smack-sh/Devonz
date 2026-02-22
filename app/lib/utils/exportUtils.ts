import type { FileMap } from '~/lib/stores/files';
import { extractRelativePath } from '~/utils/diff';
import { description } from '~/lib/persistence';

/**
 * Download all non-binary files as a zip archive.
 * File name is derived from the project description with a timestamp hash.
 */
export async function downloadFilesAsZip(files: FileMap): Promise<void> {
  const jsZipModule = await import('jszip');
  const { saveAs } = await import('file-saver');

  const zip = new jsZipModule.default();

  const projectName = (description.value ?? 'project').toLocaleLowerCase().split(' ').join('_');

  // Generate a simple 6-character hash based on the current timestamp
  const timestampHash = Date.now().toString(36).slice(-6);
  const uniqueProjectName = `${projectName}_${timestampHash}`;

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && !dirent.isBinary) {
      const relativePath = extractRelativePath(filePath);
      const pathSegments = relativePath.split('/');

      if (pathSegments.length > 1) {
        let currentFolder = zip;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentFolder = currentFolder.folder(pathSegments[i])!;
        }

        currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
      } else {
        zip.file(relativePath, dirent.content);
      }
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `${uniqueProjectName}.zip`);
}

/**
 * Sync all non-binary files to a local directory handle (File System Access API).
 * Returns the list of relative paths that were synced.
 */
export async function syncFilesToDirectory(files: FileMap, targetHandle: FileSystemDirectoryHandle): Promise<string[]> {
  const syncedFiles: string[] = [];

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && !dirent.isBinary) {
      const relativePath = extractRelativePath(filePath);
      const pathSegments = relativePath.split('/');
      let currentHandle = targetHandle;

      for (let i = 0; i < pathSegments.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
      }

      const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], {
        create: true,
      });

      const writable = await fileHandle.createWritable();
      await writable.write(dirent.content);
      await writable.close();

      syncedFiles.push(relativePath);
    }
  }

  return syncedFiles;
}
