import { atom } from 'nanostores';

export interface DeploymentState {
  state: 'idle' | 'uploading' | 'building' | 'ready' | 'error';
  url?: string;
  errorMessage?: string;
}

const INITIAL_STATE: DeploymentState = { state: 'idle' };

export const deploymentStatus = atom<DeploymentState>(INITIAL_STATE);

export function startDeployment() {
  deploymentStatus.set({ state: 'uploading' });
}

export function resetDeployment() {
  deploymentStatus.set(INITIAL_STATE);
}

export function updateDeploymentState(update: Partial<DeploymentState>) {
  const current = deploymentStatus.get();
  deploymentStatus.set({ ...current, ...update });
}
