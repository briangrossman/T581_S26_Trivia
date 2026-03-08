import { NextRequest, NextResponse } from 'next/server';
import { getGameByCode, getStudentByGameAndUsername, sql } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { code, username } = await request.json();

    if (!code || !username) {
      return NextResponse.json({ error: 'Game code and username are required' }, { status: 400 });
    }

    const trimmedCode = String(code).trim().toUpperCase();
    const trimmedUsername = String(username).trim();

    if (trimmedCode.length !== 6) {
      return NextResponse.json({ error: 'Game code must be 6 characters' }, { status: 400 });
    }

    if (trimmedUsername.length < 1 || trimmedUsername.length > 50) {
      return NextResponse.json({ error: 'Username must be 1–50 characters' }, { status: 400 });
    }

    const game = await getGameByCode(trimmedCode);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status === 'finished') {
      return NextResponse.json({ error: 'This game has already ended' }, { status: 409 });
    }

    // Check if username is already taken in this game
    const existing = await getStudentByGameAndUsername(game.id, trimmedUsername);
    if (existing) {
      return NextResponse.json({ error: 'Username already taken in this game' }, { status: 409 });
    }

    const result = await sql`
      INSERT INTO students (game_id, username)
      VALUES (${game.id}, ${trimmedUsername})
      RETURNING *
    `;

    return NextResponse.json({ student: result.rows[0], game }, { status: 201 });
  } catch (err: unknown) {
    // Postgres unique constraint violation
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      return NextResponse.json({ error: 'Username already taken in this game' }, { status: 409 });
    }
    console.error('POST /api/join error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
