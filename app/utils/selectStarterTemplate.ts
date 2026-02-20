import ignore from 'ignore';
import type { ProviderInfo } from '~/types/model';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('StarterTemplate');

/**
 * Known shadcn/ui peer dependencies that MUST be in package.json
 * when using shadcn/ui components. Maps package name to version.
 * These are the Radix UI primitives and utilities that shadcn/ui imports.
 */
const SHADCN_PEER_DEPS: Record<string, string> = {
  '@radix-ui/react-slot': '^1.1.0',
  '@radix-ui/react-label': '^2.1.0',
  '@radix-ui/react-dialog': '^1.1.2',
  '@radix-ui/react-select': '^2.1.2',
  '@radix-ui/react-tabs': '^1.1.1',
  '@radix-ui/react-separator': '^1.1.0',
  '@radix-ui/react-scroll-area': '^1.2.0',
  '@radix-ui/react-avatar': '^1.1.1',
  '@radix-ui/react-checkbox': '^1.1.2',
  '@radix-ui/react-switch': '^1.1.1',
  '@radix-ui/react-toggle': '^1.1.0',
  '@radix-ui/react-toggle-group': '^1.1.0',
  '@radix-ui/react-tooltip': '^1.1.3',
  '@radix-ui/react-popover': '^1.1.2',
  '@radix-ui/react-dropdown-menu': '^2.1.2',
  '@radix-ui/react-context-menu': '^2.2.2',
  '@radix-ui/react-accordion': '^1.2.1',
  '@radix-ui/react-alert-dialog': '^1.1.2',
  '@radix-ui/react-aspect-ratio': '^1.1.0',
  '@radix-ui/react-collapsible': '^1.1.1',
  '@radix-ui/react-hover-card': '^1.1.2',
  '@radix-ui/react-menubar': '^1.1.2',
  '@radix-ui/react-navigation-menu': '^1.2.1',
  '@radix-ui/react-progress': '^1.1.0',
  '@radix-ui/react-radio-group': '^1.2.1',
  '@radix-ui/react-slider': '^1.2.1',
  '@radix-ui/react-toast': '^1.2.2',
  'class-variance-authority': '^0.7.0',
  clsx: '^2.1.1',
  'tailwind-merge': '^2.5.4',
  'lucide-react': '^0.460.0',
};

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.
IMPORTANT: Vite is preferred
IMPORTANT: Prefer shadcn templates for React projects that need UI components.

Available templates:
<template>
  <name>blank</name>
  <description>Empty starter for simple scripts and trivial tasks that don't require a full template setup</description>
  <tags>basic, script</tags>
</template>
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Response Format:
<selection>
  <templateName>{selected template name}</templateName>
  <title>{a proper title for the project}</title>
</selection>

Examples:

<example>
User: I need to build a todo app
Response:
<selection>
  <templateName>react-basic-starter</templateName>
  <title>Simple React todo application</title>
</selection>
</example>

<example>
User: Write a script to generate numbers from 1 to 100
Response:
<selection>
  <templateName>blank</templateName>
  <title>script to generate numbers from 1 to 100</title>
</selection>
</example>

Instructions:
1. For trivial tasks and simple scripts, always recommend the blank template
2. For more complex projects, recommend templates from the provided list
3. Follow the exact XML format
4. Consider both technical requirements and tags
5. If no perfect match exists, recommend the closest option

