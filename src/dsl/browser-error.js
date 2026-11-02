export function checkBrowserError(error) {
  if (error && typeof error.message === 'string') {
    if (error.message.includes("Executable doesn't exist") || error.message.includes('playwright install')) {
      const friendly = new Error(
        'Playwright browsers are missing or out of date. Run "npm run browsers:install" (or "npx playwright install chromium") to install them.'
      );
      friendly.cause = error;
      return friendly;
    }
  }
  return error;
}
