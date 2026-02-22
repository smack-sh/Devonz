import { describe, it, expect } from 'vitest';
import { cleanPackageJson } from './packageJsonCleaner';

describe('cleanPackageJson', () => {
  it('should remove expo and react-native dependencies', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^19',
        'react-dom': '^19',
        next: '16.1.6',
        expo: 'latest',
        'expo-asset': 'latest',
        'expo-file-system': 'latest',
        'expo-gl': 'latest',
        'react-native': 'latest',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(true);
    expect(result.removedDeps).toContain('expo (dependencies)');
    expect(result.removedDeps).toContain('expo-asset (dependencies)');
    expect(result.removedDeps).toContain('expo-file-system (dependencies)');
    expect(result.removedDeps).toContain('expo-gl (dependencies)');
    expect(result.removedDeps).toContain('react-native (dependencies)');

    const cleaned = JSON.parse(result.content);

    /* Local runtime supports all Next.js and React versions — no pinning */
    expect(cleaned.dependencies.next).toBe('16.1.6');
    expect(cleaned.dependencies.react).toBe('^19');
    expect(cleaned.dependencies['react-dom']).toBe('^19');
    expect(cleaned.dependencies.expo).toBeUndefined();
    expect(cleaned.dependencies['react-native']).toBeUndefined();
  });

  it('should remove @nuxt/kit from Next.js projects', () => {
    const pkg = JSON.stringify({
      dependencies: {
        next: '15.5.12',
        react: '^19',
        '@nuxt/kit': 'latest',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(true);
    expect(result.removedDeps).toContain('@nuxt/kit (dependencies)');

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies['@nuxt/kit']).toBeUndefined();
  });

  it('should remove vue-router when no .vue files exist', () => {
    const pkg = JSON.stringify({
      dependencies: {
        next: '15.5.12',
        react: '^19',
        'vue-router': 'latest',
      },
    });

    const result = cleanPackageJson(pkg, ['app/page.tsx', 'app/layout.tsx']);

    expect(result.cleaned).toBe(true);
    expect(result.removedDeps).toContain('vue-router (dependencies, unused)');
  });

  it('should keep vue-router when .vue files exist', () => {
    const pkg = JSON.stringify({
      dependencies: {
        vue: '^3',
        'vue-router': 'latest',
      },
    });

    const result = cleanPackageJson(pkg, ['src/App.vue', 'src/Home.vue']);

    expect(result.cleaned).toBe(false);
    expect(result.removedDeps).toHaveLength(0);
  });

  it('should NOT cap Next.js or React versions (local runtime supports all)', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^19',
        'react-dom': '^19',
        next: '15.5.12',
        'framer-motion': '12.23.12',
      },
      devDependencies: {
        typescript: '^5',
        tailwindcss: '^4.1.9',
        '@types/react': '^19',
        '@types/react-dom': '^19',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies.next).toBe('15.5.12');
    expect(cleaned.dependencies.react).toBe('^19');
    expect(cleaned.dependencies['react-dom']).toBe('^19');
    expect(cleaned.devDependencies['@types/react']).toBe('^19');
    expect(cleaned.devDependencies['@types/react-dom']).toBe('^19');

    /* Non-React deps should be untouched */
    expect(cleaned.dependencies['framer-motion']).toBe('12.23.12');
    expect(cleaned.devDependencies.typescript).toBe('^5');
  });

  it('should leave Next.js 14.x versions untouched', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^18.0.0',
        'react-dom': '^18.0.0',
        next: '14.2.28',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies.next).toBe('14.2.28');
    expect(cleaned.dependencies.react).toBe('^18.0.0');
  });

  it('should handle malformed package.json gracefully', () => {
    const result = cleanPackageJson('not valid json');

    expect(result.cleaned).toBe(false);
    expect(result.content).toBe('not valid json');
  });

  it('should handle package.json with no dependencies', () => {
    const pkg = JSON.stringify({ name: 'test', version: '1.0.0' });
    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);
  });

  it('should remove dynamically detected expo-prefixed packages', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^19',
        'expo-camera': 'latest',
        'expo-location': 'latest',
        'expo-notifications': 'latest',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(true);
    expect(result.removedDeps).toContain('expo-camera (dependencies)');
    expect(result.removedDeps).toContain('expo-location (dependencies)');
    expect(result.removedDeps).toContain('expo-notifications (dependencies)');
  });

  it('should clean real 3d-model-generator template', () => {
    const pkg = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: {
        '@react-three/drei': 'latest',
        '@react-three/fiber': 'latest',
        expo: 'latest',
        'expo-asset': 'latest',
        'expo-file-system': 'latest',
        'expo-gl': 'latest',
        next: '16.1.6',
        react: '^19.2.4',
        'react-dom': '^19.2.4',
        'react-native': 'latest',
        three: 'latest',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(true);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies['@react-three/drei']).toBe('latest');
    expect(cleaned.dependencies['@react-three/fiber']).toBe('latest');
    expect(cleaned.dependencies.three).toBe('latest');

    /* Local runtime supports all versions — no pinning */
    expect(cleaned.dependencies.next).toBe('16.1.6');
    expect(cleaned.dependencies.react).toBe('^19.2.4');
    expect(cleaned.dependencies['react-dom']).toBe('^19.2.4');
    expect(cleaned.dependencies.expo).toBeUndefined();
    expect(cleaned.dependencies['react-native']).toBeUndefined();
  });

  it('should NOT cap @react-three/fiber (local runtime supports React 19)', () => {
    const pkg = JSON.stringify({
      dependencies: {
        '@react-three/fiber': '^9.1.0',
        '@react-three/drei': '^10.0.0',
        next: '15.5.12',
        react: '^19',
        'react-dom': '^19',
        three: '^0.170.0',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies['@react-three/fiber']).toBe('^9.1.0');
    expect(cleaned.dependencies.react).toBe('^19');
    expect(cleaned.dependencies.next).toBe('15.5.12');
    expect(cleaned.dependencies.three).toBe('^0.170.0');
  });

  it('should leave Next.js 14.0.x untouched (local runtime supports all)', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        next: '14.0.0',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies.next).toBe('14.0.0');
    expect(cleaned.dependencies.react).toBe('^18.2.0');
  });

  it('should leave Next.js 14.1.x untouched (local runtime supports all)', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        next: '14.1.4',
      },
    });

    const result = cleanPackageJson(pkg);

    expect(result.cleaned).toBe(false);

    const cleaned = JSON.parse(result.content);
    expect(cleaned.dependencies.next).toBe('14.1.4');
    expect(cleaned.dependencies.react).toBe('^18.2.0');
  });
});
