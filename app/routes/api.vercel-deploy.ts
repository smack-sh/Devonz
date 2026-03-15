import { type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import type {
  VercelProjectInfo,
  VercelProject,
  VercelDeployment,
  VercelApiError,
  VercelDeploymentConfig,
} from '~/types/vercel';
import { externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('VercelDeploy');

const detectFramework = (files: Record<string, string>): string => {
  const packageJson = files['package.json'];

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      if (dependencies.next) {
        return 'nextjs';
      }

      if (dependencies.react && dependencies['react-router']) {
        return 'remix';
      }

      if (dependencies.react && dependencies.vite) {
        return 'vite';
      }

      if (dependencies.react && dependencies['@vitejs/plugin-react']) {
        return 'vite';
      }

      if (dependencies.react && dependencies['@nuxt/react']) {
        return 'nuxt';
      }

      if (dependencies.react && dependencies['@qwik-city/qwik']) {
        return 'qwik';
      }

      if (dependencies.react && dependencies['@sveltejs/kit']) {
        return 'sveltekit';
      }

      if (dependencies.react && dependencies.astro) {
        return 'astro';
      }

      if (dependencies.react && dependencies['@angular/core']) {
        return 'angular';
      }

      if (dependencies.react && dependencies.vue) {
        return 'vue';
      }

      if (dependencies.react && dependencies['@expo/react-native']) {
        return 'expo';
      }

      if (dependencies.react && dependencies['react-native']) {
        return 'react-native';
      }

      if (dependencies.react) {
        return 'react';
      }

      if (dependencies['@angular/core']) {
        return 'angular';
      }

      if (dependencies.vue) {
        return 'vue';
      }

      if (dependencies['@sveltejs/kit']) {
        return 'sveltekit';
      }

      if (dependencies.astro) {
        return 'astro';
      }

      if (dependencies['@nuxt/core']) {
        return 'nuxt';
      }

      if (dependencies['@qwik-city/qwik']) {
        return 'qwik';
      }

      if (dependencies['@expo/react-native']) {
        return 'expo';
      }

      if (dependencies['react-native']) {
        return 'react-native';
      }

      if (dependencies.vite) {
        return 'vite';
      }

      if (dependencies.webpack) {
        return 'webpack';
      }

      if (dependencies.parcel) {
        return 'parcel';
      }

      if (dependencies.rollup) {
        return 'rollup';
      }

      return 'nodejs';
    } catch (error) {
      logger.error('Error parsing package.json:', error);
    }
  }

  if (files['next.config.js'] || files['next.config.ts']) {
    return 'nextjs';
  }

  if (files['remix.config.js'] || files['remix.config.ts']) {
    return 'remix';
  }

  if (files['vite.config.js'] || files['vite.config.ts']) {
    return 'vite';
  }

  if (files['nuxt.config.js'] || files['nuxt.config.ts']) {
    return 'nuxt';
  }

  if (files['svelte.config.js'] || files['svelte.config.ts']) {
    return 'sveltekit';
  }

  if (files['astro.config.js'] || files['astro.config.ts']) {
    return 'astro';
  }

  if (files['angular.json']) {
    return 'angular';
  }

  if (files['vue.config.js'] || files['vue.config.ts']) {
    return 'vue';
  }

  if (files['app.json'] && files['app.json'].includes('expo')) {
    return 'expo';
  }

  if (files['app.json'] && files['app.json'].includes('react-native')) {
    return 'react-native';
  }

  if (files['index.html']) {
    return 'static';
  }

  return 'other';
};

async function vercelDeployLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const token = url.searchParams.get('token');

  if (!projectId || !token) {
    return Response.json({ error: 'Missing projectId or token' }, { status: 400 });
  }

  return handleApiError('VercelDeploy.loader', async () => {
    const projectResponse = await externalFetch({
      url: `https://api.vercel.com/v9/projects/${projectId}`,
      token,
    });

    if (!projectResponse.ok) {
      return Response.json({ error: 'Failed to fetch project' }, { status: 400 });
    }

    const projectData = (await projectResponse.json()) as VercelProject;

    const deploymentsResponse = await externalFetch({
      url: `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`,
      token,
    });

    if (!deploymentsResponse.ok) {
      return Response.json({ error: 'Failed to fetch deployments' }, { status: 400 });
    }

    const deploymentsData = (await deploymentsResponse.json()) as { deployments?: VercelDeployment[] };

    const latestDeployment = deploymentsData.deployments?.[0];

    return Response.json({
      project: {
        id: projectData.id,
        name: projectData.name,
        url: `https://${projectData.name}.vercel.app`,
      },
      deploy: latestDeployment
        ? {
            id: latestDeployment.id,
            state: latestDeployment.state,
            url: latestDeployment.url ? `https://${latestDeployment.url}` : `https://${projectData.name}.vercel.app`,
          }
        : null,
    });
  });
}

interface DeployRequestBody {
  projectId?: string;
  files: Record<string, string>;
  sourceFiles?: Record<string, string>;
  chatId: string;
  framework?: string;
}