Important: Provide only the selection tags in your response, no additional text.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH 
`;

const templates: Template[] = STARTER_TEMPLATES;

const parseSelectedTemplate = (llmOutput: string): { template: string; title: string } | null => {
  try {
    // Extract content between <templateName> tags
    const templateNameMatch = llmOutput.match(/<templateName>(.*?)<\/templateName>/);
    const titleMatch = llmOutput.match(/<title>(.*?)<\/title>/);

    if (!templateNameMatch) {
      return null;
    }

    return { template: templateNameMatch[1].trim(), title: titleMatch?.[1].trim() || 'Untitled Project' };
  } catch (error) {
    logger.error('Error parsing template selection:', error);
    return null;
  }
};

export const selectStarterTemplate = async (options: { message: string; model: string; provider: ProviderInfo }) => {
  const { message, model, provider } = options;
  const requestBody = {
    message,
    model,
    provider,
    system: starterTemplateSelectionPrompt(templates),
  };
  const response = await fetch('/api/llmcall', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
  const respJson: { text: string } = await response.json();
  logger.debug(respJson);

  const { text } = respJson;
  const selectedTemplate = parseSelectedTemplate(text);

  if (selectedTemplate) {
    return selectedTemplate;
  } else {
    logger.info('No template selected, using blank template');

    return {
      template: 'blank',
      title: '',
    };
  }
};

const getGitHubRepoContent = async (repoName: string): Promise<{ name: string; path: string; content: string }[]> => {
  try {
    // Instead of directly fetching from GitHub, use our own API endpoint as a proxy
    const response = await fetch(`/api/github-template?repo=${encodeURIComponent(repoName)}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Our API will return the files in the format we need
    const files = (await response.json()) as Array<{ name: string; path: string; content: string }>;

    return files;
  } catch (error) {
    logger.error('Error fetching release contents:', error);
    throw error;
  }
};

/**
 * Inject missing shadcn/ui peer dependencies into a template's package.json.
 * Scans component files for @radix-ui imports and ensures those packages
 * are listed in dependencies. This prevents auto-fix loops caused by
 * missing peer deps at runtime.
 */
function injectShadcnPeerDeps(files: Array<{ name: string; path: string; content: string }>): void {
  const pkgJsonFile = files.find((f) => f.path === 'package.json' || f.name === 'package.json');

  if (!pkgJsonFile) {
    return;
  }

  try {
    const pkgJson = JSON.parse(pkgJsonFile.content);
    const deps = pkgJson.dependencies || {};
    const devDeps = pkgJson.devDependencies || {};
    const allExistingDeps = { ...deps, ...devDeps };

    // Collect all @radix-ui and other shadcn imports actually used in component files
    const usedPackages = new Set<string>();

    for (const file of files) {
      if (!file.path.endsWith('.tsx') && !file.path.endsWith('.ts')) {
        continue;
      }

      // Match import statements for known peer deps
      const importMatches = file.content.matchAll(
        /from\s+['"](@radix-ui\/[^'"]+|class-variance-authority|clsx|tailwind-merge|lucide-react)['"]/g,
      );

      for (const match of importMatches) {
        usedPackages.add(match[1]);
      }
    }

    // Add missing deps that are imported but not in package.json
    let injectedCount = 0;

    for (const pkg of usedPackages) {
      if (!allExistingDeps[pkg] && SHADCN_PEER_DEPS[pkg]) {
        deps[pkg] = SHADCN_PEER_DEPS[pkg];
        injectedCount++;
      }
    }

    if (injectedCount > 0) {
      pkgJson.dependencies = deps;
      pkgJsonFile.content = JSON.stringify(pkgJson, null, 2);
      logger.info(`Injected ${injectedCount} missing shadcn/ui peer dependencies into template package.json`);
    }
  } catch (error) {
    logger.error('Failed to inject shadcn peer deps:', error);
  }
}

