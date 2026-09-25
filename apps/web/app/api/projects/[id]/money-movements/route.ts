import { NextResponse, type NextRequest } from "next/server";
import { getSession, authorizeScope } from "@niveshbook/core";
import { createSessionPort, createUserPort, createProjectPort, createMoneyMovementPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { UNAUTHENTICATED_MESSAGE, FORBIDDEN_MESSAGE } from "@/lib/users";
import { isValidProjectId, projectNotFoundResponse } from "../../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Lists every money movement landing at one Project (Story 4.8, FR28) --
 * drives the Add Money page's "Moved from Project A" indicator (this story's
 * Code Map). Owner/Admin-only, mirroring `investment_transactions:list`'s/
 * `withdrawal_transactions:list`'s identical precedent -- listing is
 * oversight/enrichment functionality, and the whole Add Money page this
 * supports is already Owner/Admin-only itself, so this introduces no new
 * privacy surface. Gated by `authorizeScope()` for `"money_movements:list"`
 * with no `scopeOwnerIds`, mirroring `withdrawal-transactions/route.ts`'s
 * `GET` ordering: authorization is checked before any DB read, then project
 * existence.
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
  const { allowed } = await authorizeScope(session.userId, "money_movements:list", { users: userPort });

  if (!allowed) {
    return NextResponse.json({ code: "forbidden", message: FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { id: projectId } = await params;

  if (!isValidProjectId(projectId)) {
    return projectNotFoundResponse();
  }

  const projectPort = createProjectPort();
  if (!(await projectPort.findProjectById(projectId))) {
    return projectNotFoundResponse();
  }

  const moneyMovementPort = createMoneyMovementPort();
  const moneyMovements = await moneyMovementPort.listByDestinationProjectId(projectId);

  return NextResponse.json({ moneyMovements });
}
