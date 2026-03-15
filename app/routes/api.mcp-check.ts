import { MCPService } from '~/lib/services/mcpService';
import { handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function mcpCheckLoader() {
  return handleApiError(
    'api.mcp-check',
    async () => {
      const mcpService = MCPService.getInstance();
      const serverTools = await mcpService.checkServersAvailabilities();

      return Response.json(serverTools);
    },
    'Failed to check MCP servers',
  );
}

export const loader = withSecurity(mcpCheckLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
