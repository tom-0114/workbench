// Standalone review preview. Does not occupy the real backend's port 3002.
process.env.WORKBENCH_UI_FIXTURE_PORT = '3012';
await import('./ui-fixture.mjs');
const { createServer } = await import('vite');
const server = await createServer({
  server: {
    host: '127.0.0.1', port: 5186, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3012' },
    watch: { ignored: ['**/docs/ui-redesign/**', '**/tests/**'] },
  },
});
await server.listen();
console.log('Workbench UI preview (isolated fixture data): http://127.0.0.1:5186');
