export interface VercelUserResponse {
  user?: {
    id: string;
    username: string;
    email: string;
    name: string;
    avatar?: string;
  };
  id?: string;
  username?: string;
  email?: string;
  name?: string;
  avatar?: string;
}

export interface VercelUser {
  id: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
  user?: {
    id: string;
    username: string;
    email: string;
    name: string;
    avatar?: string;
  };
}

export interface VercelProject {
  createdAt: string | number | Date;
  targets?: {
    production?: {
      alias?: string[];
    };
  };
  id: string;
  name: string;
  framework?: string;
  latestDeployments?: Array<{
    id: string;
    url: string;
    created: number;
    state: 'READY' | 'ERROR' | 'BUILDING' | 'CANCELED';
  }>;
}

export interface VercelStats {
  projects: VercelProject[];
  totalProjects: number;
}

export interface VercelConnection {
  user: VercelUser | null;
  token: string;
  stats?: VercelStats;
}

export interface VercelProjectInfo {
  id: string;
  name: string;
  url: string;
  chatId: string;
}

export interface VercelDeployment {
  id: string;
  url?: string;
  state?: string;
  readyState?: string;
  name?: string;
  created?: number;
}

export interface VercelApiError {
  error?: { message: string; code?: string };
}

export interface VercelDeploymentConfig {
  name: string;
  project: string;
  target: string;
  files: Array<{ file: string; data: string }>;
  buildCommand?: string;
  outputDirectory?: string;
  routes?: Array<{ src: string; dest: string }>;
}
