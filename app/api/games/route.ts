import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getTeacherGames, sql } from '@/lib/db';

const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit O,0,I,1 for readability

function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
  }
  return code;
}

export async function GET() {
  const teacher = await getTeacherFromCookies();
  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const games = await getTeacherGames(teacher.teacherId);
    return NextResponse.json({ games });
  } catch (err) {
    console.error('GET /api/games error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(_request: NextRequest) {
  const teacher = await getTeacherFromCookies();
  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Generate a unique join code with collision retry
    let joinCode: string = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateJoinCode();
      const existing = await sql`SELECT id FROM games WHERE join_code = ${candidate}`;
      if (existing.rows.length === 0) {
        joinCode = candidate;
        break;
      }
    }

    if (!joinCode) {
      return NextResponse.json({ error: 'Could not generate unique code' }, { status: 500 });
    }

    const result = await sql`
      INSERT INTO games (teacher_id, join_code)
      VALUES (${teacher.teacherId}, ${joinCode})
      RETURNING *
    `;

    return NextResponse.json({ game: result.rows[0] }, { status: 201 });
  } catch (err) {
    console.error('POST /api/games error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
