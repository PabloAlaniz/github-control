import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    // Note: Adjust the expected title based on actual app title
    await expect(page).toHaveTitle(/GitHub/);
});

test('health check via UI or API', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toEqual(expect.objectContaining({ status: 'ok' }));
});
