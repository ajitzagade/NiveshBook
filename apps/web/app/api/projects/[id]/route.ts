import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  updateProject,
  InvalidProjectNameError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import {
  INVALID_REQUEST_MESSAGE,
  isValidProjectBody,
  isValidProjectId,
  projectNotFoundResponse,
} from "../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Single-Project view — not itemized separately in spec-2-1's Code Map, but
 * needed by the edit page to pre-fill the form, and mirrors
 * `apps/web/app/api/users/[id]/route.ts`'s GET+PATCH pairing. Gated by
 * `authorizeScope()` for `"projects:list"` — spec-2-1's Decisions cap the
 * action set at exactly `projects:create`/`projects:update`/`projects:list`
 * (no Project-shaped `ResourceRef`/per-resource view action yet), so a
 * single-project read reuses the list-tier gate rather than introducing a
 * fourth action.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
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

  const { id } = await params;

  if (!isValidProjectId(id)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  const project = await projectPort.findProjectById(id);

  if (!project) {
    return projectNotFoundResponse();
  }

  return NextResponse.json(project);
}

/**
 * Edits an existing Project's name/description, gated by `authorizeScope()`
 * for `"projects:update"` (Owner/Admin-only — no Project-shaped
 * `ResourceRef` yet, per spec-2-1's Decisions). `authorizeScope()` runs
 * immediately after the session check, before the body is parsed/validated
 * or `id` is checked — so a non-Owner/Admin always gets the same uniform
 * 403, regardless of whether the body is malformed or `id` is well-formed
 * or exists; neither the body shape nor a project's existence ever leaks to
 * an unauthorized caller. A non-UUID `id` is treated identically to an
 * unknown one (404, not 400) — matching `apps/web/lib/ids.ts`'s
 * malformed-id-looks-like-404 convention.
 *
 * `description` is only overwritten when the request body explicitly
 * includes the key (even as `null`, to intentionally clear it) — omitting
 * the key leaves the existing description untouched (`packages/core`'s
 * `updateProject`).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "projects:update", { users: userPort });

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

  const { id } = await params;

  if (!isValidProjectId(id)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  try {
    const updated = await updateProject(
      id,
      { name: body.name, description: body.description },
      { projects: projectPort },
    );

    if (!updated) {
      return projectNotFoundResponse();
    }

    return NextResponse.json(updated);
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
