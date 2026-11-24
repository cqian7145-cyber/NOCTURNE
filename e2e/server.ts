import { preview } from 'vite';

export default async function startPreview() {
  const server = await preview({
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  });
  return () => server.close();
}
