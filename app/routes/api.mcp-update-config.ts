import { type ActionFunctionArgs, json } from '@remix-run/node';
import { MCPService, type MCPConfig } from '~/lib/services/mcpService';
import { handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function mcpUpdateConfigAction({ request }: ActionFunctionArgs) {
  return handleApiError(
    'api.mcp-update-config',
    async () => {
      const mcpConfig = (await request.json()) as MCPConfig;

      if (!mcpConfig || typeof mcpConfig !== 'object') {
        return json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
      }

      const mcpService = MCPService.getInstance();
      const serverTools = await mcpService.updateConfig(mcpConfig);

      return json(serverTools);
    },
    'Failed to update MCP config',
  );
}

export const action = withSecurity(mcpUpdateConfigAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
