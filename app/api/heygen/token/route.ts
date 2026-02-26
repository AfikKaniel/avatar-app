import { NextResponse } from "next/server";

/**
 * POST /api/heygen/token
 *
 * Creates a short-lived HeyGen streaming session token.
 * The API key never leaves the server — the frontend only gets the token.
 */
export async function POST() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "HEYGEN_API_KEY not set" }, { status: 500 });
  }

  const res = await fetch("https://api.heygen.com/v1/streaming.create_token", {
    method: "POST",
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: body }, { status: res.status });
  }

  const data = await res.json();
  // data.data.token is the short-lived token
  return NextResponse.json({ token: data.data.token });
}
