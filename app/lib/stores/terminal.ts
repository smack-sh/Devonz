import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newDevonzShellProcess, newShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('TerminalStore');

export class TerminalStore {
  #webcontainer: Promise<WebContainer>;
  #terminals: Array<{ terminal: ITerminal; process: WebContainerProcess }> = [];
  #devonzTerminal = newDevonzShellProcess();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }
  get devonzTerminal() {
    return this.#devonzTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }
  async attachDevonzTerminal(terminal: ITerminal) {
    try {
      const wc = await this.#webcontainer;

      if (!wc) {
        terminal.write(coloredText.red('WebContainer not available\n'));

        return;
      }

      await this.#devonzTerminal.init(wc, terminal);
    } catch (error: unknown) {
      terminal.write(
        coloredText.red('Failed to spawn devonz shell\n\n') + (error instanceof Error ? error.message : String(error)),
      );
      return;
    }
  }

  async attachTerminal(terminal: ITerminal) {
    try {
      const wc = await this.#webcontainer;

      if (!wc) {
        terminal.write(coloredText.red('WebContainer not available\n'));

        return;
      }

      const shellProcess = await newShellProcess(wc, terminal);
      this.#terminals.push({ terminal, process: shellProcess });
    } catch (error: unknown) {
      terminal.write(
        coloredText.red('Failed to spawn shell\n\n') + (error instanceof Error ? error.message : String(error)),
      );
      return;
    }
  }

  onTerminalResize(cols: number, rows: number) {
    for (const { process } of this.#terminals) {
      process.resize({ cols, rows });
    }
  }

  async detachTerminal(terminal: ITerminal) {
    const terminalIndex = this.#terminals.findIndex((t) => t.terminal === terminal);

    if (terminalIndex !== -1) {
      const { process } = this.#terminals[terminalIndex];

      try {
        process.kill();
      } catch (error) {
        logger.warn('Failed to kill terminal process:', error);
      }
      this.#terminals.splice(terminalIndex, 1);
    }
  }
}
