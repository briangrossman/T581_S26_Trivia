import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, getRoundScores } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await getTeacherFromCookies();
  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const gameId = parseInt(id, 10);
    const game = await getGameById(gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.teacher_id !== teacher.teacherId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const scores = await getRoundScores(gameId);
    return NextResponse.json({ scores });
  } catch (err) {
    console.error('GET /api/games/[id]/scores error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
