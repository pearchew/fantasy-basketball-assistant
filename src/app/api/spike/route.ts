import { runSpike } from "@/lib/spike";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.SPIKE_SECRET;
  if (!secret) return Response.json({ error: "SPIKE_SECRET is not set" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await runSpike());
}
