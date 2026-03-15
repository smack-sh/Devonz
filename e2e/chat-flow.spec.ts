import { test, expect } from '@playwright/test';

/**
 * Mock the Vercel AI SDK data-stream response for POST /api/chat.
 *
 * Protocol format (v4):
 *   0:"text chunk"\n   — text delta
 *   d:{...}\n           — finish message
 */
function mockChatSSE(page: import('@playwright/test').Page) {
  return page.route('**/api/chat', (route) => {
    const body = [
      '0:"Hello"\n',
      '0:" from"\n',
      '0:" the"\n',
      '0:" mocked"\n',
      '0:" assistant!"\n',
      'd:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}\n',
    ].join('');

    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
      },
      body,
    });
  });
}

/** Mock the model list so the app doesn't call real provider APIs on load. */
function mockModels(page: import('@playwright/test').Page) {
  return page.route('**/api/models', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        modelList: [
          {
            name: 'test-model',
            label: 'Test Model',
            provider: 'OpenAI',
            maxTokenAllowed: 4096,
          },
        ],
      }),
    });
  });
}

/** Mock provider-scoped model fetch. */
function mockProviderModels(page: import('@playwright/test').Page) {
  return page.route('**/api/models/*', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ modelList: [] }),
    });
  });
}

/** Mock configured providers (prevents real server check). */
function mockConfiguredProviders(page: import('@playwright/test').Page) {
  return page.route('**/api/configured-providers', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

/** Mock env-key check endpoints. */
function mockEnvKeyChecks(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/check-env-key*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasKey: false }),
      });
    }),
    page.route('**/api/check-env-keys*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          OpenAI: { hasEnvKey: true, hasCookieKey: false },
        }),
      });
    }),
  ]);
}

test.describe('Chat flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockModels(page);
    await mockProviderModels(page);
    await mockConfiguredProviders(page);
    await mockEnvKeyChecks(page);
  });

  test('loads app and verifies the chat page renders', async ({ page }) => {
    await page.goto('/');

    // The page title should contain "Devonz"
    await expect(page).toHaveTitle(/Devonz/);

    // The chat input textarea should be visible
    const chatInput = page.getByLabel('Chat message input');
    await expect(chatInput).toBeVisible({ timeout: 15_000 });
  });

  test('sends a message and verifies mocked assistant response appears', async ({ page }) => {
    await mockChatSSE(page);
    await page.goto('/');

    const chatInput = page.getByLabel('Chat message input');
    await expect(chatInput).toBeVisible({ timeout: 15_000 });

    // Type a message into the chat textarea
    await chatInput.fill('What is 2 + 2?');

    // Click the send button
    const sendButton = page.getByLabel('Send message');
    await sendButton.click();

    // Verify the mocked assistant response appears on the page
    await expect(page.getByText('Hello from the mocked assistant!')).toBeVisible({ timeout: 10_000 });
  });
});
