export function GET() {
  const url = process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

  return Response.json({
    configured: Boolean(url && anonKey),
    url,
    anonKey,
  });
}
