// Test helper (not a test): a Node module hook that lets browser modules written for Vite load in plain Node.
// It rewrites `import.meta.env` to an empty object (so Supabase and Turnstile read as "not configured") in files under src/.
// Use it before importing such a module:  register('./vite-env-hook.mjs', import.meta.url);
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes('/src/') && result.format === 'module' && result.source) {
    const source = String(result.source).replace(/import\.meta\.env/g, '({})');
    return { ...result, source };
  }
  return result;
}
