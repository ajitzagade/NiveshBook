import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  createProject,
  InvalidProjectNameError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { INVALID_REQUEST_MESSAGE, isValidProjectBody } from "./shared";

/** Owner/Admin-only Projects list (AD-1) — proves `authorizeScope()` for a second resource beyond the user directory. */
export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "projects:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const projectPort = createProjectPort();
  const allProjects = await projectPort.listProjects();
  return NextResponse.json(allProjects);
}

/**
 * Creates a Project with just a name and description — no partner
 * information is required to save (this story's core rule). Gated by
 * `authorizeScope()` for `"projects:create"` (Owner/Admin-only), checked
 * immediately after the session check and before the body is parsed/
 * validated — so a non-Owner/Admin always gets a uniform 403, never a 400
 * from a malformed body leaking ahead of the authorization check. Empty/
 * whitespace-only names are rejected by `packages/core`'s `createProject`,
 * surfaced here as a 400 `validation_error`.
 */
export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "projects:create", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  if (!isValidProjectBody(body)) {
    return NextResponse.json(
      { code: "invalid_request", message: INVALID_REQUEST_MESSAGE },
      { status: 400 },
    );
  }

  const projectPort = createProjectPort();
  try {
    const project = await createProject(
      { name: body.name, description: body.description ?? null },
      { projects: projectPort },
    );
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidProjectNameError) {
      return NextResponse.json(
        { code: "validation_error", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
