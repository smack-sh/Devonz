import { test, expect } from '@playwright/test';

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

/** Mock configured providers. */
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

test.describe('Settings flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockModels(page);
    await mockProviderModels(page);
    await mockConfiguredProviders(page);
    await mockEnvKeyChecks(page);
  });

  test('opens settings panel and navigates to Cloud Providers tab', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to finish loading
    const chatInput = page.getByLabel('Chat message input');
    await expect(chatInput).toBeVisible({ timeout: 15_000 });

    // Open the sidebar
    const sidebarToggle = page.getByLabel('Open sidebar');
    await sidebarToggle.click();

    // Click the settings button (data-testid="settings-button")
    const settingsButton = page.getByTestId('settings-button');
    await expect(settingsButton).toBeVisible({ timeout: 5_000 });
    await settingsButton.click();

    // Verify the settings panel opened — it contains a heading "Settings"
    const settingsHeading = page.getByRole('heading', { name: 'Settings' }).first();
    await expect(settingsHeading).toBeVisible({ timeout: 5_000 });

    // Navigate to the Cloud Providers tab
    const cloudProvidersTab = page.getByRole('tab', { name: 'Cloud Providers' });
    await cloudProvidersTab.click();

    // Verify the Cloud Providers content is visible
    await expect(page.getByText('Cloud Providers').first()).toBeVisible();
  });

  test('enters API key in Cloud Providers and verifies encryption endpoint is called', async ({ page }) => {
    // Track calls to the encrypt endpoint
    let encryptCalled = false;

    await page.route('**/api/encrypt', (route) => {
      encryptCalled = true;

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ encrypted: 'enc:mock-encrypted-value' }),
      });
    });

    await page.goto('/');

    const chatInput = page.getByLabel('Chat message input');
    await expect(chatInput).toBeVisible({ timeout: 15_000 });

    // Open sidebar → Settings → Cloud Providers
    await page.getByLabel('Open sidebar').click();

    const settingsButton = page.getByTestId('settings-button');
    await expect(settingsButton).toBeVisible({ timeout: 5_000 });
    await settingsButton.click();

    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible({ timeout: 5_000 });

    const cloudProvidersTab = page.getByRole('tab', { name: 'Cloud Providers' });
    await cloudProvidersTab.click();

    // Find the first API key input (placeholder pattern: "Enter … API key")
    const apiKeyInput = page.getByPlaceholder(/Enter .+ API key/).first();
    await expect(apiKeyInput).toBeVisible({ timeout: 5_000 });

    // Type a test API key and press Enter to trigger save → encrypt flow
    await apiKeyInput.fill('sk-test-key-12345');
    await apiKeyInput.press('Enter');

    // Wait for the encrypt endpoint to be called
    await expect.poll(() => encryptCalled, { timeout: 5_000 }).toBe(true);
  });
});
