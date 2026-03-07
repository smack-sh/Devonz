import { useState, useCallback } from 'react';
import type { ConnectionTestResult } from '~/components/@settings/shared/service-integration';

interface UseConnectionTestOptions {
  testEndpoint: string;
  serviceName: string;
  getUserIdentifier?: (data: unknown) => string;

  /** Optional function to get the current auth token */
  getToken?: () => string | null;
}

export function useConnectionTest({
  testEndpoint,
  serviceName,
  getUserIdentifier,
  getToken,
}: UseConnectionTestOptions) {
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const testConnection = useCallback(async () => {
    setTestResult({
      status: 'testing',
      message: 'Testing connection...',
    });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Authorization header if token is available
      const token = getToken?.();

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(testEndpoint, {
        method: 'GET',
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        const userIdentifier = getUserIdentifier ? getUserIdentifier(data) : 'User';

        setTestResult({
          status: 'success',
          message: `Connected successfully to ${serviceName} as ${userIdentifier}`,
          timestamp: Date.now(),
        });
      } else {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        setTestResult({
          status: 'error',
          message: `Connection failed: ${errorData.error || `${response.status} ${response.statusText}`}`,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      setTestResult({
        status: 'error',
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      });
    }
  }, [testEndpoint, serviceName, getUserIdentifier, getToken]);

  const clearTestResult = useCallback(() => {
    setTestResult(null);
  }, []);

  return {
    testResult,
    testConnection,
    clearTestResult,
    isTestingConnection: testResult?.status === 'testing',
  };
}
