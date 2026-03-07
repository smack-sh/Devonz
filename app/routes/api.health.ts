import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { withSecurity } from '~/lib/security';

async function healthLoader({ request: _request }: LoaderFunctionArgs) {
  return json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}

export const loader = withSecurity(healthLoader, {
  rateLimit: false,
});