export async function getTemplates(templateName: string, title?: string) {
  const template = STARTER_TEMPLATES.find((t) => t.name == templateName);

  if (!template) {
    return null;
  }

  const githubRepo = template.githubRepo;
  const files = await getGitHubRepoContent(githubRepo);

  /*
   * Inject missing shadcn/ui peer dependencies for shadcn templates.
   * This prevents auto-fix loops caused by missing @radix-ui packages.
   */
  if (templateName.toLowerCase().includes('shadcn')) {
    injectShadcnPeerDeps(files);
  }

  let filteredFiles = files;

  /*
   * ignoring common unwanted files
   * exclude    .git
   */
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.git') == false);

  /*
   * exclude    lock files
   * WE NOW INCLUDE LOCK FILES FOR IMPROVED INSTALL TIMES
   */
  {
    /*
     *const comminLockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
     *filteredFiles = filteredFiles.filter((x) => comminLockFiles.includes(x.name) == false);
     */
  }

  // exclude    .bolt
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.bolt') == false);

  // check for ignore file in .bolt folder
  const templateIgnoreFile = files.find((x) => x.path.startsWith('.bolt') && x.name == 'ignore');

  const filesToImport = {
    files: filteredFiles,
    ignoreFile: [] as typeof filteredFiles,
  };

  if (templateIgnoreFile) {
    // redacting files specified in ignore file
    const ignorepatterns = templateIgnoreFile.content.split('\n').map((x) => x.trim());
    const ig = ignore().add(ignorepatterns);

    // filteredFiles = filteredFiles.filter(x => !ig.ignores(x.path))
    const ignoredFiles = filteredFiles.filter((x) => ig.ignores(x.path));

    filesToImport.files = filteredFiles;
    filesToImport.ignoreFile = ignoredFiles;
  }

  const assistantMessage = `
Devonz is initializing your project with the required files using the ${template.name} template.
<boltArtifact id="imported-files" title="${title || 'Create initial files'}" type="bundled">
${filesToImport.files
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>
`;
  let userMessage = ``;
  const templatePromptFile = files.filter((x) => x.path.startsWith('.bolt')).find((x) => x.name == 'prompt');

  if (templatePromptFile) {
    userMessage = `
TEMPLATE INSTRUCTIONS:
${templatePromptFile.content}

---
`;
  }

  if (filesToImport.ignoreFile.length > 0) {
    userMessage =
      userMessage +
      `
STRICT FILE ACCESS RULES - READ CAREFULLY:

The following files are READ-ONLY and must never be modified:
${filesToImport.ignoreFile.map((file) => `- ${file.path}`).join('\n')}

Permitted actions:
✓ Import these files as dependencies
✓ Read from these files
✓ Reference these files

Strictly forbidden actions:
❌ Modify any content within these files
❌ Delete these files
❌ Rename these files
❌ Move these files
❌ Create new versions of these files
❌ Suggest changes to these files

Any attempt to modify these protected files will result in immediate termination of the operation.

If you need to make changes to functionality, create new files instead of modifying the protected ones listed above.
---
`;
  }

  /*
   * For shadcn templates, extract the template dependencies and add
   * explicit instructions to preserve them. This prevents the LLM from
   * rewriting package.json from scratch and dropping critical deps like
   * @radix-ui/*, class-variance-authority, etc. which causes cascading
   * auto-fix loops.
   */
  if (templateName.toLowerCase().includes('shadcn')) {
    const pkgFile = files.find((f) => f.path === 'package.json' || f.name === 'package.json');

    if (pkgFile) {
      try {
        const pkgJson = JSON.parse(pkgFile.content);
        const deps = Object.keys(pkgJson.dependencies || {});

        // Detect Tailwind CSS version from devDependencies
        const tailwindVersion = pkgJson.devDependencies?.tailwindcss || '';
        const isTailwindV3 =
          tailwindVersion.startsWith('^3') || tailwindVersion.startsWith('~3') || tailwindVersion.startsWith('3');

        userMessage += `
---
⚠️ CRITICAL: PACKAGE.JSON DEPENDENCY RULES ⚠️

The template package.json already contains ALL required dependencies for shadcn/ui,
Radix UI primitives, and utility libraries. These are MANDATORY for the project to work.

RULES:
1. NEVER rewrite package.json from scratch
2. If you need to modify package.json, ONLY ADD new dependencies — keep ALL existing ones
3. The following ${deps.length} dependencies MUST remain in package.json:
${deps.map((d) => `   - ${d}`).join('\n')}

If you rewrite package.json without these dependencies, the build WILL fail with
missing module errors and require multiple fix attempts.

When modifying package.json, start from the existing file content and only add what you need.
${
  isTailwindV3
    ? `
⚠️ TAILWIND CSS VERSION: This template uses Tailwind CSS v3.
- Use \`@tailwind base; @tailwind components; @tailwind utilities;\` directives in CSS files
- Do NOT use the Tailwind CSS v4 \`@import "tailwindcss";\` syntax — it will cause PostCSS parse errors
`
    : ''
}
---
`;
      } catch {
        // Failed to parse package.json, skip dep preservation instructions
      }
    }
  }

  userMessage += `
---
template import is done, and you can now use the imported files,
edit only the files that need to be changed, and you can create new files as needed.
NEVER REWRITE FILES THAT ALREADY EXIST unless you need to change their content.
When modifying existing files, preserve all existing functionality and dependencies.
---
Now that the Template is imported please continue with my original request

IMPORTANT: Dont Forget to install the dependencies before running the app by using \`npm install && npm run dev\`
`;

  return {
    assistantMessage,
    userMessage,
  };
}
