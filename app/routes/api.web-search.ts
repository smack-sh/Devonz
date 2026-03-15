import type { ActionFunctionArgs } from 'react-router';
import { withSecurity } from '~/lib/security';
import { isAllowedUrl } from '~/utils/url';
import { ApiError, handleApiError } from '~/lib/api/apiUtils';

const MAX_CONTENT_LENGTH = 8000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB cap on raw response body

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);

  if (match) {
    return match[1].trim();
  }

  // Try reverse attribute order
  const altMatch = html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);

  return altMatch ? altMatch[1].trim() : '';
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function webSearchAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  return handleApiError(
    'WebSearch',
    async () => {
      const { url } = (await request.json()) as { url?: string };

      if (!url || typeof url !== 'string') {
        return Response.json({ error: 'URL is required' }, { status: 400 });
      }

      if (!isAllowedUrl(url)) {
        return Response.json(
          { error: 'URL is not allowed. Only public HTTP/HTTPS URLs are accepted.' },
          { status: 400 },
        );
      }

      let response: Response;

      try {
        response = await fetch(url, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new ApiError('Request timed out after 10 seconds', 504);
        }

        throw error;
      }

      if (!response.ok) {
        return Response.json(
          { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
          { status: 502 },
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return Response.json({ error: 'URL must point to an HTML or text page' }, { status: 400 });
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      if (contentLength > MAX_RESPONSE_SIZE) {
        return Response.json(
          { error: `Response too large (${contentLength} bytes). Maximum is ${MAX_RESPONSE_SIZE}.` },
          { status: 413 },
        );
      }

      const html = await response.text();

      if (html.length > MAX_RESPONSE_SIZE) {
        return Response.json({ error: 'Response body exceeds maximum allowed size.' }, { status: 413 });
      }

      const title = extractTitle(html);
      const description = extractMetaDescription(html);
      const content = extractTextContent(html);

      return Response.json({
        success: true,
        data: {
          title,
          description,
          content: content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) + '...' : content,
          sourceUrl: url,
        },
      });
    },
    'Failed to fetch URL',
  );
}

export const action = withSecurity(webSearchAction);
