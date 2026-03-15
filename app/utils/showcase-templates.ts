import type { ShowcaseTemplate, TemplateCategory } from '~/types/showcase-template';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ShowcaseTemplates');

const VALID_CATEGORIES = new Set<string>(['landing-page', 'portfolio', 'online-store', 'dashboard', 'saas', 'ai-app']);

function isValidTemplate(item: unknown): item is ShowcaseTemplate {
  if (typeof item !== 'object' || item === null) {
    return false;
  }

  const obj = item as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.name === 'string' &&
    obj.name.length > 0 &&
    typeof obj.description === 'string' &&
    typeof obj.category === 'string' &&
    VALID_CATEGORIES.has(obj.category) &&
    typeof obj.githubRepo === 'string' &&
    obj.githubRepo.length > 0 &&
    typeof obj.icon === 'string' &&
    Array.isArray(obj.tags) &&
    obj.tags.every((tag: unknown) => typeof tag === 'string')
  );
}

function validateTemplates(data: unknown): ShowcaseTemplate[] {
  if (!Array.isArray(data)) {
    logger.error('templates.json: expected an array, got', typeof data);
    return [];
  }

  const valid: ShowcaseTemplate[] = [];

  for (const item of data) {
    if (isValidTemplate(item)) {
      valid.push({
        ...item,
        category: item.category as TemplateCategory,
        vercelUrl: typeof item.vercelUrl === 'string' ? item.vercelUrl : '',
        screenshotUrl: typeof item.screenshotUrl === 'string' ? item.screenshotUrl : undefined,
      });
    } else {
      logger.warn('Skipping invalid template entry:', item);
    }
  }

  return valid;
}

let _cachedTemplates: ShowcaseTemplate[] | null = null;

export async function loadShowcaseTemplates(): Promise<ShowcaseTemplate[]> {
  if (_cachedTemplates) {
    return _cachedTemplates;
  }

  try {
    const response = await fetch('/templates.json');

    if (!response.ok) {
      logger.error('Failed to load templates.json:', response.status);
      return [];
    }

    const data: unknown = await response.json();
    const templates = validateTemplates(data);

    _cachedTemplates = templates;

    return templates;
  } catch (error) {
    logger.error('Error loading showcase templates:', error);
    return [];
  }
}
