import { generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import { createHash } from 'node:crypto';
import ignore from 'ignore';
import type { IProviderSetting } from '~/types/model';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import {
  createFilesContext,
  extractCurrentContext,
  extractPropertiesFromMessage,
  simplifyDevonzActions,
} from './utils';
import { createScopedLogger } from '~/utils/logger';
import { resolveModel } from './resolve-model';

// Common patterns to ignore, similar to .gitignore

const ig = ignore().add(IGNORE_PATTERNS);
const logger = createScopedLogger('select-context');

/**
 * In-memory cache for context selection keyed by a hash of the user's
 * last message + available file paths.  Prevents redundant LLM calls
 * when consecutive messages target the same set of files.
 */
const contextCache = new Map<string, { files: FileMap; timestamp: number }>();
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CONTEXT_CACHE_MAX_SIZE = 30;

export async function selectContext(props: {
  messages: Message[];
  env?: Env;
  apiKeys?: Record<string, string>;
  files: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  summary: string;
  onFinish?: (resp: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => void;
}) {
  const { messages, env: serverEnv, apiKeys, files, providerSettings, summary, onFinish } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, content };
    } else if (message.role === 'assistant') {
      let content = message.content;

      content = simplifyDevonzActions(content);

      content = content.replace(/<div class=\\"__devonzThought__\\">.*?<\/div>/s, '');
      content = content.replace(/<think>.*?<\/think>/s, '');

      return { ...message, content };
    }

    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const resolvedModel = await resolveModel({
    provider,
    currentModel,
    apiKeys,
    providerSettings,
    serverEnv,
    logger,
  });

  // Use resolved model name (may differ from requested if fallback occurred)
  currentModel = resolvedModel.name;

  const { codeContext } = extractCurrentContext(processedMessages);

  let filePaths = getFilePaths(files || {});
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  let context = '';
  const currentFiles: string[] = [];
  const contextFiles: FileMap = {};

  if (codeContext?.type === 'codeContext') {
    const codeContextFiles: string[] = codeContext.files;
    Object.keys(files || {}).forEach((path) => {
      let relativePath = path;

      if (path.startsWith('/home/project/')) {
        relativePath = path.replace('/home/project/', '');
      }

      if (codeContextFiles.includes(relativePath)) {
        contextFiles[relativePath] = files[path];
        currentFiles.push(relativePath);
      }
    });
    context = createFilesContext(contextFiles);
  }

  const summaryText = `Here is the summary of the chat till now: ${summary}`;

  const extractTextContent = (message: Message) =>
    Array.isArray(message.content)
      ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
      : message.content;

  const lastUserMessage = processedMessages.filter((x) => x.role === 'user').pop();

  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  // --- Hash-based cache: skip LLM call if same user message + same file list ---
  const cacheInput = extractTextContent(lastUserMessage) + '|' + filePaths.sort().join(',');
  const cacheKey = createHash('sha256').update(cacheInput).digest('hex');

  // Evict stale entries
  for (const [key, entry] of contextCache) {
    if (Date.now() - entry.timestamp > CONTEXT_CACHE_TTL_MS) {
      contextCache.delete(key);
    }
  }

  const cached = contextCache.get(cacheKey);

  if (cached) {
    logger.info(`Context cache HIT — skipping LLM call (hash: ${cacheKey.slice(0, 8)}…)`);

    return cached.files;
  }

  logger.info(`Context cache MISS — calling LLM (hash: ${cacheKey.slice(0, 8)}…)`);

  // select files from the list of code file from the project that might be useful for the current request from the user
  const resp = await generateText({
    system: `
        You are a software engineer. You are working on a project. You have access to the following files:

        AVAILABLE FILES PATHS
        ---
        ${filePaths.map((path) => `- ${path}`).join('\n')}
        ---

        You have following code loaded in the context buffer that you can refer to:

        CURRENT CONTEXT BUFFER
        ---
        ${context}
        ---

        Now, you are given a task. You need to select the files that are relevant to the task from the list of files above.

        RESPONSE FORMAT:
        your response should be in following format:
---
<updateContextBuffer>
    <includeFile path="path/to/file"/>
    <excludeFile path="path/to/file"/>
</updateContextBuffer>
---
        * Your should start with <updateContextBuffer> and end with </updateContextBuffer>.
        * You can include multiple <includeFile> and <excludeFile> tags in the response.
        * You should not include any other text in the response.
        * You should not include any file that is not in the list of files above.
        * You should not include any file that is already in the context buffer.
        * If no changes are needed, you can leave the response empty updateContextBuffer tag.
        `,
    prompt: `
        ${summaryText}

        Users Question: ${extractTextContent(lastUserMessage)}

        update the context buffer with the files that are relevant to the task from the list of files above.

        CRITICAL RULES:
        * Only include relevant files in the context buffer.
        * context buffer should not include any file that is not in the list of files above.
        * context buffer is extremely expensive, so only include files that are absolutely necessary.
        * If no changes are needed, you can leave the response empty updateContextBuffer tag.
        * Only 5 files can be placed in the context buffer at a time.
        * if the buffer is full, you need to exclude files that is not needed and include files that is relevent.

        `,
    model: provider.getModelInstance({
      model: currentModel,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
  });

  const response = resp.text;
  const updateContextBuffer = response.match(/<updateContextBuffer>([\s\S]*?)<\/updateContextBuffer>/);

  if (!updateContextBuffer) {
    throw new Error('Invalid response. Please follow the response format');
  }

  const includeFiles =
    updateContextBuffer[1]
      .match(/<includeFile path="(.*?)"/gm)
      ?.map((x) => x.replace('<includeFile path="', '').replace('"', '')) || [];
  const excludeFiles =
    updateContextBuffer[1]
      .match(/<excludeFile path="(.*?)"/gm)
      ?.map((x) => x.replace('<excludeFile path="', '').replace('"', '')) || [];

  const filteredFiles: FileMap = {};
  excludeFiles.forEach((path) => {
    delete contextFiles[path];
  });
  includeFiles.forEach((path) => {
    let fullPath = path;

    if (!path.startsWith('/home/project/')) {
      fullPath = `/home/project/${path}`;
    }

    if (!filePaths.includes(fullPath)) {
      logger.error(`File ${path} is not in the list of files above.`);
      return;
    }

    if (currentFiles.includes(path)) {
      return;
    }

    filteredFiles[path] = files[fullPath];
  });

  if (onFinish) {
    onFinish(resp);
  }

  // Merge surviving context files with newly included files
  const mergedFiles: FileMap = { ...contextFiles, ...filteredFiles };
  const totalFiles = Object.keys(mergedFiles).length;
  logger.info(
    `Total files: ${totalFiles} (${Object.keys(contextFiles).length} existing, ${Object.keys(filteredFiles).length} new)`,
  );

  if (totalFiles === 0) {
    logger.warn('No files selected for context — returning empty context');
  }

  // Store in cache (evict oldest if over cap)
  if (contextCache.size >= CONTEXT_CACHE_MAX_SIZE) {
    const oldestKey = contextCache.keys().next().value;

    if (oldestKey !== undefined) {
      contextCache.delete(oldestKey);
    }
  }

  contextCache.set(cacheKey, { files: mergedFiles, timestamp: Date.now() });

  return mergedFiles;

  // generateText({
}

export function getFilePaths(files: FileMap) {
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  return filePaths;
}
