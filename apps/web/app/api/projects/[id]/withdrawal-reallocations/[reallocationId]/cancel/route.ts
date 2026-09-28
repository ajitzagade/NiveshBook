import { NextResponse, type NextRequest } from "next/server";
import {
  getSession,
  authorizeScope,
  WithdrawalReallocationNotFoundError,
  WithdrawalReallocationAlreadyCancelledError,
  WithdrawalReallocationAlreadyConsumedError,
} from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort, createWithdrawalReallocationPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../../../shared";
import { isValidReallocationId, reallocationNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string; reallocationId: string }>;
}

/**
 * Cancels (reverses) a previously recorded withdrawal-reallocation decline
 * -- Owner/Admin-only, no self-access (mirrors the create route's identical
 * shape), gated by `authorizeScope()` for `"withdrawal_reallocations:cancel"`,
 * checked before any DB read.
 *
 * `WithdrawalReallocationPort.cancel` itself enforces the only real
 * precondition: every allocation leg must still be fully unconsumed (409
 * `already_consumed` otherwise) -- undoing a decline once a recipient has
 * already drawn on it would silently claw back money they were already
 * allowed to withdraw against.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const userPort = createUserPort();
  const { allowed } = await authorizeScope(session.userId, "withdrawal_reallocations:cancel", {
    users: userPort,
  });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId, reallocationId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  if (!isValidReallocationId(reallocationId)) {
    return reallocationNotFoundResponse();
  }

  const reallocationPort = createWithdrawalReallocationPort();
  const existing = await reallocationPort.findById(reallocationId);
  if (!existing || existing.projectId !== projectId) {
    return reallocationNotFoundResponse();
  }

  try {
    const cancelled = await reallocationPort.cancel(reallocationId, session.userId);
    return NextResponse.json({ reallocation: cancelled }, { status: 200 });
  } catch (error) {
    if (error instanceof WithdrawalReallocationNotFoundError) {
      // Defense in depth only -- existence was already confirmed above.
      return reallocationNotFoundResponse();
    }
    if (error instanceof WithdrawalReallocationAlreadyCancelledError) {
      return NextResponse.json(
        { code: "already_cancelled", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof WithdrawalReallocationAlreadyConsumedError) {
      return NextResponse.json(
        { code: "already_consumed", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}
