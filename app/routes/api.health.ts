import { type LoaderFunctionArgs } from 'react-router';
import { withSecurity } from '~/lib/security';

async function healthLoader({ request: _request }: LoaderFunctionArgs) {
  return Response.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}

export const loader = withSecurity(healthLoader, {
  rateLimit: false,
});