async function vercelDeployAction({ request }: ActionFunctionArgs) {
  return handleApiError('VercelDeploy.action', async () => {
    const { projectId, files, sourceFiles, token, chatId, framework } = (await request.json()) as DeployRequestBody & {
      token: string;
    };

    if (!token) {
      return Response.json({ error: 'Not connected to Vercel' }, { status: 401 });
    }

    let targetProjectId = projectId;
    let projectInfo: VercelProjectInfo | undefined;

    let detectedFramework = framework;

    if (!detectedFramework && sourceFiles) {
      detectedFramework = detectFramework(sourceFiles);
      logger.info('Detected framework from source files:', detectedFramework);
    }

    if (!targetProjectId) {
      const projectName = `devonz-${chatId}-${Date.now()}`;
      const createProjectResponse = await externalFetch({
        url: 'https://api.vercel.com/v9/projects',
        token,
        method: 'POST',
        body: {
          name: projectName,
          framework: detectedFramework || null,
        },
      });

      if (!createProjectResponse.ok) {
        const errorData = (await createProjectResponse.json()) as VercelApiError;
        return Response.json(
          { error: `Failed to create project: ${errorData.error?.message || 'Unknown error'}` },
          { status: 400 },
        );
      }

      const newProject = (await createProjectResponse.json()) as VercelProject;
      targetProjectId = newProject.id;
      projectInfo = {
        id: newProject.id,
        name: newProject.name,
        url: `https://${newProject.name}.vercel.app`,
        chatId,
      };
    } else {
      const projectResponse = await externalFetch({
        url: `https://api.vercel.com/v9/projects/${targetProjectId}`,
        token,
      });

      if (projectResponse.ok) {
        const existingProject = (await projectResponse.json()) as VercelProject;
        projectInfo = {
          id: existingProject.id,
          name: existingProject.name,
          url: `https://${existingProject.name}.vercel.app`,
          chatId,
        };
      } else {
        const projectName = `devonz-${chatId}-${Date.now()}`;
        const createProjectResponse = await externalFetch({
          url: 'https://api.vercel.com/v9/projects',
          token,
          method: 'POST',
          body: {
            name: projectName,
            framework: detectedFramework || null,
          },
        });

        if (!createProjectResponse.ok) {
          const errorData = (await createProjectResponse.json()) as VercelApiError;
          return Response.json(
            { error: `Failed to create project: ${errorData.error?.message || 'Unknown error'}` },
            { status: 400 },
          );
        }

        const newProject = (await createProjectResponse.json()) as VercelProject;
        targetProjectId = newProject.id;
        projectInfo = {
          id: newProject.id,
          name: newProject.name,
          url: `https://${newProject.name}.vercel.app`,
          chatId,
        };
      }
    }

    const deploymentFiles = [];

    const shouldIncludeSourceFiles =
      detectedFramework &&
      ['nextjs', 'react', 'vite', 'remix', 'nuxt', 'sveltekit', 'astro', 'vue', 'angular'].includes(detectedFramework);

    if (shouldIncludeSourceFiles && sourceFiles) {
      for (const [filePath, content] of Object.entries(sourceFiles)) {
        const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        deploymentFiles.push({
          file: normalizedPath,
          data: content,
        });
      }
    } else {
      for (const [filePath, content] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        deploymentFiles.push({
          file: normalizedPath,
          data: content,
        });
      }
    }

    const deploymentConfig: VercelDeploymentConfig = {
      name: projectInfo.name,
      project: targetProjectId,
      target: 'production',
      files: deploymentFiles,
    };

    if (detectedFramework === 'nextjs') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = '.next';
    } else if (detectedFramework === 'react' || detectedFramework === 'vite') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'remix') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'public';
    } else if (detectedFramework === 'nuxt') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = '.output';
    } else if (detectedFramework === 'sveltekit') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'build';
    } else if (detectedFramework === 'astro') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'vue') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else if (detectedFramework === 'angular') {
      deploymentConfig.buildCommand = 'npm run build';
      deploymentConfig.outputDirectory = 'dist';
    } else {
      deploymentConfig.routes = [{ src: '/(.*)', dest: '/$1' }];
    }

    const deployResponse = await externalFetch({
      url: 'https://api.vercel.com/v13/deployments',
      token,
      method: 'POST',
      body: deploymentConfig,
    });

    if (!deployResponse.ok) {
      const errorData = (await deployResponse.json()) as VercelApiError;
      return Response.json(
        { error: `Failed to create deployment: ${errorData.error?.message || 'Unknown error'}` },
        { status: 400 },
      );
    }

    const deployData = (await deployResponse.json()) as VercelDeployment;

    let retryCount = 0;
    const maxRetries = 60;
    let deploymentUrl = '';
    let deploymentState = '';

    while (retryCount < maxRetries) {
      const statusResponse = await externalFetch({
        url: `https://api.vercel.com/v13/deployments/${deployData.id}`,
        token,
      });

      if (statusResponse.ok) {
        const status = (await statusResponse.json()) as VercelDeployment;
        deploymentState = status.readyState ?? '';
        deploymentUrl = status.url ? `https://${status.url}` : '';

        if (status.readyState === 'READY' || status.readyState === 'ERROR') {
          break;
        }
      }

      retryCount++;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (deploymentState === 'ERROR') {
      return Response.json({ error: 'Deployment failed' }, { status: 500 });
    }

    if (retryCount >= maxRetries) {
      return Response.json({ error: 'Deployment timed out' }, { status: 500 });
    }

    return Response.json({
      success: true,
      deploy: {
        id: deployData.id,
        state: deploymentState,
        url: projectInfo.url || deploymentUrl,
      },
      project: projectInfo,
    });
  });
}

export const loader = withSecurity(vercelDeployLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});

export const action = withSecurity(vercelDeployAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
