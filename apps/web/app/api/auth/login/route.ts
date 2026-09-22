import { NextResponse, type NextRequest } from "next/server";
import { login } from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { setSessionCookie } from "@/lib/session";

const INVALID_CREDENTIALS_MESSAGE = "Incorrect email or password";
const INACTIVE_ACCOUNT_MESSAGE = "This account is inactive";

interface LoginRequestBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { code: "invalid_request", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Empty credentials fold into the same identical-message bucket as any
  // other bad-credentials case — never a distinct "field required" error.
  if (!email || !password) {
    return NextResponse.json(
      { code: "invalid_credentials", message: INVALID_CREDENTIALS_MESSAGE },
      { status: 401 },
    );
  }

  let result;
  try {
    result = await login(email, password, {
      users: createUserPort(),
      sessions: createSessionPort(),
    });
  } catch {
    return NextResponse.json(
      { code: "internal_error", message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  if (!result.ok) {
    const message =
      result.error === "inactive_account" ? INACTIVE_ACCOUNT_MESSAGE : INVALID_CREDENTIALS_MESSAGE;
    return NextResponse.json({ code: result.error, message }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, result.token);
  return response;
}
