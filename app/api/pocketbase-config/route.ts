export function GET() {
  const url = process.env.POCKETBASE_URL ?? "https://pb.raulzarza.com";

  return Response.json({
    configured: Boolean(url),
    url,
  });
}
