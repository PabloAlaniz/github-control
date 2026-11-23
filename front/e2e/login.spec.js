import { test, expect } from '@playwright/test';

test.describe('login flow', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage to ensure clean state
        await page.goto('/login');
        await page.evaluate(() => localStorage.clear());
    });

    test('unauthenticated user is redirected to /login', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL(/\/login/);
    });

    test('login page renders form', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('input#username')).toBeVisible();
        await expect(page.locator('input#password')).toBeVisible();
        await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('shows error with wrong credentials', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#username', 'admin');
        await page.fill('#password', 'wrong-password');
        await page.click('button[type="submit"]');

        await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.bg-red-50')).toContainText(/invalid|failed/i);
    });

    test('successful login redirects to /', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#username', 'admin');
        await page.fill('#password', 'dev-password-123');
        await page.click('button[type="submit"]');

        await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
        await expect(page).toHaveURL('/');
    });

    test('logout returns to /login', async ({ page }) => {
        // Login first
        await page.goto('/login');
        await page.fill('#username', 'admin');
        await page.fill('#password', 'dev-password-123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL('/');

        // Click logout
        await page.getByRole('button', { name: /logout/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });

    test('authenticated user accessing /login is redirected to /', async ({ page }) => {
        // Login first
        await page.goto('/login');
        await page.fill('#username', 'admin');
        await page.fill('#password', 'dev-password-123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL('/');

        // Navigate back to /login
        await page.goto('/login');
        await expect(page).toHaveURL('/');
    });
});
