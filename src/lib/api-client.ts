import { supabase } from "@/integrations/supabase/client";

const IS_ENGRAM_PREVIEW = typeof window !== 'undefined' && 
  (window.location.hostname.endsWith('engram-golden-paths.vercel.app') || 
   window.location.hostname.includes('engram-logic'));

export async function invokeFunction(functionName: string, options: { body?: any } = {}) {
  if (IS_ENGRAM_PREVIEW) {
    try {
      const response = await fetch(`/api/deploy/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body || {}),
      });

      if (response.ok) {
        const data = await response.json();
        return { data, error: null };
      }

      const err = await response.json();
      console.warn(`Engram proxy for ${functionName} failed, falling back to Supabase:`, err.error || response.statusText);
    } catch (e) {
      console.warn(`Engram proxy for ${functionName} error, falling back to Supabase:`, e);
    }
  }

  return await supabase.functions.invoke(functionName, options);
}
