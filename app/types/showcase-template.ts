export type TemplateCategory = 'landing-page' | 'portfolio' | 'online-store' | 'dashboard' | 'saas' | 'ai-app';

export interface ShowcaseTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  vercelUrl: string;
  githubRepo: string;
  screenshotUrl?: string;
  tags: string[];
  icon: string;
}

export interface TemplateCategoryInfo {
  id: TemplateCategory | 'all';
  label: string;
  description: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategoryInfo[] = [
  { id: 'all', label: 'All', description: 'Browse all templates' },
  { id: 'landing-page', label: 'Landing Pages', description: 'Marketing sites and promotional pages' },
  { id: 'portfolio', label: 'Portfolio', description: 'Personal and agency portfolio sites' },
  { id: 'online-store', label: 'Online Store', description: 'E-commerce and product pages' },
  { id: 'dashboard', label: 'Dashboard', description: 'Admin panels and analytics dashboards' },
  { id: 'saas', label: 'SaaS', description: 'Software as a service applications' },
  { id: 'ai-app', label: 'AI Apps', description: 'AI-powered tools and applications' },
];

export const CATEGORY_COLORS: Record<string, string> = {
  'landing-page': 'text-cyan-400',
  portfolio: 'text-indigo-400',
  'online-store': 'text-green-400',
  dashboard: 'text-orange-400',
  saas: 'text-purple-400',
  'ai-app': 'text-pink-400',
};

export const CATEGORY_LABELS: Record<string, string> = {
  'landing-page': 'Landing Page',
  portfolio: 'Portfolio',
  'online-store': 'Online Store',
  dashboard: 'Dashboard',
  saas: 'SaaS',
  'ai-app': 'AI App',
};
