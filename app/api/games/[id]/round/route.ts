import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, sql, getNeonUrl } from '@/lib/db';
import { scorePromptWriting } from '@/lib/claude';
import type { Question, Answer } from '@/lib/types';

const MAX_ROUND = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const teacher = await getTeacherFromCookies();
  console.log('[round] teacher from cookies:', teacher);

  if (!teacher) {
    console.log('[round] Unauthorized — no teacher cookie');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = params;
    const gameId = parseInt(id, 10);
    console.log('[round] gameId from params:', id, '->', gameId);

    if (isNaN(gameId)) {
      console.log('[round] gameId is NaN, returning 400');
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const game = await getGameById(gameId);
    console.log('[round] game fetched:', game);

    if (!game) {
      console.log('[round] Game not found for id:', gameId);
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Use Number() to handle potential string/number type mismatch from DB
    if (Number(game.teacher_id) !== Number(teacher.teacherId)) {
      console.log('[round] Forbidden: game.teacher_id=', game.teacher_id,
        '(', typeof game.teacher_id, ') vs teacher.teacherId=', teacher.teacherId,
        '(', typeof teacher.teacherId, ')');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (game.status === 'finished') {
      return NextResponse.json({ error: 'Game is already finished' }, { status: 409 });
    }

    if (game.status === 'scoring') {
      return NextResponse.json({ error: 'Scoring in progress, please wait' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const action: string = body.action ?? 'next';
    console.log('[round] action:', action, 'current_round:', game.current_round, 'status:', game.status);

    // Finish the game
    if (action === 'finish') {
      if (game.current_round < MAX_ROUND) {
        return NextResponse.json({ error: 'Cannot finish before completing all rounds' }, { status: 400 });
      }
      const finishResult = await sql<{ id: number }>`
        UPDATE games SET status = 'finished', current_round = 5 WHERE id = ${gameId}
        RETURNING id
      `;
      console.log('[round] finish UPDATE rows:', finishResult.rows);
      const updated = await getGameById(gameId);
      console.log('[round] game finished, updated:', updated);
      return NextResponse.json({ game: updated });
    }

    // Advance to next round
    const nextRound = game.current_round + 1;
    console.log('[round] advancing to nextRound:', nextRound);

    if (nextRound > MAX_ROUND) {
      return NextResponse.json({ error: 'All rounds already completed' }, { status: 409 });
    }

    // If ending round 3 (prompt writing), run LLM scoring first
    if (game.current_round === 3 && game.status === 'active') {
      // Set status to 'scoring' to prevent double-clicks
      await sql`UPDATE games SET status = 'scoring' WHERE id = ${gameId}`;

      try {
        await scoreRound3(gameId);
      } catch (err) {
        console.error('LLM scoring failed:', err);
        // Reset status so teacher can try again or proceed anyway
        await sql`UPDATE games SET status = 'active' WHERE id = ${gameId}`;
        return NextResponse.json({ error: 'LLM scoring failed, please try again' }, { status: 500 });
      }
    }

    // Move to next round — use RETURNING to verify the UPDATE actually ran
    console.log('[round] running UPDATE: current_round =', nextRound, 'WHERE id =', gameId);
    const updateResult = await sql<{ id: number; current_round: number; status: string }>`
      UPDATE games SET current_round = ${nextRound}, status = 'active' WHERE id = ${gameId}
      RETURNING id, current_round, status
    `;
    console.log('[round] UPDATE RETURNING rows:', updateResult.rows);

    if (updateResult.rows.length === 0) {
      console.error('[round] UPDATE matched 0 rows — gameId may be wrong:', gameId);
      return NextResponse.json(
        { error: `Game update failed: no game found with id=${gameId}` },
        { status: 500 }
      );
    }

    const updated = await getGameById(gameId);
    console.log('[round] updated game:', updated);
    const pgHost = getNeonUrl().replace(/^[^@]+@/, '').replace(/\/.*$/, '');
    const pgHostRaw = (process.env.POSTGRES_URL ?? '').replace(/^[^@]+@/, '').replace(/\/.*$/, '');
    return NextResponse.json({ game: updated, _debug: { pgHost, pgHostRaw } });
  } catch (err) {
    console.error('POST /api/games/[id]/round error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function scoreRound3(gameId: number): Promise<void> {
  // Get the prompt writing question with rubric
  const questionResult = await sql<Question>`
    SELECT * FROM questions WHERE round_number = 3 AND question_type = 'prompt_writing' LIMIT 1
  `;
  const question = questionResult.rows[0];
  if (!question || !question.rubric) return;

  // Get all unscored prompt answers for this game
  const answersResult = await sql<Answer>`
    SELECT * FROM answers
    WHERE game_id = ${gameId}
      AND round_number = 3
      AND score IS NULL
  `;

  // Score each answer in parallel
  await Promise.all(
    answersResult.rows.map(async (answer) => {
      try {
        const { score, rationale } = await scorePromptWriting(answer.answer_text, question.rubric!);
        await sql`
          UPDATE answers
          SET score = ${score}, scored_at = NOW()
          WHERE id = ${answer.id}
        `;
        // Store rationale in a comment (log only — no dedicated column)
        console.log(`Scored student ${answer.student_id}: ${score}/20 — ${rationale}`);
      } catch (err) {
        console.error(`Scoring failed for answer ${answer.id}:`, err);
        // Assign 0 on failure so it doesn't block the game
        await sql`
          UPDATE answers SET score = 0, scored_at = NOW() WHERE id = ${answer.id}
        `;
      }
    })
  );
}
