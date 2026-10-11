import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createVaultItem, deleteVaultItem, listVaultItems } from "@/lib/vault";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ items: await listVaultItems(session.id) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    label?: string;
    username?: string;
    origin?: string;
    secret?: string;
  };
  if (!body.label?.trim() || !body.secret?.trim()) {
    return NextResponse.json(
      { error: "label and secret required" },
      { status: 400 },
    );
  }
  const item = await createVaultItem({
    ownerUserId: session.id,
    label: body.label,
    username: body.username,
    origin: body.origin,
    secret: body.secret,
  });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const ok = await deleteVaultItem(session.id, id);
  return NextResponse.json({ ok });
}
