import { NextResponse } from "next/server";

import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
} from "@/lib/memory";
import { getSession } from "@/lib/session";
import type { MemoryKind } from "@/lib/types";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ memories: await listMemories(session.id) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    kind?: MemoryKind;
    title?: string;
    content?: string;
    pinned?: boolean;
  };
  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }
  const memory = await createMemory({
    ownerUserId: session.id,
    kind: body.kind || "note",
    title: body.title,
    content: body.content,
    pinned: body.pinned,
  });
  return NextResponse.json({ memory });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    id?: string;
    kind?: MemoryKind;
    title?: string;
    content?: string;
    pinned?: boolean;
  };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const memory = await updateMemory(session.id, body.id, body);
  if (!memory) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ memory });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const ok = await deleteMemory(session.id, id);
  return NextResponse.json({ ok });
}
