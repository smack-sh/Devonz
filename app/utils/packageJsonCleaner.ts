/**
 * Cleans up a package.json for compatibility.
 *
 * Many v0-generated projects include unnecessary dependencies
 * (expo, react-native, vue-router in React projects, etc.)
 * that fail to install. This utility strips them out so
 * `npm install` succeeds without manual intervention.
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PackageJsonCleaner');

/**
 * Dependencies that should NEVER be installed in a web project.
 * These are React Native / mobile-only packages that will fail.
 */
const BLOCKLISTED_DEPENDENCIES = [
  /* React Native / Expo ecosystem (not compatible with web projects) */
  'react-native',
  'react-native-web',
  'expo',
  'expo-asset',
  'expo-file-system',
  'expo-gl',
  'expo-constants',
  'expo-modules-core',
  'expo-linking',
  'expo-router',
  'expo-status-bar',
  'expo-splash-screen',

  /* Misplaced framework deps (e.g. Vue deps in a React/Next.js project) */
  '@nuxt/kit',
  '@nuxt/schema',
  'nuxi',
];

/**
 * Dependencies that should only be removed if the project
 * is NOT actually using the associated framework.
 */
const CONDITIONAL_BLOCKLIST: Record<string, { onlyRemoveIfMissing: string }> = {
  'vue-router': { onlyRemoveIfMissing: 'vue' },
  vue: { onlyRemoveIfMissing: 'vue' },
};

interface CleanupResult {
  cleaned: boolean;
  removedDeps: string[];
  content: string;
}

/**
 * Cleans a package.json by removing incompatible dependencies.
 * Removes React Native, Expo, and misplaced framework deps that
 * would cause `npm install` to fail.
 *
 * @param packageJsonContent - The raw package.json file content
 * @param projectFiles - Optional list of project file paths to help detect framework usage
 * @returns Cleaned package.json content and metadata about what was removed
 */
export function cleanPackageJson(packageJsonContent: string, projectFiles?: string[]): CleanupResult {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const removedDeps: string[] = [];
    const hasVueFiles = projectFiles?.some((f) => f.endsWith('.vue')) ?? false;

    // Process both dependencies and devDependencies
    for (const depType of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[depType];

      if (!deps || typeof deps !== 'object') {
        continue;
      }

      // Remove blocklisted dependencies
      for (const dep of BLOCKLISTED_DEPENDENCIES) {
        if (deps[dep]) {
          delete deps[dep];
          removedDeps.push(`${dep} (${depType})`);
        }
      }

      // Remove conditional blocklist items
      for (const [dep, condition] of Object.entries(CONDITIONAL_BLOCKLIST)) {
        if (deps[dep]) {
          // Check if the framework is actually used
          const frameworkDep = condition.onlyRemoveIfMissing;

          if (dep === 'vue-router' || dep === 'vue') {
            // Only remove vue-related deps if no .vue files exist
            if (!hasVueFiles && !pkg.dependencies?.vue && !pkg.devDependencies?.vue) {
              delete deps[dep];
              removedDeps.push(`${dep} (${depType}, unused)`);
            }
          } else if (!deps[frameworkDep] && !pkg.dependencies?.[frameworkDep] && !pkg.devDependencies?.[frameworkDep]) {
            delete deps[dep];
            removedDeps.push(`${dep} (${depType}, unused)`);
          }
        }
      }

      // Remove expo-prefixed dependencies dynamically
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith('expo-') && !BLOCKLISTED_DEPENDENCIES.includes(dep)) {
          delete deps[dep];
          removedDeps.push(`${dep} (${depType})`);
        }
      }
    }

    if (removedDeps.length > 0) {
      logger.info(`Cleaned package.json: removed ${removedDeps.length} incompatible deps:`, removedDeps);
    }

    return {
      cleaned: removedDeps.length > 0,
      removedDeps,
      content: JSON.stringify(pkg, null, 2),
    };
  } catch (error) {
    logger.error('Failed to clean package.json:', error);

    return {
      cleaned: false,
      removedDeps: [],
      content: packageJsonContent,
    };
  }
}
