import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL;
  const ENGRAM_ENABLED = process.env.ENGRAM_ENABLED === 'true';

  if (!AI_GATEWAY_URL) {
    return res.status(500).json({ error: 'AI_GATEWAY_URL is not configured' });
  }

  if (!ENGRAM_ENABLED) {
    return res.status(403).json({ error: 'Engram mode is disabled' });
  }

  try {
    const response = await fetch(`${AI_GATEWAY_URL}/api/deploy${req.url?.replace('/api/deploy', '')}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        // Forward relevant headers if needed
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Error proxying to AI Gateway:', error);
    return res.status(500).json({ error: 'Failed to connect to AI Gateway' });
  }
}
