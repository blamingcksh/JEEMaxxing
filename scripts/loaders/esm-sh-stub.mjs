// ESM loader hook: leaderboard.js statically imports supabase from
// https://esm.sh, which Node's default loader can't fetch. Short-circuit any
// https://esm.sh/ specifier with a tiny local stub so tests can import the
// real modules in plain Node.
export function resolve(specifier, context, nextResolve) {
  if (typeof specifier === 'string' && specifier.startsWith('https://esm.sh/')) {
    const stub = [
      'export const createClient = () => ({',
      '  auth: { getUser: async () => ({ data: null, error: null }) },',
      '  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => null }), order: () => ({ limit: () => ({ data: [] }) }) }) })',
      '});',
    ].join('\n');
    return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
