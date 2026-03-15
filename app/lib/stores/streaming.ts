import { atom } from 'nanostores';
import type { StreamingEvent } from '~/types/streaming-events';

export const streamingState = atom<boolean>(false);

/** Whether the server is sending structured streaming events (vs. raw text). */
export const structuredStreamingActive = atom<boolean>(false);

/** Current high-level processing phase reported by the server (e.g. 'planning', 'coding'). */
export const streamingPhase = atom<string>('');

/**
 * Holds a reference to the message parser's processStructuredEvent method.
 * Set by useMessageParser on init; read by WorkbenchStore.processDataStreamItems
 * to forward validated streaming events to the parser for Action creation.
 * Using a nanostore atom avoids circular imports between workbench ↔ parser.
 */
export const structuredEventProcessor = atom<((event: StreamingEvent) => void) | null>(null);
