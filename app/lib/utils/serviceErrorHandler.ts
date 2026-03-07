export interface ServiceError {
  code?: string;
  message: string;
  details?: Record<string, unknown>;
  service: string;
  operation: string;
}
